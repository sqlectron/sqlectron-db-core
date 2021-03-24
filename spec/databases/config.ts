import path from 'path';
import { ConnectionString } from 'connection-string';

const postgres = new ConnectionString(process.env.POSTGRES_DSN, {
  protocol: 'postgres',
  user: 'postgres',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [
    {
      name: process.env.POSTGRES_HOST || '127.0.0.1',
      port: parseInt(process.env.POSTGRES_PORT as string, 10),
    },
  ],
});

const redshift = new ConnectionString(process.env.REDSHIFT_DSN, {
  protocol: 'postgres',
  user: 'postgres',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [
    {
      name: process.env.REDSHIFT_HOST || '127.0.0.1',
      port: parseInt(process.env.REDSHIFT_PORT as string, 10),
    },
  ],
});

const mysql = new ConnectionString(process.env.MYSQL_DSN, {
  protocol: 'mysql',
  user: 'root',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [
    {
      name: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT as string, 10),
    },
  ],
});

const mariadb = new ConnectionString(process.env.MARIADB_DSN, {
  user: 'root',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [
    {
      name: process.env.MARIADB_HOST || 'localhost',
      port: parseInt(process.env.MARIADB_PORT as string, 10),
    },
  ],
});

const sqlserver = new ConnectionString(process.env.SQLSERVER_DSN, {
  protocol: 'mssql',
  user: 'sa',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [
    {
      name: process.env.SQLSERVER_HOST || 'localhost',
      port: parseInt(process.env.SQLSERVER_PORT as string, 10),
    },
  ],
});

const cassandra = new ConnectionString(process.env.CASSANDRA_DSN, {
  protocol: 'cassandra',
  path: ['sqlectron'],
  hosts: [
    {
      name: process.env.CASSANDRA_HOST || 'localhost',
      port: parseInt(process.env.CASSANDRA_PORT as string, 10),
    },
  ],
});

const dbs = {
  sqlite: {
    database: path.join(__dirname, 'sqlite', 'sqlectron.db'),
  },
  postgresql: {
    host: postgres.hostname,
    port: postgres.port || 5432,
    user: postgres.user,
    password: postgres.password,
    database: postgres.path?.[0],
  },
  redshift: {
    host: redshift.hostname,
    port: redshift.port || 5433,
    user: redshift.user,
    password: redshift.password,
    database: redshift.path?.[0],
  },
  mysql: {
    host: mysql.hostname,
    port: mysql.port || 3306,
    user: mysql.user,
    password: mysql.password,
    database: mysql.path?.[0],
  },
  mariadb: {
    host: mariadb.hostname,
    port: mariadb.port || 3307,
    user: mariadb.user,
    password: mariadb.password,
    database: mariadb.path?.[0],
  },
  sqlserver: {
    host: sqlserver.hostname,
    port: sqlserver.port || 1433,
    user: sqlserver.user,
    password: sqlserver.password,
    database: sqlserver.path?.[0],
  },
  cassandra: {
    host: <string>cassandra.hostname,
    port: cassandra.port || 9042,
    database: cassandra.path?.[0],
  },
};

export default dbs;
