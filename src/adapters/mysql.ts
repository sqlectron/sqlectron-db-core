import ed25519AuthPlugin from '@coresql/mysql2-auth-ed25519';
import mysql, { PoolConnection } from 'mysql2';
import { identify } from 'sql-query-identifier';

import createLogger from '../logger';
import { appendSemiColon, createCancelablePromise } from '../utils';
import { AbstractAdapter } from './abstract_adapter';

import type { Result } from 'sql-query-identifier';
import type {
  QueryArgs,
  QueryRowResult,
  QueryReturn,
  ListTableResult,
  ListViewResult,
  ListRoutineResult,
  ListTableColumnsResult,
  TableKeysResult,
} from './abstract_adapter';
import type { Database } from '../database';
import type { DatabaseFilter } from '../filters';
import type { Server } from '../server';

const logger = createLogger('db:clients:mysql');

const mysqlErrors = {
  EMPTY_QUERY: 'ER_EMPTY_QUERY',
  CONNECTION_LOST: 'PROTOCOL_CONNECTION_LOST',
};

declare module 'mysql2/typings/mysql/lib/PoolConnection' {
  interface PoolConnection {
    _fatalError: Error | null;
    _protocolError: Error | null;
  }
}

interface QueryResult {
  data: mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.ResultSetHeader;
  fields: mysql.FieldPacket[] | mysql.FieldPacket[][];
}

interface Config {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  multipleStatements: true;
  dateStrings: true;
  supportBigNumbers: true;
  bigNumberStrings: true;
  ssl?: {
    rejectUnauthorized: false;
  };
}

export default class MysqlAdapter extends AbstractAdapter {
  conn: {
    pool: mysql.Pool;
  };

  constructor(server: Server, database: Database) {
    super(server, database);

    const dbConfig = this.configDatabase();
    logger().debug('create adapter for mysql with config %j', dbConfig);

    this.conn = {
      pool: mysql.createPool({
        ...dbConfig,
        authPlugins: {
          ed25519: ed25519AuthPlugin(),
        },
      }),
    };
  }

  configDatabase(): Config {
    const config: Config = {
      host: this.server.config.host,
      port: this.server.config.port,
      user: this.server.config.user,
      password: this.server.config.password,
      database: this.database.database,
      multipleStatements: true,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };

    if (this.server.sshTunnel) {
      config.host = this.server.config.localHost;
      config.port = this.server.config.localPort;
    }

    if (this.server.config.ssl) {
      config.ssl = {
        // It is not the best recommend way to use SSL with node-mysql
        // https://github.com/felixge/node-mysql#ssl-options
        // But this way we have compatibility with all clients.
        rejectUnauthorized: false,
      };
    }

    return config;
  }

  async connect(): Promise<void> {
    logger().debug('connecting');

    const versionInfo = <mysql.RowDataPacket[]>(
      await this.driverExecuteQuery({
        query: "SHOW VARIABLES WHERE variable_name='version' OR variable_name='version_comment';",
      })
    ).data;

    let version = '';
    let versionComment = '';
    for (let i = 0; i < versionInfo.length; i++) {
      const item = versionInfo[i];
      if (item.Variable_name === 'version') {
        version = item.Value as string;
      } else if (item.Variable_name === 'version_comment') {
        versionComment = item.Value as string;
      }
    }

    this.version = {
      name: versionComment,
      version: version.split('-')[0],
      string: `${versionComment} ${version}`,
    };

    // normalize the name as depending on where the server is installed from, it
    // could be just "MySQL" or "MariaDB", or it could be a longer string like
    // "mariadb.org binary distribution"
    const lowerComment = versionComment.toLowerCase();
    if (lowerComment.includes('mysql')) {
      this.version.name = 'MySQL';
    } else if (lowerComment.includes('mariadb')) {
      this.version.name = 'MariaDB';
    } else if (lowerComment.includes('percona')) {
      this.version.name = 'Percona';
    }

    logger().debug('connected');
  }

  disconnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.pool.end((err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  query(queryText: string): QueryReturn {
    let pid: number | null = null;
    let canceling = false;
    const cancelable = createCancelablePromise();

    return {
      execute: () => {
        return this.runWithConnection(async (connection) => {
          const pidResult = await this.driverExecuteQuery(
            {
              query: 'SELECT connection_id() AS pid',
            },
            connection,
          );

          pid = (<mysql.RowDataPacket[]>pidResult.data)[0].pid as number;

          try {
            const data = await Promise.race([
              cancelable.wait(),
              this.executeQuery(queryText, connection),
            ]);

            pid = null;

            return <QueryRowResult[]>data;
          } catch (err) {
            if (canceling && (err as { code: string }).code === mysqlErrors.CONNECTION_LOST) {
              canceling = false;
              (err as { sqlectronError: string }).sqlectronError = 'CANCELED_BY_USER';
            }

            throw err;
          } finally {
            cancelable.discard();
          }
        });
      },

      cancel: async () => {
        if (!pid) {
          throw new Error('Query not ready to be canceled');
        }

        canceling = true;
        try {
          await this.driverExecuteQuery({
            query: `kill ${pid};`,
          });
          cancelable.cancel();
        } catch (err) {
          canceling = false;
          throw err;
        }
      },
    };
  }

  async executeQuery(
    queryText: string,
    connection?: mysql.PoolConnection,
  ): Promise<QueryRowResult[]> {
    const { data, fields } = await this.driverExecuteQuery({ query: queryText }, connection);

    if (!data || (Array.isArray(data) && data.length === 0 && fields.length === 0)) {
      return [];
    }

    const commands = identifyCommands(queryText).map((item) => item.type);

    if (!isMultipleQuery(fields)) {
      return [
        parseRowQueryResult(<mysql.RowDataPacket[]>data, <mysql.FieldPacket[]>fields, commands[0]),
      ];
    }

    return (<mysql.RowDataPacket[][]>data).map((_, idx) => {
      return parseRowQueryResult(
        (<mysql.RowDataPacket[][]>data)[idx],
        (<mysql.FieldPacket[][]>fields)[idx],
        commands[idx],
      );
    });
  }

  async listTables(): Promise<ListTableResult[]> {
    const sql = `
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = database()
      AND table_type NOT LIKE '%VIEW%'
      ORDER BY table_name
    `;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return data as ListTableResult[];
  }

  async listViews(): Promise<ListViewResult[]> {
    const sql = `
      SELECT table_name as name
      FROM information_schema.views
      WHERE table_schema = database()
      ORDER BY table_name
    `;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return data as ListViewResult[];
  }

  async listRoutines(): Promise<ListRoutineResult[]> {
    const sql = `
      SELECT routine_name as 'routine_name', routine_type as 'routine_type'
      FROM information_schema.routines
      WHERE routine_schema = database()
      ORDER BY routine_name
    `;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) => ({
      routineName: row.routine_name as string,
      routineType: row.routine_type as string,
    }));
  }

  async listTableColumns(table: string): Promise<ListTableColumnsResult[]> {
    const sql = `
      SELECT column_name AS 'column_name', data_type AS 'data_type'
      FROM information_schema.columns
      WHERE table_schema = database()
      AND table_name = ?
      ORDER BY ordinal_position
    `;

    const params = [table];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => ({
      columnName: row.column_name as string,
      dataType: row.data_type as string,
    }));
  }

  async listTableTriggers(table: string): Promise<string[]> {
    const sql = `
      SELECT trigger_name as 'trigger_name'
      FROM information_schema.triggers
      WHERE event_object_schema = database()
      AND event_object_table = ?
    `;

    const params = [table];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => row.trigger_name as string);
  }

  async listTableIndexes(table: string): Promise<string[]> {
    const sql = 'SHOW INDEX FROM ?? FROM ??';

    const params = [table, this.database.database];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => row.Key_name as string);
  }

  async listDatabases(filter?: DatabaseFilter): Promise<string[]> {
    const sql = 'show databases';

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data)
      .filter((item) => filterDatabase(item, filter, 'Database'))
      .map((row) => row.Database as string);
  }

  async getTableReferences(table: string): Promise<string[]> {
    const sql = `
      SELECT referenced_table_name as 'referenced_table_name'
      FROM information_schema.key_column_usage
      WHERE referenced_table_name IS NOT NULL
      AND table_schema = database()
      AND table_name = ?
    `;

    const params = [table];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => row.referenced_table_name as string);
  }

  async getTableKeys(table: string): Promise<TableKeysResult[]> {
    const sql = `
      SELECT
        constraint_name as 'constraint_name',
        column_name as 'column_name',
        referenced_table_name as 'referenced_table_name',
        CASE WHEN (referenced_table_name IS NOT NULL) THEN 'FOREIGN'
        ELSE constraint_name
        END as key_type
      FROM information_schema.key_column_usage
      WHERE table_schema = database()
      AND table_name = ?
      AND ((referenced_table_name IS NOT NULL) OR constraint_name LIKE '%PRIMARY%')
    `;

    const params = [table];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => ({
      constraintName: `${row.constraint_name as string} KEY`,
      columnName: row.column_name as string,
      referencedTable: row.referenced_table_name as string,
      keyType: `${row.key_type as string} KEY`,
    }));
  }

  async getTableCreateScript(table: string): Promise<string[]> {
    const sql = `SHOW CREATE TABLE ${table}`;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) =>
      appendSemiColon(row['Create Table'] as string),
    );
  }

  async getViewCreateScript(view: string): Promise<string[]> {
    const sql = `SHOW CREATE VIEW ${view}`;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) =>
      appendSemiColon(row['Create View'] as string),
    );
  }

  async getRoutineCreateScript(routine: string, type: string): Promise<string[]> {
    const sql = `SHOW CREATE ${type.toUpperCase()} ${routine}`;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) =>
      appendSemiColon(row[`Create ${type}`] as string),
    );
  }

  async getSchema(connection?: mysql.PoolConnection): Promise<string> {
    const sql = "SELECT database() AS 'schema'";

    const result = await this.driverExecuteQuery({ query: sql }, connection);

    return (<mysql.RowDataPacket[]>result.data)[0].schema as string;
  }

  async truncateAllTables(): Promise<void> {
    await this.runWithConnection(async (connection) => {
      const schema = await this.getSchema(connection);

      const sql = `
        SELECT table_name as 'table_name'
        FROM information_schema.tables
        WHERE table_schema = '${schema}'
        AND table_type NOT LIKE '%VIEW%'
      `;

      const result = await this.driverExecuteQuery({ query: sql }, connection);
      const data = <mysql.RowDataPacket[]>result.data;

      const truncateAll = data
        .map(
          (row) => `
        SET FOREIGN_KEY_CHECKS = 0;
        TRUNCATE TABLE ${this.wrapIdentifier(schema)}.${this.wrapIdentifier(
            row.table_name as string,
          )};
        SET FOREIGN_KEY_CHECKS = 1;
      `,
        )
        .join('');

      return this.driverExecuteQuery({ query: truncateAll }, connection);
    });
  }

  async driverExecuteQuery(
    queryArgs: QueryArgs,
    connection?: mysql.PoolConnection,
  ): Promise<QueryResult> {
    const runQuery = (connection: mysql.PoolConnection): Promise<QueryResult> => {
      return new Promise((resolve, reject) => {
        connection.query(queryArgs.query, queryArgs.params, (err, data, fields) => {
          if (err && err.code === mysqlErrors.EMPTY_QUERY) {
            return resolve({ data: [], fields: [] });
          }
          if (err) {
            return reject(getRealError(connection, err));
          }

          resolve({
            data: data as mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.ResultSetHeader,
            fields,
          });
        });
      });
    };

    return connection ? runQuery(connection) : this.runWithConnection(runQuery);
  }

  runWithConnection<T = QueryResult>(
    run: (connection: mysql.PoolConnection) => Promise<T>,
  ): Promise<T> {
    let rejected = false;
    return new Promise((resolve, reject) => {
      const rejectErr = (err: NodeJS.ErrnoException) => {
        if (!rejected) {
          rejected = true;
          reject(err);
        }
      };

      this.conn.pool.getConnection(async (errPool, connection) => {
        if (errPool) {
          rejectErr(errPool);
          return;
        }

        connection.on('error', (error: string) => {
          // it will be handled later in the next query execution
          logger().error('Connection fatal error %j', error);
        });

        try {
          resolve(await run(connection));
        } catch (err) {
          rejectErr(err as Error);
        } finally {
          connection.release();
        }
      });
    });
  }

  wrapIdentifier(value: string): string {
    return wrapIdentifier(value);
  }
}

export function wrapIdentifier(value: string): string {
  return value !== '*' ? `\`${value.replace(/`/g, '``')}\`` : '*';
}

function identifyCommands(queryText: string): Result[] {
  try {
    return identify(queryText, { strict: false });
  } catch (err) {
    return [];
  }
}

function getRealError(conn: PoolConnection, err: mysql.QueryError): Error {
  /* eslint no-underscore-dangle:0, @typescript-eslint/no-unsafe-return:0 */
  if (conn?._fatalError) {
    return conn._fatalError;
  }
  if (conn?._protocolError) {
    return conn._protocolError;
  }
  return err;
}

function parseRowQueryResult(
  data: mysql.RowDataPacket[] | mysql.ResultSetHeader,
  fields: mysql.FieldPacket[],
  command: string,
): QueryRowResult {
  // Fallback in case the identifier could not reconize the command
  const isSelect = Array.isArray(data);
  const dataArray = isSelect ? data || [] : [];
  const dataHeader = !isSelect ? data : { affectedRows: undefined };
  return {
    command: command || (isSelect ? 'SELECT' : 'UNKNOWN'),
    rows: dataArray,
    fields: fields || [],
    rowCount: isSelect ? dataArray.length : undefined,
    affectedRows: dataHeader.affectedRows,
  };
}

function isMultipleQuery(fields: mysql.FieldPacket[] | mysql.FieldPacket[][]) {
  if (!fields) {
    return false;
  }
  if (!fields.length) {
    return false;
  }
  return Array.isArray(fields[0]) || fields[0] === undefined;
}

function filterDatabase(
  item: mysql.RowDataPacket,
  { database }: DatabaseFilter = {},
  databaseField: string,
) {
  if (!database) {
    return true;
  }

  const value = item[databaseField] as string;
  if (typeof database === 'string') {
    return database === value;
  }

  const { only, ignore } = database;

  if (only && only.length && !only.includes(value)) {
    return false;
  }

  if (ignore && ignore.length && ignore.includes(value)) {
    return false;
  }

  return true;
}
