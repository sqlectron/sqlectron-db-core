import * as cassandra from 'cassandra-driver';
import { Database } from '../database';

import createLogger from '../logger';
import { Server } from '../server';
import { identifyCommands } from '../utils';
import { AbstractAdapter, QueryRowResult } from './abstract_adapter';

const logger = createLogger('db:clients:cassandra');

declare module 'cassandra-driver' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace metadata {
    interface Metadata {
      keyspaces: { [name: string]: { name: string, strategy: string }};
    }
  }
}

interface Config {
  contactPoints: (string)[];
  protocolOptions: {
    port?: number;
  };
  keyspace?: string;
  authProvider?: cassandra.auth.PlainTextAuthProvider;
}

/**
 * To keep compatibility with the other clients we treat keyspaces as database.
 */
export default class CassandraAdapter extends AbstractAdapter {
  client: cassandra.Client;
  constructor(server: Server, database: Database) {
    super(server, database);

    const dbConfig = this.configDatabase();

    logger().debug('creating database client %j', dbConfig);
    this.client = new cassandra.Client(dbConfig);
  }

  configDatabase(): Config {
    const config: Config = {
      contactPoints: [<string>this.server.config.host],
      protocolOptions: {
        port: this.server.config.port,
      },
      keyspace: this.database.database,
    };

    if (this.server.sshTunnel) {
      config.contactPoints = [<string>this.server.config.localHost];
      config.protocolOptions.port = this.server.config.localPort;
    }

    if (this.server.config.ssl) {
      // TODO: sslOptions
    }

    // client authentication
    if (this.server.config.user && this.server.config.password) {
      const user = this.server.config.user;
      const password = this.server.config.password;
      const authProviderInfo = new cassandra.auth.PlainTextAuthProvider(user, password);
      config.authProvider = authProviderInfo;
    }

    return config;
  }

  connect(): Promise<void> {
    logger().debug('connecting');
    return new Promise((resolve, reject) => {
      this.client.connect((err: unknown) => {
        if (err) {
          this.client.shutdown();
          return reject(err);
        }

        this.version = {
          name: 'Cassandra',
          version: this.client.getState().getConnectedHosts()[0].cassandraVersion,
          string: `Cassandra ${this.client.getState().getConnectedHosts()[0].cassandraVersion}`,
        };
        logger().debug('connected');
        resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.shutdown((err: unknown) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  listDatabases(): Promise<string[]> {
    return new Promise((resolve) => {
      resolve(Object.keys(this.client.metadata.keyspaces));
    });
  }

  listTables(): Promise<{name: string}[]> {
    return new Promise((resolve, reject) => {
      let sql;
      if (this.version.version[0] === '2') {
        sql = `
          SELECT columnfamily_name as name
          FROM system.schema_columnfamilies
          WHERE keyspace_name = ?
        `;
      } else {
        sql = `
          SELECT table_name as name
          FROM system_schema.tables
          WHERE keyspace_name = ?
        `;
      }

      const params = [this.database.database];
      this.client.execute(sql, params, (err, data) => {
        if (err) return reject(err);
        resolve(data.rows.map((row) => ({ name: row.name as string })));
      });
    });
  }

  listTableColumns(table: string): Promise<{
    columnName: string;
    dataType: string
  }[]> {
    const cassandra2 = this.version.version[0] === '2';
    return new Promise((resolve, reject) => {
      let sql;
      if (cassandra2) {
        sql = `
          SELECT type as position, column_name, validator as type
          FROM system.schema_columns
          WHERE keyspace_name = ?
            AND columnfamily_name = ?
        `;
      } else {
        sql = `
          SELECT position, column_name, type
          FROM system_schema.columns
          WHERE keyspace_name = ?
            AND table_name = ?
        `;
      }
      const params = [
        this.database.database,
        table,
      ];
      this.client.execute(sql, params, (err, data) => {
        if (err) return reject(err);
        resolve(
          data.rows
            // force pks be placed at the results beginning
            .sort((a, b) => {
              if (cassandra2) {
                return (+(a.position > b.position) || -(a.position < b.position));
              }
              return b.position - a.position;
            }).map((row) => {
              const rowType = cassandra2 ? mapLegacyDataTypes(row.type as string) : row.type as string;
              return {
                columnName: row.column_name as string,
                dataType: rowType,
              };
            }),
        );
      });
    });
  }

  getTableKeys(table: string): Promise<{
    constraintName: null;
    columnName: string;
    referencedTable: null;
    keyType: string;
  }[]> {
    return new Promise((resolve, reject) => {
      if (this.database.database === undefined) {
        return [];
      }
      this.client.metadata
      .getTable(this.database.database, table, (err: Error, tableInfo: {partitionKeys: {name: string}[]}) => {
        if (err) {
          return reject(err);
        }
        resolve(tableInfo
          .partitionKeys
          .map((key: {name: string}) => ({
            constraintName: null,
            columnName: key.name,
            referencedTable: null,
            keyType: 'PRIMARY KEY',
          })));
      });
    });
  }

  async truncateAllTables(): Promise<void> {
    const result = await this.listTables();
    const tables = result.map((table) => table.name);
    const promises = tables.map((t) => {
      if (this.database.database === undefined) {
        return;
      }
      const truncateSQL = `
        TRUNCATE TABLE ${this.wrapIdentifier(this.database.database)}.${this.wrapIdentifier(t)};
      `;
      return this.executeQuery(truncateSQL);
    });

    await Promise.all(promises);
  }

  query(): never {
    throw new Error('"query" function is not implementd by cassandra client.');
  }

  executeQuery(queryText: string): Promise<QueryRowResult[]> {
    const commands = identifyCommands(queryText).map((item) => item.type);

    return new Promise((resolve, reject) => {
      this.client.execute(queryText, (err, data) => {
        if (err) return reject(err);

        resolve([parseRowQueryResult(data, commands[0])]);
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

/**
 * The system schema of Casandra 2.x does not have data type, but only validator
 * classes. To make the behavior consistent with v3.x, we try to deduce the
 * correponding CQL data type using the validator name.
 */
function mapLegacyDataTypes(validator: string): string {
  const type = <string>validator.split('.').pop();
  switch (type) {
    case 'Int32Type':
    case 'LongType':
      return 'int';
    case 'UTF8Type':
      return 'text';
    case 'TimestampType':
    case 'DateType':
      return 'timestamp';
    case 'DoubleType':
      return 'double';
    case 'FloatType':
      return 'float';
    case 'UUIDType':
      return 'uuid';
    case 'CounterColumnType':
      return 'counter';
    default:
      logger().debug('validator %s is not yet mapped!', validator);
      return type;
  }
}

function parseRowQueryResult(data: cassandra.types.ResultSet, command: string): QueryRowResult {
  // Fallback in case the identifier could not reconize the command
  const isSelect = command ? command === 'SELECT' : Array.isArray(data.rows);
  return {
    command: command || <string>(isSelect && 'SELECT'),
    rows: data.rows || [],
    fields: data.columns || [],
    rowCount: isSelect ? (data.rowLength || 0) : undefined,
    affectedRows: !isSelect && !isNaN(data.rowLength) ? data.rowLength : undefined,
  };
}
