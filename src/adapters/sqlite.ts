import sqlite3 from 'sqlite3';
import { identify, Result } from 'sql-query-identifier';

import createLogger from '../logger';
import { appendSemiColon } from '../utils';
import { Adapter, ADAPTERS } from './';
import { AbstractAdapter } from './abstract_adapter';

import type { RunResult } from 'sqlite3';

import type {
  QueryArgs,
  QueryRowResult,
  QueryReturn,
  ListTableColumnsResult,
  ListTableResult,
  ListViewResult
} from './abstract_adapter';
import type { Server } from '../server';
import type { Database } from '../database';

const logger = createLogger('db:clients:sqlite');

const sqliteErrors = {
  CANCELED: 'SQLITE_INTERRUPT',
};

interface QueryResult {
  data?: unknown[];
  lastID: number;
  changes: number;
  statement: Result;
}

export default class SqliteAdapter extends AbstractAdapter {
  conn: {
    dbConfig: {database: string;}
  };

  constructor(server: Server, database: Database) {
    super(server, database);

    const dbConfig = this.configDatabase();
    logger().debug('create adapter for sqlite3 with config %j', dbConfig);
    this.conn = {dbConfig};
  }

  configDatabase(): {database: string} {
    return {
      database: this.database.database || <string>(<Adapter>ADAPTERS.find(
        (adapter) => adapter.key === 'sqlite'
      )).defaultDatabase,
    };
  }

  // SQLite does not have connection poll. So we open and close connections
  // for every query request. This allows multiple request at same time by
  // using a different thread for each connection.
  // This may cause connection limit problem. So we may have to change this at some point.
  async connect(): Promise<void> {
    logger().debug('connecting');

    const result = <QueryResult>(await this.driverExecuteQuery({ query: 'SELECT sqlite_version() as version' }));
    if (!result.data || result.data?.length === 0) {
      throw new Error('Failed to fetch version information');
    }
    const version = (<{version: string}>result.data[0]).version;
    this.version = {
      name: 'SQLite',
      version,
      string: `SQLite ${version}`,
    };

    logger().debug('connected');
  }

  query(queryText: string): QueryReturn {
    let queryConnection: sqlite3.Database | null = null;

    return {
      execute: () => {
        return this.runWithConnection(async (connection: sqlite3.Database) => {
          try {
            queryConnection = connection;

            const result = await this.executeQuery(queryText, connection);

            return result;
          } catch (err) {
            if ((err as {code: string}).code === sqliteErrors.CANCELED) {
              (err as {sqlectronError: string}).sqlectronError = 'CANCELED_BY_USER';
            }

            throw err;
          }
        });
      },

      cancel: () => {
        if (!queryConnection) {
          throw new Error('Query not ready to be canceled');
        }

        queryConnection.interrupt();
      },
    };
  }

  async executeQuery(queryText: string, connection?: sqlite3.Database): Promise<QueryRowResult[]> {
    const result = await this.driverExecuteQuery({ query: queryText, multiple: true }, connection);

    return (<QueryResult[]>result).map((value) => {
      return parseRowQueryResult(value);
    });
  }

  async listTables(filter: unknown, connection?: sqlite3.Database): Promise<ListTableResult[]> {
    const sql = `
      SELECT name
      FROM sqlite_master
      WHERE type='table'
      ORDER BY name
    `;

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql }, connection);

    return <ListTableResult[]>data;
  }

  async listViews(): Promise<ListViewResult[]> {
    const sql = `
      SELECT name
      FROM sqlite_master
      WHERE type = 'view'
    `;

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql });

    return <ListViewResult[]>data;
  }

  async listTableColumns(table: string): Promise<ListTableColumnsResult[]> {
    const sql = `PRAGMA table_info('${table}')`;

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql });

    return (<{name: string, type: string}[]>data).map((row) => ({
      columnName: row.name,
      dataType: row.type,
    }));
  }

  async listTableTriggers(table: string): Promise<string[]> {
    const sql = `
      SELECT name
      FROM sqlite_master
      WHERE type = 'trigger'
        AND tbl_name = '${table}'
    `;

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql });

    return (<{name: string}[]>data).map((row) => row.name);
  }

  async listTableIndexes(table: string): Promise<string[]> {
    const sql = `PRAGMA INDEX_LIST('${table}')`;

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql });

    return (<{name: string}[]>data).map((row) => row.name);
  }

  async listDatabases(): Promise<string[]> {
    const sql = 'PRAGMA database_list;';

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql });

    return (<{file: string}[]>data).map((row) => row.file || ':memory:');
  }

  async getTableCreateScript(table: string): Promise<string[]> {
    const sql = `
      SELECT sql
      FROM sqlite_master
      WHERE name = '${table}';
    `;

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql });

    return (<{sql: string}[]>data).map((row) => appendSemiColon(row.sql));
  }

  async getViewCreateScript(view: string): Promise<string[]> {
    const sql = `
      SELECT sql
      FROM sqlite_master
      WHERE name = '${view}';
    `;

    const { data } = <QueryResult>await this.driverExecuteQuery({ query: sql });

    return (<{sql: string}[]>data).map((row) => row.sql);
  }

  async truncateAllTables(): Promise<void> {
    await this.runWithConnection(async (connection) => {
      const tables = await this.listTables(null, connection);

      const truncateAll = tables.map((table) => `
        DELETE FROM ${table.name};
      `).join('');

      // TODO: Check if sqlite_sequence exists then execute:
      // DELETE FROM sqlite_sequence WHERE name='${table}';

      await this.driverExecuteQuery({ query: truncateAll }, connection);
    });
  }

  async driverExecuteQuery(queryArgs: QueryArgs, connection?: sqlite3.Database): Promise<QueryResult | QueryResult[]> {
    const runQuery = (
      connection: sqlite3.Database,
      { executionType, text }: Result
    ): Promise<{data?: unknown[], lastID: number, changes: number}> => new Promise((resolve, reject) => {
      const method = resolveExecutionType(executionType);
      connection[method](text, queryArgs.params, function (err: Error | null, data?: unknown[]) {
        if (err) {
          return reject(err);
        }

        return resolve({
          data,
          lastID: (this as RunResult).lastID, // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
          changes: (this as RunResult).changes, // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
        });
      });
    });

    const identifyStatementsRunQuery = async (connection: sqlite3.Database): Promise<QueryResult | QueryResult[]> => {
      const statements = identifyCommands(queryArgs.query);

      const results = await Promise.all(
        statements.map(async (statement) => {
          const result = await runQuery(connection, statement);

          return {
            ...result,
            statement,
          };
        }),
      );

      return queryArgs.multiple ? results : results[0];
    };

    return connection
      ? identifyStatementsRunQuery(connection)
      : this.runWithConnection(identifyStatementsRunQuery);
  }

  runWithConnection<T>(run: (conn: sqlite3.Database) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.conn.dbConfig.database, (err) => {
        if (err) {
          reject(err);
          return;
        }

        db.serialize();
        run(db).then((results) => {
          resolve(results);
        }).catch((runErr) => {
          reject(runErr);
        }).finally(() => {
          db.close();
        });
      });
    });
  }

  wrapIdentifier(value: string): string {
    return wrapIdentifier(value);
  }
}

export function wrapIdentifier(value: string): string {
  if (value === '*') return value;
  const matched = /(.*?)(\[[0-9]\])/.exec(value);
  if (matched) return wrapIdentifier(matched[1]) + matched[2];
  return `"${value.replace(/"/g, '""')}"`;
}


function parseRowQueryResult({ data, statement, changes }: {
  data?: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
  statement: Result,
  changes: number,
}): QueryRowResult {
  // Fallback in case the identifier could not reconize the command
  const isSelect = Array.isArray(data);
  const rows = data || [];

  return {
    command: statement.type || (isSelect && 'SELECT'),
    rows,
    fields: Object.keys(rows[0] || {}).map((name) => ({ name })),
    rowCount: data && data.length,
    affectedRows: changes || 0,
  };
}


function identifyCommands(queryText: string) {
  try {
    return identify(queryText, { strict: false });
  } catch (err) {
    return [];
  }
}

function resolveExecutionType(executioType: string) {
  switch (executioType) {
    case 'MODIFICATION': return 'run';
    default: return 'all';
  }
}
