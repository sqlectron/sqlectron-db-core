import { ConnectionPool } from 'mssql';

import { buildDatabaseFilter, buildSchemaFilter } from '../filters';
import createLogger from '../logger';
import { identifyCommands, appendSemiColon } from '../utils';
import { AbstractAdapter, QueryArgs, QueryRowResult } from './abstract_adapter';

import type { config, Request, IResult, IRecordSet } from 'mssql';
import type { Database } from '../database';
import type { DatabaseFilter, SchemaFilter } from '../filters';
import type { Server } from '../server';
import type {
  ListTableResult,
  ListViewResult,
  ListRoutineResult,
  ListTableColumnsResult,
  TableKeysResult,
  QueryReturn,
} from './abstract_adapter';

const logger = createLogger('db:clients:sqlserver');

const mmsqlErrors = {
  CANCELED: 'ECANCEL',
};

interface QueryResult<T = unknown> {
  request: Request;
  result: IResult<unknown>;
  data: IRecordSet<T>[];
}

interface SingleQueryResult<T = unknown> {
  request: Request;
  result: IResult<unknown>;
  data: IRecordSet<T>;
}

interface ListTableQuery {
  table_schema: string;
  table_name: string;
}

export default class SqlServerAdapter extends AbstractAdapter {
  conn: {
    dbConfig: config;
    connection?: ConnectionPool;
  };

  constructor(server: Server, database: Database) {
    super(server, database);
    const dbConfig = this.configDatabase();
    logger().debug('create driver client for mmsql with config %j', dbConfig);

    this.conn = { dbConfig };
  }

  configDatabase(): config {
    const config: config = {
      user: this.server.config.user,
      password: this.server.config.password,
      server: <string>this.server.config.host,
      database: this.database.database,
      port: this.server.config.port,
      requestTimeout: Infinity,
      domain: this.server.config.domain,
      pool: {
        max: 5,
      },
      options: {
        encrypt: !!this.server.config.ssl,
        appName: this.server.config.applicationName || 'sqlectron',
        enableArithAbort: true,
      },
    };

    if (this.server.sshTunnel) {
      config.server = <string>this.server.config.localHost;
      config.port = this.server.config.localPort;
    }

    return config;
  }

  async connect(): Promise<void> {
    logger().debug('connecting');

    const version = (await this.driverExecuteSingleQuery<{version: string}>({
      query: "SELECT @@version as 'version'"
    })).data[0].version;

    this.version = {
      name: 'SQL Server',
      version: (/^Microsoft SQL Server ([0-9]{4})/.exec(version) as RegExpExecArray)[1],
      string: version,
    };

    logger().debug('connected');
  }

  async disconnect(): Promise<void> {
    if (!this.conn.connection) {
      return;
    }
    return this.conn.connection.close();
  }

  async getSchema(connection?: ConnectionPool): Promise<string> {
    const sql = 'SELECT schema_name() AS \'schema\'';

    const { data } = await this.driverExecuteSingleQuery<{schema: string}>(
      { query: sql },
      connection
    );
    return data[0].schema;
  }

  async listDatabases(filter?: DatabaseFilter): Promise<string[]> {
    const databaseFilter = buildDatabaseFilter(filter, 'name');
    const sql = `
      SELECT name
      FROM sys.databases
      ${databaseFilter ? `AND ${databaseFilter}` : ''}
      ORDER BY name
    `;

    const { data } = await this.driverExecuteSingleQuery<{name: string}>({ query: sql });

    return data.map((row) => row.name);
  }

  async listSchemas(filter: SchemaFilter): Promise<string[]> {
    const schemaFilter = buildSchemaFilter(filter);
    const sql = `
      SELECT schema_name
      FROM INFORMATION_SCHEMA.SCHEMATA
      ${schemaFilter ? `WHERE ${schemaFilter}` : ''}
      ORDER BY schema_name
    `;

    const { data } = await this.driverExecuteSingleQuery<{schema_name: string}>({ query: sql });

    return data.map((row) => row.schema_name);
  }

  async listTables(filter: SchemaFilter): Promise<ListTableResult[]> {
    const schemaFilter = buildSchemaFilter(filter, 'table_schema');
    const sql = `
      SELECT
        table_schema,
        table_name
      FROM INFORMATION_SCHEMA.TABLES
      WHERE table_type NOT LIKE '%VIEW%'
      ${schemaFilter ? `AND ${schemaFilter}` : ''}
      ORDER BY table_schema, table_name
    `;

    const { data } = await this.driverExecuteSingleQuery<ListTableQuery>({ query: sql });

    return data.map((item) => ({
      schema: item.table_schema,
      name: item.table_name,
    }));
  }

  async listViews(filter: SchemaFilter): Promise<ListViewResult[]> {
    const schemaFilter = buildSchemaFilter(filter, 'table_schema');
    const sql = `
      SELECT
        table_schema,
        table_name
      FROM INFORMATION_SCHEMA.VIEWS
      ${schemaFilter ? `WHERE ${schemaFilter}` : ''}
      ORDER BY table_schema, table_name
    `;

    const { data } = await this.driverExecuteSingleQuery<ListTableQuery>({ query: sql });

    return data.map((item) => ({
      schema: item.table_schema,
      name: item.table_name,
    }));
  }

  async listRoutines(filter: SchemaFilter): Promise<ListRoutineResult[]> {
    const schemaFilter = buildSchemaFilter(filter, 'routine_schema');
    const sql = `
      SELECT
        routine_schema,
        routine_name,
        routine_type
      FROM INFORMATION_SCHEMA.ROUTINES
      ${schemaFilter ? `WHERE ${schemaFilter}` : ''}
      GROUP BY routine_schema, routine_name, routine_type
      ORDER BY routine_schema, routine_name
    `;

    const { data } = await this.driverExecuteSingleQuery<{
      routine_schema: string;
      routine_name: string;
      routine_type: string;
    }>({ query: sql });

    return data.map((row) => ({
      schema: row.routine_schema,
      routineName: row.routine_name,
      routineType: row.routine_type,
    }));
  }

  async listTableColumns(table: string): Promise<ListTableColumnsResult[]> {
    const sql = `
      SELECT column_name, data_type
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = '${table}'
      ORDER BY ordinal_position
    `;

    const { data } = await this.driverExecuteSingleQuery<{column_name: string; data_type: string}>({ query: sql });

    return data.map((row) => ({
      columnName: row.column_name,
      dataType: row.data_type,
    }));
  }

  async listTableTriggers(table: string): Promise<string[]> {
    // SQL Server does not have information_schema for triggers, so other way around
    // is using sp_helptrigger stored procedure to fetch triggers related to table
    const sql = `EXEC sp_helptrigger ${wrapIdentifier(table)}`;

    const { data } = await this.driverExecuteSingleQuery<{trigger_name: string}>({ query: sql });

    return data.map((row) => row.trigger_name);
  }

  async listTableIndexes(table: string): Promise<string[]> {
    // SQL Server does not have information_schema for indexes, so other way around
    // is using sp_helpindex stored procedure to fetch indexes related to table
    const sql = `EXEC sp_helpindex ${wrapIdentifier(table)}`;

    const { data } = await this.driverExecuteSingleQuery<{index_name: string}>({ query: sql });

    return data.map((row) => row.index_name);
  }

  async getTableReferences(table: string): Promise<string[]> {
    const sql = `
      SELECT OBJECT_NAME(referenced_object_id) referenced_table_name
      FROM sys.foreign_keys
      WHERE parent_object_id = OBJECT_ID('${table}')
    `;

    const { data } = await this.driverExecuteSingleQuery<{referenced_table_name: string}>({ query: sql });

    return data.map((row) => row.referenced_table_name);
  }

  async getTableKeys(table: string): Promise<TableKeysResult[]> {
    const sql = `
      SELECT
        tc.constraint_name,
        kcu.column_name,
        CASE WHEN tc.constraint_type LIKE '%FOREIGN%' THEN OBJECT_NAME(sfk.referenced_object_id)
        ELSE NULL
        END AS referenced_table_name,
        tc.constraint_type
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN sys.foreign_keys as sfk
        ON sfk.parent_object_id = OBJECT_ID(tc.table_name)
      WHERE tc.table_name = '${table}'
      AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')
    `;

    const { data } = await this.driverExecuteSingleQuery<{
      constraint_name: string;
      column_name: string;
      referenced_table_name: string | null;
      constraint_type: string;
    }>({ query: sql });

    return data.map((row) => ({
      constraintName: row.constraint_name,
      columnName: row.column_name,
      referencedTable: row.referenced_table_name,
      keyType: row.constraint_type,
    }));
  }

  getQuerySelectTop(table: string, limit: number): string {
    return `SELECT TOP ${limit} * FROM ${this.wrapIdentifier(table)}`;
  }

  async getTableCreateScript(table: string): Promise<string[]> {
    // Reference http://stackoverflow.com/a/317864
    const sql = `
      SELECT  ('CREATE TABLE ' + so.name + ' (' +
        CHAR(13)+CHAR(10) + REPLACE(o.list, '&#x0D;', CHAR(13)) +
        ');' + CHAR(13)+CHAR(10) +
        CASE WHEN tc.constraint_name IS NULL THEN ''
             ELSE + CHAR(13)+CHAR(10) + 'ALTER TABLE ' + so.Name +
             ' ADD CONSTRAINT ' + tc.constraint_name  +
             ' PRIMARY KEY ' + '(' + LEFT(j.list, Len(j.list)-1) + ');'
        END) AS createtable
      FROM sysobjects so
      CROSS APPLY
        (SELECT
          '  ' + column_name + ' ' +
          data_type +
          CASE data_type
              WHEN 'sql_variant' THEN ''
              WHEN 'text' THEN ''
              WHEN 'ntext' THEN ''
              WHEN 'xml' THEN ''
              WHEN 'decimal' THEN '(' + cast(numeric_precision AS varchar) + ', '
                    + cast(numeric_scale AS varchar) + ')'
              ELSE coalesce('('+ CASE WHEN character_maximum_length = -1
                    THEN 'MAX'
                    ELSE cast(character_maximum_length AS varchar)
                  END + ')','')
            END + ' ' +
            CASE WHEN EXISTS (
              SELECT id FROM syscolumns
              WHERE object_name(id)=so.name
              AND name=column_name
              AND columnproperty(id,name,'IsIdentity') = 1
            ) THEN
              'IDENTITY(' +
              cast(ident_seed(so.name) AS varchar) + ',' +
              cast(ident_incr(so.name) AS varchar) + ')'
            ELSE ''
            END + ' ' +
             (CASE WHEN UPPER(IS_NULLABLE) = 'NO'
                   THEN 'NOT '
                   ELSE ''
            END ) + 'NULL' +
            CASE WHEN INFORMATION_SCHEMA.COLUMNS.column_default IS NOT NULL
                 THEN 'DEFAULT '+ INFORMATION_SCHEMA.COLUMNS.column_default
                 ELSE ''
            END + ',' + CHAR(13)+CHAR(10)
         FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = so.name
         ORDER BY ordinal_position
         FOR XML PATH('')
      ) o (list)
      LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      ON  tc.table_name       = so.name
      AND tc.constraint_type  = 'PRIMARY KEY'
      CROSS APPLY
          (SELECT column_name + ', '
           FROM   INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
           WHERE  kcu.constraint_name = tc.constraint_name
           ORDER BY ordinal_position
           FOR XML PATH('')
          ) j (list)
      WHERE   xtype = 'U'
      AND name    NOT IN ('dtproperties')
      AND so.name = '${table}'
    `;

    const { data } = await this.driverExecuteSingleQuery<{createtable: string}>({ query: sql });

    return data.map((row) => row.createtable);
  }

  async getViewCreateScript(view: string): Promise<string[]> {
    const sql = `SELECT OBJECT_DEFINITION (OBJECT_ID('${view}')) AS ViewDefinition;`;

    const { data } = await this.driverExecuteSingleQuery<{ViewDefinition: string}>({ query: sql });

    return data.map((row) => row.ViewDefinition.trim());
  }

  async getRoutineCreateScript(routine: string): Promise<string[]> {
    const sql = `
      SELECT routine_definition
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE routine_name = '${routine}'
    `;

    const { data } = await this.driverExecuteSingleQuery<{routine_definition: string}>({ query: sql });

    return data.map((row) => appendSemiColon(row.routine_definition));
  }

  async truncateAllTables(): Promise<void> {
    await this.runWithConnection(async (connection: ConnectionPool) => {
      const schema = await this.getSchema(connection);

      const sql = `
        SELECT table_name
        FROM INFORMATION_SCHEMA.TABLES
        WHERE table_schema = '${schema}'
        AND table_type NOT LIKE '%VIEW%'
      `;

      const { data } = await this.driverExecuteSingleQuery<{table_name: string}>(
        { query: sql },
        connection
      );

      const disableForeignKeys = data.map((row) => `
        ALTER TABLE ${wrapIdentifier(schema)}.${wrapIdentifier(row.table_name)} NOCHECK CONSTRAINT all;
      `).join('');
      const truncateAll = data.map((row) => `
        DELETE FROM ${wrapIdentifier(schema)}.${wrapIdentifier(row.table_name)};
        DBCC CHECKIDENT ('${schema}.${row.table_name}', RESEED, 0);
      `).join('');
      const enableForeignKeys = data.map((row) => `
        ALTER TABLE ${wrapIdentifier(schema)}.${wrapIdentifier(row.table_name)} WITH CHECK CHECK CONSTRAINT all;
      `).join('');

      await this.driverExecuteQuery({
        query: disableForeignKeys + truncateAll + enableForeignKeys,
        multiple: true,
      }, connection);
    });
  }

  query(queryText: string): QueryReturn {
    let queryRequest: null | Request = null;

    return {
      execute: () => {
        return this.runWithConnection(async (connection: ConnectionPool) => {
          const request = connection.request();
          request.multiple = true;

          try {
            const promiseQuery = request.query(queryText);

            queryRequest = request;

            const result = await promiseQuery;
            const data = request.multiple ? result.recordsets : result.recordset;
            const affectedRows = result.rowsAffected ?
              result.rowsAffected.reduce((a, b) => a + b, 0) :
              undefined;

            const commands = identifyCommands(queryText).map((item) => item.type);

            // Executing only non select queries will not return results.
            // So we "fake" there is at least one result.
            const results = <IRecordSet<unknown>[]>(!data.length && affectedRows ? [[]] : data);

            return results.map((_, idx) => parseRowQueryResult(
              results[idx],
              affectedRows,
              commands[idx],
            ));
          } catch (err: unknown) {
            if ((err as {code: string}).code === mmsqlErrors.CANCELED) {
              (err as {sqlectronError: string}).sqlectronError = 'CANCELED_BY_USER';
            }

            throw err;
          }
        });
      },

      cancel: () => {
        if (!queryRequest) {
          throw new Error('Query not ready to be canceled');
        }

        queryRequest.cancel();
      },
    };
  }


  async executeQuery(queryText: string, connection?: ConnectionPool): Promise<QueryRowResult[]> {
    const { data, result } = await this.driverExecuteQuery(
      {
        query: queryText,
        multiple: true,
      },
      connection,
    );

    const commands = identifyCommands(queryText).map((item) => item.type);

    // Executing only non select queries will not return results.
    // So we "fake" there is at least one result.
    const rowsAffected = result.rowsAffected.reduce((a, b) => a + b, 0);
    const results = !data.length && rowsAffected ? [[]] : data;

    return (<Array<IRecordSet<unknown> | []>>results).map(
      (value: IRecordSet<unknown> | [], idx: number) => {
        return parseRowQueryResult(value, rowsAffected, commands[idx]);
      }
    );
  }

  async driverExecuteSingleQuery<T = unknown>(
    queryArgs: QueryArgs,
    connection?: ConnectionPool,
  ): Promise<SingleQueryResult<T>> {
    const result = await this.driverExecuteQuery(queryArgs, connection);
    return {
      request: result.request,
      result: result.result,
      data: result.data[0] as IRecordSet<T>,
    };
  }

  async driverExecuteQuery<T = unknown>(queryArgs: QueryArgs, connection?: ConnectionPool): Promise<QueryResult<T>> {
    const runQuery = async (connection: ConnectionPool): Promise<QueryResult<T>> => {
      const request = connection.request();
      if (queryArgs.multiple) {
        request.multiple = true;
      }

      const result = await request.query(queryArgs.query);

      return {
        request,
        result,
        data: request.multiple
          ? result.recordsets as IRecordSet<T>[]
          : [result.recordset as IRecordSet<T>],
      };
    };

    return connection
      ? runQuery(connection)
      : this.runWithConnection(runQuery);
  }

  async runWithConnection<T = QueryResult>(run: (connection: ConnectionPool) => Promise<T>): Promise<T> {
    if (!this.conn.connection) {
      this.conn.connection = await (new ConnectionPool(this.conn.dbConfig)).connect();
    }
    return run(this.conn.connection);
  }

  wrapIdentifier(value: string): string {
    return wrapIdentifier(value);
  }
}

export function wrapIdentifier(value: string): string {
  return (value !== '*' ? `[${value.replace(/\[/g, '[')}]` : '*');
}

function parseRowQueryResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: IRecordSet<any> | [],
  affectedRows: number | undefined,
  command: string
): QueryRowResult {
  // Fallback in case the identifier could not reconize the command
  const isSelect = !!(data.length || !affectedRows);

  return {
    command: command || <string>(isSelect && 'SELECT'),
    rows: data,
    fields: Object.keys(data[0] || {}).map((name) => ({ name })),
    rowCount: data.length,
    affectedRows,
  };
}
