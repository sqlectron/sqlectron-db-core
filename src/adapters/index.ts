import CassandraAdapter from './cassandra';
import MysqlAdapter from './mysql';
import PostgresqlAdapter from './postgresql';
import SqliteAdapter from './sqlite';
import SqlServerAdapter from './sqlserver';
import type { AbstractAdapter } from './abstract_adapter';
import type { Database } from '../database';
import type { Server } from '../server';

export interface Adapter {
  key: string;
  name: string;
  protocol: string;
  adapter: typeof AbstractAdapter;
  defaultPort?: number;
  defaultDatabase?: string;
  disabledFeatures: string[];
}

/**
 * List of supported database adapters
 */
export const ADAPTERS: Adapter[] = [
  {
    key: 'mysql',
    protocol: 'mysql',
    name: 'MySQL',
    adapter: MysqlAdapter,
    defaultPort: 3306,
    disabledFeatures: ['server:schema', 'server:domain'],
  },
  {
    key: 'mariadb',
    protocol: 'mariadb',
    name: 'MariaDB',
    adapter: MysqlAdapter,
    defaultPort: 3306,
    disabledFeatures: ['server:schema', 'server:domain'],
  },
  {
    key: 'postgresql',
    protocol: 'postgres',
    name: 'PostgreSQL',
    adapter: PostgresqlAdapter,
    defaultDatabase: 'postgres',
    defaultPort: 5432,
    disabledFeatures: ['server:domain'],
  },
  {
    key: 'redshift',
    protocol: 'redshift',
    name: 'Redshift',
    adapter: PostgresqlAdapter,
    defaultDatabase: 'postgres',
    defaultPort: 5432,
    disabledFeatures: ['server:domain'],
  },
  {
    key: 'sqlserver',
    protocol: 'mssql',
    name: 'Microsoft SQL Server',
    adapter: SqlServerAdapter,
    defaultPort: 1433,
    disabledFeatures: [],
  },
  {
    key: 'sqlite',
    protocol: 'file',
    name: 'SQLite',
    adapter: SqliteAdapter,
    defaultDatabase: ':memory:',
    disabledFeatures: [
      'server:ssl',
      'server:host',
      'server:port',
      'server:socketPath',
      'server:user',
      'server:password',
      'server:schema',
      'server:domain',
      'server:ssh',
      'cancelQuery',
    ],
  },
  {
    key: 'cassandra',
    protocol: 'cassandra',
    name: 'Cassandra',
    adapter: CassandraAdapter,
    defaultPort: 9042,
    disabledFeatures: [
      'server:ssl',
      'server:socketPath',
      'server:schema',
      'server:domain',
      'scriptCreateTable',
      'cancelQuery',
    ],
  },
];

export function registerAdapter(adapter: Adapter): void {
  if (ADAPTERS.find((a) => adapter.key === a.key)) {
    throw new Error(`Adapter already registered with that key`);
  }
  ADAPTERS.push(adapter);
}

export function adapterFactory(
  adapterKey: string,
  server: Server,
  database: Database,
): AbstractAdapter {
  const adapter = ADAPTERS.find((a) => a.key === adapterKey);
  if (!adapter) {
    throw new Error(`Unknown requested adapter: ${adapterKey}`);
  }
  return new (adapter.adapter as { new (server: Server, database: Database): AbstractAdapter })(
    server,
    database,
  );
}
