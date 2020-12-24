import mysql from 'mysql2';
import { identify } from 'sql-query-identifier';

import createLogger from '../logger';
import { createCancelablePromise } from '../utils';
import { AbstractAdapter } from './abstract_adapter';

import type { Result } from 'sql-query-identifier';
import type { QueryArgs, QueryRowResult } from './abstract_adapter';
import type { Database } from '../database';
import type { ListDatabaseFilter } from '../filters';
import type { Server } from '../server';

const logger = createLogger('db:clients:mysql');

const mysqlErrors = {
  EMPTY_QUERY: 'ER_EMPTY_QUERY',
  CONNECTION_LOST: 'PROTOCOL_CONNECTION_LOST',
};

declare module "mysql2" {
  interface PoolConnection {
    _fatalError: Error | null;
    _protocolError: Error | null;
  }
}

interface QueryResult {
  data: mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.ResultSetHeader;
  fields: mysql.FieldPacket[];
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
      pool: mysql.createPool(dbConfig),
    };
  }

  configDatabase() {
    const config: {
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      database: string;
      multipleStatements: true;
      dateStrings: true;
      supportBigNumbers: true;
      bigNumberStrings: true;
      ssl?: {
        rejectUnauthorized: false;
      }
    } = {
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

  async connect() {
    const versionInfo = <mysql.RowDataPacket[]>(await this.driverExecuteQuery({
      query: "SHOW VARIABLES WHERE variable_name='version' OR variable_name='version_comment';",
    })).data;

    let version;
    let versionComment;
    for (let i = 0; i < versionInfo.length; i++) {
      const item = versionInfo[i];
      if (item.Variable_name === 'version') {
        version = item.Value;
      } else if (item.Variable_name === 'version_comment') {
        versionComment = item.Value;
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

  query(queryText: string) {
    let pid: number | null = null;
    let canceling = false;
    const cancelable = createCancelablePromise();

    return {
      execute: () => {
        return this.runWithConnection(async (connection) => {
          const pidResult = await this.driverExecuteQuery({
            query: 'SELECT connection_id() AS pid',
          }, connection);

          pid = (<mysql.RowDataPacket[]>pidResult.data)[0].pid;

          try {
            const data = await Promise.race([
              cancelable.wait(),
              this.executeQuery(queryText, connection),
            ]);

            pid = null;

            return <QueryRowResult[]>data;
          } catch (err) {
            if (canceling && err.code === mysqlErrors.CONNECTION_LOST) {
              canceling = false;
              err.sqlectronError = 'CANCELED_BY_USER';
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

  async executeQuery(queryText: string, connection?: mysql.PoolConnection): Promise<QueryRowResult[]> {
    const result = await this.driverExecuteQuery({ query: queryText }, connection);
    const fields = result.fields;

    if (!result.data) {
      return [];
    }

    const commands = identifyCommands(queryText).map((item) => item.type);

    if (!isMultipleQuery(fields)) {
      return [parseRowQueryResult(<mysql.RowDataPacket[]>result.data, fields, commands[0])];
    }

    const data = <mysql.RowDataPacket[][]>result.data;
    return data.map((_, idx) => {
      return parseRowQueryResult(data[idx], fields, commands[idx])
    });
  }

  async listTables() {
    const sql = `
      SELECT table_name as name
      FROM information_schema.tables
      WHERE table_schema = database()
      AND table_type NOT LIKE '%VIEW%'
      ORDER BY table_name
    `;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return <{name: string}[]>data;
  }

  async listViews() {
    const sql = `
      SELECT table_name as name
      FROM information_schema.views
      WHERE table_schema = database()
      ORDER BY table_name
    `;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return <{name: string}[]>data;
  }

  async listRoutines() {
    const sql = `
      SELECT routine_name as 'routine_name', routine_type as 'routine_type'
      FROM information_schema.routines
      WHERE routine_schema = database()
      ORDER BY routine_name
    `;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) => ({
      routineName: row.routine_name,
      routineType: row.routine_type,
    }));
  }

  async listTableColumns(table: string) {
    const sql = `
      SELECT column_name AS 'column_name', data_type AS 'data_type'
      FROM information_schema.columns
      WHERE table_schema = database()
      AND table_name = ?
      ORDER BY ordinal_position
    `;

    const params = [
      table,
    ];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => ({
      columnName: row.column_name,
      dataType: row.data_type,
    }));
  }

  async listTableTriggers(table: string) {
    const sql = `
      SELECT trigger_name as 'trigger_name'
      FROM information_schema.triggers
      WHERE event_object_schema = database()
      AND event_object_table = ?
    `;

    const params = [
      table,
    ];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => row.trigger_name);
  }

  async listTableIndexes(table: string) {
    const sql = 'SHOW INDEX FROM ?? FROM ??';

    const params = [
      table,
      this.database.database,
    ];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => row.Key_name);
  }

  async listDatabases(filter: ListDatabaseFilter) {
    const sql = 'show databases';

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data)
      .filter((item) => filterDatabase(item, filter, 'Database'))
      .map((row) => row.Database);
  }

  async getTableReferences(table: string) {
    const sql = `
      SELECT referenced_table_name as 'referenced_table_name'
      FROM information_schema.key_column_usage
      WHERE referenced_table_name IS NOT NULL
      AND table_schema = database()
      AND table_name = ?
    `;

    const params = [
      table,
    ];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => row.referenced_table_name);
  }

  async getTableKeys(table: string) {
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

    const params = [
      table,
    ];

    const { data } = await this.driverExecuteQuery({ query: sql, params });

    return (<mysql.RowDataPacket[]>data).map((row) => ({
      constraintName: `${row.constraint_name} KEY`,
      columnName: row.column_name,
      referencedTable: row.referenced_table_name,
      keyType: `${row.key_type} KEY`,
    }));
  }

  async getTableCreateScript(table: string) {
    const sql = `SHOW CREATE TABLE ${table}`;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) => row['Create Table']);
  }

  async getViewCreateScript(view: string) {
    const sql = `SHOW CREATE VIEW ${view}`;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) => row['Create View']);
  }

  async getRoutineCreateScript(routine: string, type: string) {
    const sql = `SHOW CREATE ${type.toUpperCase()} ${routine}`;

    const { data } = await this.driverExecuteQuery({ query: sql });

    return (<mysql.RowDataPacket[]>data).map((row) => row[`Create ${type}`]);
  }

  async getSchema(connection?: mysql.PoolConnection) {
    const sql = 'SELECT database() AS \'schema\'';

    const result = await this.driverExecuteQuery({ query: sql }, connection);

    return (<mysql.RowDataPacket[]>result.data)[0].schema;
  }

  async truncateAllTables() {
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

      const truncateAll = data.map((row) => `
        SET FOREIGN_KEY_CHECKS = 0;
        TRUNCATE TABLE ${this.wrapIdentifier(schema)}.${this.wrapIdentifier(row.table_name)};
        SET FOREIGN_KEY_CHECKS = 1;
      `).join('');

      return this.driverExecuteQuery({ query: truncateAll }, connection);
    });
  }

  async driverExecuteQuery(queryArgs: QueryArgs, connection?: mysql.PoolConnection): Promise<QueryResult> {
    const runQuery = (connection: mysql.PoolConnection): Promise<QueryResult> => {
      return new Promise((resolve, reject) => {
        connection.query(queryArgs.query, queryArgs.params, (err, data, fields) => {
          if (err && err.code === mysqlErrors.EMPTY_QUERY) {
            return resolve({data: [], fields: []});
          }
          if (err) {
            return reject(getRealError(connection, err));
          }

          resolve({
            data: (data as mysql.RowDataPacket[] | mysql.RowDataPacket[][] | mysql.ResultSetHeader),
            fields
          });
        });
      });
    };

    return connection
      ? runQuery(connection)
      : this.runWithConnection(runQuery);
  }

  runWithConnection<T = QueryResult>(
    run: (connection: mysql.PoolConnection) => Promise<T>
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
          rejectErr(err);
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

function getRealError(conn: mysql.PoolConnection, err: mysql.QueryError) {
  /* eslint no-underscore-dangle:0 */
  if (conn && (conn._fatalError || conn._protocolError)) {
    return (conn._fatalError || conn._protocolError);
  }
  return err;
}


function parseRowQueryResult(
  data: mysql.RowDataPacket[] | mysql.ResultSetHeader,
  fields: mysql.FieldPacket[],
  command: string
): QueryRowResult {
  // Fallback in case the identifier could not reconize the command
  const isSelect = Array.isArray(data);
  const dataArray = isSelect ? <mysql.RowDataPacket[]>data || [] : [];
  const dataHeader = !isSelect ? <mysql.ResultSetHeader>data : { affectedRows: undefined };
  return {
    command: command || (isSelect ? 'SELECT' : 'UNKNOWN'),
    rows: dataArray,
    fields: fields || [],
    rowCount: isSelect ? dataArray.length : undefined,
    affectedRows: dataHeader.affectedRows,
  };
}


function isMultipleQuery(fields: mysql.FieldPacket[]) {
  if (!fields) { return false; }
  if (!fields.length) { return false; }
  return (Array.isArray(fields[0]) || fields[0] === undefined);
}

function filterDatabase(
  item: mysql.RowDataPacket,
  { database }: ListDatabaseFilter = {},
  databaseField: string
) {
  if (!database) { return true; }

  const value = item[databaseField];
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
