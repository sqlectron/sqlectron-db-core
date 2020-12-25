/*
const cassandra = require('./cassandra');
*/
import MysqlAdapter from './mysql';
import PostgresqlAdapter from './postgresql';
import SqliteAdapter from './sqlite';
import SqlServerAdapter from './sqlserver';
import type { AbstractAdapter } from './abstract_adapter';
import type { Database } from '../database';
import type { Server } from '../server';

interface Adapter {
  key: string;
  name: string;
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
    name: 'MySQL',
    defaultPort: 3306,
    disabledFeatures: [
      'server:schema',
      'server:domain',
    ],
  },
  {
    key: 'mariadb',
    name: 'MariaDB',
    defaultPort: 3306,
    disabledFeatures: [
      'server:schema',
      'server:domain',
    ],
  },
  {
    key: 'postgresql',
    name: 'PostgreSQL',
    defaultDatabase: 'postgres',
    defaultPort: 5432,
    disabledFeatures: [
      'server:domain',
    ],
  },
  {
    key: 'redshift',
    name: 'Redshift',
    defaultDatabase: 'postgres',
    defaultPort: 5432,
    disabledFeatures: [
      'server:domain',
    ],
  },
  {
    key: 'sqlserver',
    name: 'Microsoft SQL Server',
    defaultPort: 1433,
    disabledFeatures: [],
  },
  {
    key: 'sqlite',
    name: 'SQLite',
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
    name: 'Cassandra',
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


export function adapterFactory(
  adapter: string,
  server: Server,
  database: Database
): AbstractAdapter {
  switch (adapter) {
    case 'mysql':
    case 'mariadb':
      return new MysqlAdapter(server, database);
    case 'postgres':
    case 'redshift':
      return new PostgresqlAdapter(server, database);
    case 'sqlite':
      return new SqliteAdapter(server, database);
    case 'sqlserver':
      return new SqlServerAdapter(server, database);
    default:
      throw new Error(`Requested adapter for unknown adapter: ${adapter}`);
  }
}
