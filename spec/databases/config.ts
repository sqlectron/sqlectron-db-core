import path from 'path';
import { ConnectionString } from 'connection-string';

const postgres = new ConnectionString(process.env.POSTGRES_DSN, {
  protocol: 'postgres',
  user: 'postgres',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [{ name: '127.0.0.1', port: 5432 }],
});
const redshift = new ConnectionString(process.env.REDSHIFT_DSN, {
  protocol: 'postgres',
  user: 'postgres',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [{ name: '127.0.0.1', port: 5433 }],
});
const mysql = new ConnectionString(process.env.MYSQL_DSN, {
  protocol: 'mysql',
  user: 'root',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [{ name: 'localhost', port: 3306 }],
});
const mariadb = new ConnectionString(process.env.MARIADB_DSN, {
  user: 'root',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [{ name: 'localhost', port: 3307 }],
});
const sqlserver = new ConnectionString(process.env.SQLSERVER_DSN, {
  protocol: 'mssql',
  user: 'sa',
  password: 'Password12!',
  path: ['sqlectron'],
  hosts: [{ name: 'localhost', port: 1433 }],
});
const cassandra = new ConnectionString(process.env.CASSANDRA_DSN, {
  protocol: 'cassandra',
  path: ['sqlectron'],
  hosts: [{ name: 'localhost', port: 9042 }],
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
  sqlserver:  {
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
