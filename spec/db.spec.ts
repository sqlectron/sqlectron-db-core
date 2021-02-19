import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import config from './databases/config';
import setupSQLite from './databases/sqlite/setup';
import setupCassandra from './databases/cassandra/setup';
import * as db from '../src';
import { clearSelectLimit, setSelectLimit } from '../src/database';
import { versionCompare } from '../src/utils';
import type { Adapter } from '../src/adapters';
import type { Database } from '../src/database';
import type { Server } from '../src/server';

chai.use(chaiAsPromised);

type adapterType = 'sqlite' | 'postgresql' | 'redshift' | 'mysql' | 'mariadb' | 'sqlserver' | 'cassandra';

/**
 * List of supported DB adapters.
 * The "integration" tests will be executed for all supported DB adapters.
 * And ensure all these adapters has the same API and output results.
 */
const SUPPORTED_DB_ADAPTERS: adapterType[] = <adapterType[]>db.ADAPTERS.map((adapter) => adapter.key);

const dbSchemas: {[key: string]: string} = {
  redshift: 'public',
  postgresql: 'public',
  sqlserver: 'dbo',
};

/**
 * List of selected databases to be tested in the current task
 */
const dbsToTest: adapterType[] = <adapterType[]>(
  process.env.DB_ADAPTERS || process.env.DB_CLIENTS || ''
).split(',').filter((adapter) => !!adapter);

const postgresAdapters = ['postgresql', 'redshift'];
const mysqlAdapters = ['mysql', 'mariadb'];

describe('db', () => {
  const dbAdapters = dbsToTest.length ? dbsToTest : SUPPORTED_DB_ADAPTERS;
  if (dbAdapters.some((dbAdapter) => !SUPPORTED_DB_ADAPTERS.includes(dbAdapter))) {
    throw new Error('Invalid selected db adapter for tests');
  }

  if (dbAdapters.includes('sqlite')) {
    setupSQLite(config.sqlite);
  }
  if (dbAdapters.includes('cassandra')) {
    setupCassandra(config.cassandra);
  }

  dbAdapters.forEach((dbAdapter: adapterType) => {
    const dbSchema = dbSchemas[dbAdapter];

    describe(dbAdapter, () => {
      describe('.connect', () => {
        it(`should connect into a ${dbAdapter} database`, () => {
          const serverInfo = {
            ...config[dbAdapter],
            name: dbAdapter,
            adapter: dbAdapter,
          };

          const serverSession = db.createServer(serverInfo);
          const dbConn = serverSession.createConnection(serverInfo.database);

          return expect(dbConn.connect()).to.not.be.rejected;
        });

        it('should connect into server without database specified', () => {
          const serverInfo = {
            ...config[dbAdapter],
            database: (<Adapter>db.ADAPTERS.find((adapter) => adapter.key === dbAdapter)).defaultDatabase,
            name: dbAdapter,
            adapter: dbAdapter,
          };

          const serverSession = db.createServer(serverInfo);
          const dbConn = serverSession.createConnection(serverInfo.database);

          return expect(dbConn.connect()).to.not.be.rejected;
        });

        it('should connect into server using client key', () => {
          const serverInfo = {
            ...config[dbAdapter],
            name: dbAdapter,
            client: dbAdapter,
          };

          const serverSession = db.createServer(serverInfo);
          const dbConn = serverSession.createConnection(serverInfo.database);

          return expect(dbConn.connect()).to.not.be.rejected;
        })
      });

      describe('given is already connected', () => {
        const serverInfo = {
          ...config[dbAdapter],
          name: dbAdapter,
          adapter: dbAdapter,
        };

        let serverSession: Server;
        let dbConn: Database;
        beforeEach(() => {
          serverSession = db.createServer(serverInfo);
          dbConn = serverSession.createConnection(serverInfo.database);
          return dbConn.connect();
        });

        describe('.disconnect', () => {
          it('should close all connections in the pool', () => {
            dbConn.disconnect();
          });
        });

        describe('.getVersion', () => {
          it('should return version details', () => {
            const version = dbConn.getVersion();
            expect(dbConn.getVersion()).to.be.a('object');
            const expectedName = {
              postgresql: 'PostgreSQL',
              redshift: 'PostgreSQL', // redshift does not identify itself uniquely from postgres 8
              mysql: 'MySQL',
              mariadb: 'MariaDB',
              sqlite: 'SQLite',
              sqlserver: 'SQL Server',
              cassandra: 'Cassandra',
            };
            expect(version).to.have.property('name').to.contain(expectedName[dbAdapter]);
            expect(version).to.have.property('version').to.be.a('string').and.to.match(/(?:[0-9]\.?)+/);
            expect(version).to.have.property('string').to.be.a('string').and.to.be.not.empty;
          });
        });

        describe('.listDatabases', () => {
          it('should list all databases', async () => {
            const databases = await dbConn.listDatabases();
            if (dbAdapter === 'sqlite') {
              expect(databases[0]).to.match(/sqlectron\.db$/);
            } else {
              expect(databases).to.include.members(['sqlectron']);
            }
          });
        });

        describe('.listTables', () => {
          it('should list all tables', async () => {
            const tables = await dbConn.listTables({ schema: dbSchema });
            if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlserver') {
              expect(tables).to.eql([
                { schema: dbSchema, name: 'roles' },
                { schema: dbSchema, name: 'users' },
              ]);
            } else {
              expect(tables).to.eql([
                { name: 'roles' },
                { name: 'users' },
              ]);
            }
          });
        });

        if (dbAdapter !== 'cassandra') {
          describe('.listViews', () => {
            it('should list all views', async () => {
              const views = await dbConn.listViews({ schema: dbSchema });
              if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlserver') {
                expect(views).to.eql([
                  { schema: dbSchema, name: 'email_view' },
                ]);
              } else {
                expect(views).to.eql([
                  { name: 'email_view' },
                ]);
              }
            });
          });
        }

        describe('.listRoutines', () => {
          it('should list all routines with their type', async () => {
            const routines = await dbConn.listRoutines({ schema: dbSchema });
            const routine = dbAdapter === 'postgresql' ? routines[1] : routines[0];

            // Postgresql routine type is always function. SP do not exist
            // Futhermore, PostgreSQL is expected to have two functions in schema, because
            // additional one is needed for trigger
            if (dbAdapter === 'postgresql') {
              expect(routines).to.have.length(2);
              expect(routine).to.have.deep.property('routineType').to.eql('FUNCTION');
              expect(routine).to.have.deep.property('schema').to.eql(dbSchema);
            } else if (dbAdapter === 'redshift') {
              expect(routines).to.have.length(1);
              expect(routine).to.have.deep.property('routineType').to.eql('FUNCTION');
              expect(routine).to.have.deep.property('schema').to.eql(dbSchema);
            } else if (mysqlAdapters.includes(dbAdapter)) {
              expect(routines).to.have.length(1);
              expect(routine).to.have.deep.property('routineType').to.eql('PROCEDURE');
              expect(routine).to.not.have.deep.property('schema');
            } else if (dbAdapter === 'sqlserver') {
              expect(routines).to.have.length(1);
              expect(routine).to.have.deep.property('routineType').to.eql('PROCEDURE');
              expect(routine).to.have.deep.property('schema').to.eql(dbSchema);
            } else if (dbAdapter === 'cassandra' || dbAdapter === 'sqlite') {
              expect(routines).to.have.length(0);
            } else {
              throw new Error('Invalid db adapter');
            }
          });
        });

        describe('.listTableColumns', () => {
          it('should list all columns and their type from users table', async () => {
            const columns = await dbConn.listTableColumns('users');
            expect(columns).to.have.length(6);

            const column = (name: string) => columns.find((col) => col.columnName === name);

            /* eslint no-unused-expressions:0 */
            expect(column('id')).to.exist;
            expect(column('username')).to.exist;
            expect(column('email')).to.exist;
            expect(column('password')).to.exist;
            expect(column('role_id')).to.exist;
            expect(column('createdat')).to.exist;

            if (dbAdapter === 'sqlite') {
              expect(column('id')).to.have.property('dataType').to.have.string('INTEGER');
            } else {
              expect(column('id')).to.have.property('dataType').to.have.string('int');
            }

            // Each database may have different db types
            if (postgresAdapters.includes(dbAdapter)) {
              expect(column('username')).to.have.property('dataType').to.eql('text');
              expect(column('email')).to.have.property('dataType').to.eql('text');
              expect(column('password')).to.have.property('dataType').to.eql('text');
              expect(column('role_id')).to.have.property('dataType').to.eql('integer');
              expect(column('createdat')).to.have.property('dataType').to.eql('date');
            } else if (dbAdapter === 'sqlite') {
              expect(column('username')).to.have.property('dataType').to.eql('VARCHAR(45)');
              expect(column('email')).to.have.property('dataType').to.eql('VARCHAR(150)');
              expect(column('password')).to.have.property('dataType').to.eql('VARCHAR(45)');
              expect(column('role_id')).to.have.property('dataType').to.eql('INT');
              expect(column('createdat')).to.have.property('dataType').to.eql('DATETIME');
            } else if (dbAdapter === 'cassandra') {
              expect(column('username')).to.have.property('dataType').to.eql('text');
              expect(column('email')).to.have.property('dataType').to.eql('text');
              expect(column('password')).to.have.property('dataType').to.eql('text');
              expect(column('role_id')).to.have.property('dataType').to.eql('int');
              expect(column('createdat')).to.have.property('dataType').to.eql('timestamp');
            } else {
              expect(column('username')).to.have.property('dataType').to.eql('varchar');
              expect(column('email')).to.have.property('dataType').to.eql('varchar');
              expect(column('password')).to.have.property('dataType').to.eql('varchar');
              expect(column('role_id')).to.have.property('dataType').to.eql('int');
              expect(column('createdat')).to.have.property('dataType').to.eql('datetime');
            }
          });
        });

        describe('.listTableTriggers', () => {
          it('should list all table related triggers', async () => {
            const triggers = await dbConn.listTableTriggers('users');
            if (dbAdapter === 'cassandra' || dbAdapter === 'redshift') {
              expect(triggers).to.have.length(0);
            } else {
              expect(triggers).to.have.length(1);
              expect(triggers).to.include.members(['dummy_trigger']);
            }
          });
        });

        describe('.listTableIndexes', () => {
          it('should list all indexes', async () => {
            const indexes = await dbConn.listTableIndexes('users', dbSchema);
            if (dbAdapter === 'cassandra') {
              expect(indexes).to.have.length(0);
            } else if (dbAdapter === 'sqlite') {
              expect(indexes).to.have.length(1);
              expect(indexes).to.include.members(['users_id_index']);
            } else if (postgresAdapters.includes(dbAdapter)) {
              expect(indexes).to.have.length(1);
              expect(indexes).to.include.members(['users_pkey']);
            } else if (mysqlAdapters.includes(dbAdapter)) {
              expect(indexes).to.have.length(2);
              expect(indexes).to.include.members(['PRIMARY', 'role_id']);
            } else if (dbAdapter === 'sqlserver') {
              expect(indexes).to.have.length(1);
              expect(indexes[0]).to.match(/^PK__users__/i);
            } else {
              throw new Error('Invalid db adapter');
            }
          });
        });

        describe('.listSchemas', () => {
          it('should list all schema', async () => {
            const schemas = await dbConn.listSchemas({ schema: { only: [dbSchema, 'dummy_schema'] } });
            if (postgresAdapters.includes(dbAdapter)) {
              expect(schemas).to.have.length(2);
              expect(schemas).to.include.members([dbSchema, 'dummy_schema']);
            } else if (dbAdapter === 'sqlserver') {
              expect(schemas).to.include('dummy_schema');
            } else {
              expect(schemas).to.have.length(0);
            }
          });
        });

        describe('.getTableReferences', () => {
          it('should list all tables that selected table has references to', async () => {
            const references = await dbConn.getTableReferences('users');
            if (dbAdapter === 'cassandra' || dbAdapter === 'sqlite') {
              expect(references).to.have.length(0);
            } else {
              expect(references).to.have.length(1);
              expect(references).to.include.members(['roles']);
            }
          });
        });

        describe('.getTableKeys', () => {
          it('should list all tables keys', async () => {
            const tableKeys = await dbConn.getTableKeys('users');
            if (dbAdapter === 'cassandra') {
              expect(tableKeys).to.have.length(1);
            } else if (dbAdapter === 'sqlite') {
              expect(tableKeys).to.have.length(0);
            } else {
              expect(tableKeys).to.have.length(2);
            }

            tableKeys.forEach((key) => {
              if (key.keyType === 'PRIMARY KEY') {
                expect(key).to.have.property('columnName').to.eql('id');
                expect(key).to.have.property('referencedTable').to.be.a('null');
              } else {
                expect(key).to.have.property('columnName').to.eql('role_id');
                expect(key).to.have.property('referencedTable').to.eql('roles');
                expect(key).to.have.property('keyType').to.eql('FOREIGN KEY');
              }
            });
          });
        });

        describe('.getTableCreateScript', () => {
          it('should return table create script', async () => {
            const [createScript] = await dbConn.getTableCreateScript('users');

            if (dbAdapter === 'mysql' && versionCompare(dbConn.getVersion().version, '8') >= 0) {
              expect(createScript).to.eql('CREATE TABLE `users` (\n' +
              '  `id` int NOT NULL AUTO_INCREMENT,\n' +
              '  `username` varchar(45) DEFAULT NULL,\n' +
              '  `email` varchar(150) DEFAULT NULL,\n' +
              '  `password` varchar(45) DEFAULT NULL,\n' +
              '  `role_id` int DEFAULT NULL,\n' +
              '  `createdat` datetime DEFAULT NULL,\n' +
              '  PRIMARY KEY (`id`),\n' +
              '  KEY `role_id` (`role_id`),\n' +
              '  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE\n' +
              ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;');
            } else if (mysqlAdapters.includes(dbAdapter)) {
              const charset = dbAdapter === 'mysql' ? 'latin1' : 'utf8mb4';
              expect(createScript).to.eql('CREATE TABLE `users` (\n' +
                '  `id` int(11) NOT NULL AUTO_INCREMENT,\n' +
                '  `username` varchar(45) DEFAULT NULL,\n' +
                '  `email` varchar(150) DEFAULT NULL,\n' +
                '  `password` varchar(45) DEFAULT NULL,\n' +
                '  `role_id` int(11) DEFAULT NULL,\n' +
                '  `createdat` datetime DEFAULT NULL,\n' +
                '  PRIMARY KEY (`id`),\n' +
                '  KEY `role_id` (`role_id`),\n' +
                '  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE\n' +
                `) ENGINE=InnoDB DEFAULT CHARSET=${charset};`);
            } else if (postgresAdapters.includes(dbAdapter)) {
              expect(createScript).to.eql('CREATE TABLE public.users (\n' +
                '  id integer NOT NULL,\n' +
                '  username text NOT NULL,\n' +
                '  email text NOT NULL,\n' +
                `  ${dbAdapter === 'postgresql' ? 'password' : '"password"'} text NOT NULL,\n` +
                '  role_id integer NULL,\n' +
                '  createdat date NULL\n' +
                ');\n' +
                '\n' +
                'ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);',
              );
            } else if (dbAdapter === 'sqlserver') {
              expect(createScript).to.contain('CREATE TABLE users (\r\n' +
                '  id int IDENTITY(1,1) NOT NULL,\r\n' +
                '  username varchar(45)  NULL,\r\n' +
                '  email varchar(150)  NULL,\r\n' +
                '  password varchar(45)  NULL,\r\n' +
                '  role_id int  NULL,\r\n' +
                '  createdat datetime  NULL,\r\n' +
                ')\r\n');
              expect(createScript).to.contain('ALTER TABLE users ADD CONSTRAINT PK__users');
              expect(createScript).to.contain('PRIMARY KEY (id)');
            } else if (dbAdapter === 'sqlite') {
              expect(createScript).to.eql('CREATE TABLE users (\n' +
                '  id INTEGER NOT NULL,\n' +
                '  username VARCHAR(45) NULL,\n' +
                '  email VARCHAR(150) NULL,\n' +
                '  password VARCHAR(45) NULL,\n' +
                '  role_id INT,\n' +
                '  createdat DATETIME NULL,\n' +
                '  PRIMARY KEY (id),\n' +
                '  FOREIGN KEY (role_id) REFERENCES roles (id)\n);',
              );
            } else if (dbAdapter === 'cassandra') {
              expect(createScript).to.eql(undefined);
            } else {
              throw new Error('Invalid db adapter');
            }
          });
        });

        describe('.getTableSelectScript', () => {
          it('should return SELECT table script', async () => {
            const selectQuery = await dbConn.getTableSelectScript('users');
            if (mysqlAdapters.includes(dbAdapter)) {
              expect(selectQuery).to.eql('SELECT `id`, `username`, `email`, `password`, `role_id`, `createdat` FROM `users`;');
            } else if (dbAdapter === 'sqlserver') {
              expect(selectQuery).to.eql('SELECT [id], [username], [email], [password], [role_id], [createdat] FROM [users];');
            } else if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlite') {
              expect(selectQuery).to.eql('SELECT "id", "username", "email", "password", "role_id", "createdat" FROM "users";');
            } else if (dbAdapter === 'cassandra') {
              expect(selectQuery).to.eql('SELECT "id", "createdat", "email", "password", "role_id", "username" FROM "users";');
            } else {
              throw new Error('Invalid db adapter');
            }
          });

          it('should return SELECT table script with schema if defined', async () => {
            const selectQuery = await dbConn.getTableSelectScript('users', 'public');
            if (dbAdapter === 'sqlserver') {
              expect(selectQuery).to.eql('SELECT [id], [username], [email], [password], [role_id], [createdat] FROM [public].[users];');
            } else if (postgresAdapters.includes(dbAdapter)) {
              expect(selectQuery).to.eql('SELECT "id", "username", "email", "password", "role_id", "createdat" FROM "public"."users";');
            }
          });
        });


        describe('.getTableInsertScript', () => {
          it('should return INSERT INTO table script', async () => {
            const insertQuery = await dbConn.getTableInsertScript('users');
            if (mysqlAdapters.includes(dbAdapter)) {
              expect(insertQuery).to.eql([
                'INSERT INTO `users` (`id`, `username`, `email`, `password`, `role_id`, `createdat`)\n',
                'VALUES (?, ?, ?, ?, ?, ?);',
              ].join(' '));
            } else if (dbAdapter === 'sqlserver') {
              expect(insertQuery).to.eql([
                'INSERT INTO [users] ([id], [username], [email], [password], [role_id], [createdat])\n',
                'VALUES (?, ?, ?, ?, ?, ?);',
              ].join(' '));
            } else if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlite') {
              expect(insertQuery).to.eql([
                'INSERT INTO "users" ("id", "username", "email", "password", "role_id", "createdat")\n',
                'VALUES (?, ?, ?, ?, ?, ?);',
              ].join(' '));
            } else if (dbAdapter === 'cassandra') {
              expect(insertQuery).to.eql([
                'INSERT INTO "users" ("id", "createdat", "email", "password", "role_id", "username")\n',
                'VALUES (?, ?, ?, ?, ?, ?);',
              ].join(' '));
            } else {
              throw new Error('Invalid db adapter');
            }
          });

          it('should return INSERT INTO table script with schema if defined', async () => {
            const insertQuery = await dbConn.getTableInsertScript('users', 'public');
            if (dbAdapter === 'sqlserver') {
              expect(insertQuery).to.eql([
                'INSERT INTO [public].[users] ([id], [username], [email], [password], [role_id], [createdat])\n',
                'VALUES (?, ?, ?, ?, ?, ?);',
              ].join(' '));
            } else if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlite') {
              expect(insertQuery).to.eql([
                'INSERT INTO "public"."users" ("id", "username", "email", "password", "role_id", "createdat")\n',
                'VALUES (?, ?, ?, ?, ?, ?);',
              ].join(' '));
            }
          });
        });

        describe('.getTableUpdateScript', () => {
          it('should return UPDATE table script', async () => {
            const updateQuery = await dbConn.getTableUpdateScript('users');
            if (dbAdapter === 'mysql' || dbAdapter === 'mariadb') {
              expect(updateQuery).to.eql([
                'UPDATE `users`\n',
                'SET `id`=?, `username`=?, `email`=?, `password`=?, `role_id`=?, `createdat`=?\n',
                'WHERE <condition>;',
              ].join(' '));
            } else if (dbAdapter === 'sqlserver') {
              expect(updateQuery).to.eql([
                'UPDATE [users]\n',
                'SET [id]=?, [username]=?, [email]=?, [password]=?, [role_id]=?, [createdat]=?\n',
                'WHERE <condition>;',
              ].join(' '));
            } else if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlite') {
              expect(updateQuery).to.eql([
                'UPDATE "users"\n',
                'SET "id"=?, "username"=?, "email"=?, "password"=?, "role_id"=?, "createdat"=?\n',
                'WHERE <condition>;',
              ].join(' '));
            } else if (dbAdapter === 'cassandra') {
              expect(updateQuery).to.eql([
                'UPDATE "users"\n',
                'SET "id"=?, "createdat"=?, "email"=?, "password"=?, "role_id"=?, "username"=?\n',
                'WHERE <condition>;',
              ].join(' '));
            } else {
              throw new Error('Invalid db adapter');
            }
          });

          it('should return UPDATE table script with schema if defined', async () => {
            const updateQuery = await dbConn.getTableUpdateScript('users', 'public');
            if (dbAdapter === 'sqlserver') {
              expect(updateQuery).to.eql([
                'UPDATE [public].[users]\n',
                'SET [id]=?, [username]=?, [email]=?, [password]=?, [role_id]=?, [createdat]=?\n',
                'WHERE <condition>;',
              ].join(' '));
            } else if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlite') {
              expect(updateQuery).to.eql([
                'UPDATE "public"."users"\n',
                'SET "id"=?, "username"=?, "email"=?, "password"=?, "role_id"=?, "createdat"=?\n',
                'WHERE <condition>;',
              ].join(' '));
            }
          });
        });

        describe('.getTableDeleteScript', () => {
          it('should return table DELETE script', async () => {
            const deleteQuery = await dbConn.getTableDeleteScript('roles');
            if (dbAdapter === 'mysql' || dbAdapter === 'mariadb') {
              expect(deleteQuery).to.contain('DELETE FROM `roles` WHERE <condition>;');
            } else if (dbAdapter === 'sqlserver') {
              expect(deleteQuery).to.contain('DELETE FROM [roles] WHERE <condition>;');
            } else if (postgresAdapters.includes(dbAdapter) || dbAdapter === 'sqlite') {
              expect(deleteQuery).to.contain('DELETE FROM "roles" WHERE <condition>;');
            } else if (dbAdapter === 'cassandra') {
              expect(deleteQuery).to.contain('DELETE FROM "roles" WHERE <condition>;');
            } else {
              throw new Error('Invalid db adapter');
            }
          });

          it('should return table DELETE script with schema if defined', async () => {
            const deleteQuery = await dbConn.getTableDeleteScript('roles', 'public');
            if (dbAdapter === 'sqlserver') {
              expect(deleteQuery).to.contain('DELETE FROM [public].[roles] WHERE <condition>;');
            } else if (postgresAdapters.includes(dbAdapter)) {
              expect(deleteQuery).to.contain('DELETE FROM "public"."roles" WHERE <condition>;');
            }
          });
        });

        describe('.getViewCreateScript', () => {
          it('should return CREATE VIEW script', async () => {
            const [createScript] = await dbConn.getViewCreateScript('email_view');
            if (mysqlAdapters.includes(dbAdapter)) {
              expect(createScript).to.contain([
                'VIEW `email_view`',
                'AS select `users`.`email` AS `email`,`users`.`password` AS `password`',
                'from `users`;',
              ].join(' '));
            } else if (dbAdapter === 'postgresql') {
              expect(createScript).to.eql([
                'CREATE OR REPLACE VIEW "public".email_view AS',
                ' SELECT users.email,',
                '    users.password',
                '   FROM users;',
              ].join('\n'));
            } else if (dbAdapter === 'redshift') {
              expect(createScript).to.eql([
                'CREATE OR REPLACE VIEW "public".email_view AS',
                ' SELECT users.email, users."password"',
                '   FROM users;',
              ].join('\n'));
            } else if (dbAdapter === 'sqlserver') {
              expect(createScript).to.eql([
                '\nCREATE VIEW dbo.email_view AS',
                'SELECT dbo.users.email, dbo.users.password',
                'FROM dbo.users;\n',
              ].join('\n'));
            } else if (dbAdapter === 'sqlite') {
              expect(createScript).to.eql([
                'CREATE VIEW email_view AS',
                '  SELECT users.email, users.password',
                '  FROM users;',
              ].join('\n'));
            } else if (dbAdapter === 'cassandra') {
              expect(createScript).to.eql(undefined);
            } else {
              throw new Error('Invalid db adapter');
            }
          });
        });

        describe('.getRoutineCreateScript', () => {
          it('should return CREATE PROCEDURE/FUNCTION script', async () => {
            const [createScript] = await dbConn.getRoutineCreateScript('users_count', 'Procedure');
            if (mysqlAdapters.includes(dbAdapter)) {
              expect(createScript).to.contain('CREATE DEFINER=');
              expect(createScript).to.contain([
                'PROCEDURE `users_count`()',
                'BEGIN',
                '  SELECT COUNT(*) FROM users;',
                'END',
              ].join('\n'));
            } else if (dbAdapter === 'postgresql') {
              expect(createScript).to.eql([
                'CREATE OR REPLACE FUNCTION public.users_count()',
                ' RETURNS bigint',
                ' LANGUAGE sql',
                'AS $function$',
                '  SELECT COUNT(*) FROM users AS total;',
                '$function$;',
              ].join('\n'));
            } else if (dbAdapter === 'redshift') {
              expect(createScript).to.eql([
                'CREATE OR REPLACE FUNCTION public.users_count()',
                '  RETURNS bigint AS $$',
                '  SELECT COUNT(*) FROM users AS total;',
                '$$ LANGUAGE sql VOLATILE;',
              ].join('\n'));
            } else if (dbAdapter === 'sqlserver') {
              expect(createScript).to.contain('CREATE PROCEDURE dbo.users_count');
              expect(createScript).to.contain('@Count int OUTPUT');
              expect(createScript).to.contain('SELECT @Count = COUNT(*) FROM dbo.users');
            } else if (dbAdapter === 'cassandra' || dbAdapter === 'sqlite') {
              expect(createScript).to.eql(undefined);
            } else {
              throw new Error('Invalid db adapter');
            }
          });
        });

        describe('.getQuerySelectTop', () => {
          afterEach(() => {
            clearSelectLimit();
          });

          it('should return select with default limit', async () => {
            const sql = await dbConn.getQuerySelectTop('test_table');
            if (mysqlAdapters.includes(dbAdapter)) {
              expect(sql).to.eql('SELECT * FROM `test_table` LIMIT 1000');
            } else if (postgresAdapters.includes(dbAdapter)) {
              expect(sql).to.eql('SELECT * FROM "public"."test_table" LIMIT 1000');
            } else if (dbAdapter === 'sqlite' || dbAdapter === 'cassandra') {
              expect(sql).to.eql('SELECT * FROM "test_table" LIMIT 1000');
            } else if (dbAdapter === 'sqlserver') {
              expect(sql).to.eql('SELECT TOP 1000 * FROM [test_table]');
            } else {
              throw new Error('Invalid db adapter');
            }
          });

          it('should return select with limit from config', async () => {
            setSelectLimit(125);
            const sql = await dbConn.getQuerySelectTop('test_table');
            if (mysqlAdapters.includes(dbAdapter)) {
              expect(sql).to.eql('SELECT * FROM `test_table` LIMIT 125');
            } else if (postgresAdapters.includes(dbAdapter)) {
              expect(sql).to.eql('SELECT * FROM "public"."test_table" LIMIT 125');
            } else if (dbAdapter === 'sqlite' || dbAdapter === 'cassandra') {
              expect(sql).to.eql('SELECT * FROM "test_table" LIMIT 125');
            } else if (dbAdapter === 'sqlserver') {
              expect(sql).to.eql('SELECT TOP 125 * FROM [test_table]');
            } else {
              throw new Error('Invalid db adapter');
            }
          });

          it('should return select with limit from parameters', async () => {
            const sql = await dbConn.getQuerySelectTop('test_table', 'public', 222);
            if (mysqlAdapters.includes(dbAdapter)) {
              expect(sql).to.eql('SELECT * FROM `test_table` LIMIT 222');
            } else if (postgresAdapters.includes(dbAdapter)) {
              expect(sql).to.eql('SELECT * FROM "public"."test_table" LIMIT 222');
            } else if (dbAdapter === 'sqlite' || dbAdapter === 'cassandra') {
              expect(sql).to.eql('SELECT * FROM "test_table" LIMIT 222');
            } else if (dbAdapter === 'sqlserver') {
              expect(sql).to.eql('SELECT TOP 222 * FROM [test_table]');
            } else {
              throw new Error('Invalid db adapter');
            }
          });
        });

        if (dbAdapter !== 'cassandra') {
          describe('.query', function () { // eslint-disable-line func-names
            this.timeout(15000);

            it('should be able to cancel the current query', (done) => {
              const sleepCommands = {
                postgresql: 'SELECT pg_sleep(10);',
                redshift: '',
                mysql: 'SELECT SLEEP(10000);',
                mariadb: 'SELECT SLEEP(10000);',
                sqlserver: 'WAITFOR DELAY \'00:00:10\'; SELECT 1 AS number',
                sqlite: '',
              };

              // SQLite and Redshift both do not have a way to run a sleep query.
              // Instead, we have to generate a query that will select a huge
              // data source, and take longer than 5 seconds to run. For SQLite,
              // that means doing a large select on the same table multiple times.
              // For redshift, we just run a ton of queries.
              if (dbAdapter === 'sqlite') {
                const fromTables = [];
                for (let i = 0; i < 50; i++) {
                  fromTables.push('sqlite_master');
                }
                sleepCommands.sqlite = `SELECT last.name FROM ${fromTables.join(',')} as last`;
              } else if (dbAdapter === 'redshift') {
                const queries = [];
                for (let i = 0; i < 50000; i++) {
                  queries.push(`
                    SELECT col.*, tab.*
                    FROM information_schema.columns AS col
                    INNER JOIN information_schema.tables AS tab ON col.table_schema = tab.table_schema AND col.table_name = tab.table_name
                  `);
                }
                sleepCommands.redshift = queries.join(';');
              }

              const query = dbConn.query(sleepCommands[dbAdapter]);
              const executing = query.execute();

              // wait a 5 secs before cancel
              setTimeout(() => {
                Promise.all([
                  executing,
                  query.cancel(),
                ]).then(() => {
                  done(false);
                }).catch((err) => {
                  expect(err).to.exist;
                  expect((err as {sqlectronError: string}).sqlectronError).to.eql('CANCELED_BY_USER');
                  done();
                });
              }, 5000);
            });
          });

          it('should query single result from function', async () => {
            const query = dbConn.query('SELECT CURRENT_TIMESTAMP');
            const result = await query.execute();
            expect((result[0].rows as unknown[])[0]).to.be.not.null;
            expect(result[0].rowCount).to.eql(1);
            let expected;
            if (dbAdapter === 'sqlserver') {
              expected = 1;
            } else if (dbAdapter === 'sqlite') {
              expected = 0;
            }
            expect(result[0].affectedRows).to.eql(expected);
          });
        }

        describe('.executeQuery', () => {
          const includePk = dbAdapter === 'cassandra';

          beforeEach(async () => {
            await dbConn.executeQuery(`
              INSERT INTO roles (${includePk ? 'id,' : ''} name)
              VALUES (${includePk ? '1,' : ''} 'developer')
            `);

            await dbConn.executeQuery(`
              INSERT INTO users (${includePk ? 'id,' : ''} username, email, password, role_id, createdat)
              VALUES (${includePk ? '1,' : ''} 'maxcnunes', 'maxcnunes@gmail.com', '123456', 1,'2016-10-25')
            `);
          });

          afterEach(async () => {
            await dbConn.truncateAllTables();
          });

          describe('SELECT', () => {
            it('should execute an empty query', async () => {
              try {
                const results = await dbConn.executeQuery('');
                expect(results).to.have.length(0);
              } catch (err) {
                if (dbAdapter === 'cassandra') {
                  expect((err as {message: string}).message).to.eql('line 0:-1 no viable alternative at input \'<EOF>\'');
                } else {
                  throw err;
                }
              }
            });

            it('should execute an query with only comments', async () => {
              try {
                const results = await dbConn.executeQuery('-- my comment');

                // MySQL treats commented query as a non select query
                if (dbAdapter === 'mysql' || dbAdapter === 'mariadb') {
                  expect(results).to.have.length(1);
                } else {
                  expect(results).to.have.length(0);
                }
              } catch (err) {
                if (dbAdapter === 'cassandra') {
                  if (versionCompare(dbConn.getVersion().version, '2') === 0) {
                    expect((err as {message: string}).message).to.eql('line 0:-1 no viable alternative at input \'<EOF>\'');
                  } else {
                    expect((err as {message: string}).message).to.eql('line 1:13 mismatched character \'<EOF>\' expecting set null');
                  }
                } else {
                  throw err;
                }
              }
            });

            it('should execute a single query with empty result', async () => {
              const results = await dbConn.executeQuery('select * from users where id = 0');

              expect(results).to.have.length(1);
              const [result] = results;

              // MSSQL/SQLite does not return the fields when the result is empty.
              // For those DBs that return the field names even when the result
              // is empty we should ensure all fields are included.
              if (dbAdapter === 'sqlserver' || dbAdapter === 'sqlite') {
                expect(result).to.have.property('fields').to.eql([]);
              } else {
                const field = (name: string) => {
                  return (<{name: string}[]>result.fields).find(
                    (item) => item.name === name
                  );
                };

                expect(field('id')).to.exist;
                expect(field('username')).to.exist;
                expect(field('email')).to.exist;
                expect(field('password')).to.exist;
              }

              expect(result).to.have.property('command').to.eql('SELECT');
              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.deep.property('rowCount').to.eql(0);
            });

            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery('select * from users');

              expect(results).to.have.length(1);
              const [result] = results;
              const field = (name: string) => {
                return (<{name: string}[]>result.fields).find(
                  (item) => item.name === name
                );
              };

              expect(field('id')).to.exist;
              expect(field('username')).to.exist;
              expect(field('email')).to.exist;
              expect(field('password')).to.exist;
              expect(field('role_id')).to.exist;
              expect(field('createdat')).to.exist;

              expect(result).to.have.nested.property('rows[0].id').to.eql(1);
              expect(result).to.have.nested.property('rows[0].username').to.eql('maxcnunes');
              expect(result).to.have.nested.property('rows[0].password').to.eql('123456');
              expect(result).to.have.nested.property('rows[0].email').to.eql('maxcnunes@gmail.com');
              expect(result).to.have.nested.property('rows[0].createdat');

              expect(result).to.have.property('command').to.eql('SELECT');
              expect(result).to.have.deep.property('rowCount').to.eql(1);
            });

            if (postgresAdapters.includes(dbAdapter) || mysqlAdapters.includes(dbAdapter)) {
              it('should not cast DATE types to native JS Date objects', async () => {
                const results = await dbConn.executeQuery('select createdat from users');

                expect(results).to.have.length(1);
                const [result] = results;

                expect(result).to.have.nested.property('fields[0].name').to.eql('createdat');
                expect(result).to.have.nested.property('rows[0].createdat').to.match(/^2016-10-25/);
              });
            }

            it('should execute multiple queries', async () => {
              try {
                const results = await dbConn.executeQuery(`
                  select * from users;
                  select * from roles;
                `);

                expect(results).to.have.length(2);
                const [firstResult, secondResult] = results;

                expect(firstResult).to.have.nested.property('fields[0].name').to.eql('id');
                expect(firstResult).to.have.nested.property('fields[1].name').to.eql('username');
                expect(firstResult).to.have.nested.property('fields[2].name').to.eql('email');
                expect(firstResult).to.have.nested.property('fields[3].name').to.eql('password');

                expect(firstResult).to.have.nested.property('rows[0].id').to.eql(1);
                expect(firstResult).to.have.nested.property('rows[0].username').to.eql('maxcnunes');
                expect(firstResult).to.have.nested.property('rows[0].password').to.eql('123456');
                expect(firstResult).to.have.nested.property('rows[0].email').to.eql('maxcnunes@gmail.com');

                expect(firstResult).to.have.property('command').to.eql('SELECT');
                expect(firstResult).to.have.deep.property('rowCount').to.eql(1);

                expect(secondResult).to.have.nested.property('fields[0].name').to.eql('id');
                expect(secondResult).to.have.nested.property('fields[1].name').to.eql('name');

                expect(secondResult).to.have.nested.property('rows[0].id').to.eql(1);
                expect(secondResult).to.have.nested.property('rows[0].name').to.eql('developer');

                expect(secondResult).to.have.property('command').to.eql('SELECT');
                expect(secondResult).to.have.deep.property('rowCount').to.eql(1);
              } catch (err) {
                if (dbAdapter === 'cassandra') {
                  if (versionCompare(dbConn.getVersion().version, '3.10') >= 0) {
                    expect((err as {message: string}).message).to.match(/mismatched input 'select' expecting EOF/);
                  } else {
                    expect((err as {message: string}).message).to.match(/missing EOF at 'select'/);
                  }
                } else {
                  throw err;
                }
              }
            });
          });

          describe('INSERT', () => {
            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery(`
                insert into users (${includePk ? 'id,' : ''} username, email, password)
                values (${includePk ? '1,' : ''} 'user', 'user@hotmail.com', '123456')
              `);

              expect(results).to.have.length(1);
              const [result] = results;

              expect(result).to.have.property('command').to.eql('INSERT');
              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.property('fields').to.eql([]);

              // Cassandra does not return affectedRows
              if (dbAdapter === 'cassandra') {
                expect(result).to.have.property('affectedRows').to.eql(undefined);
              } else {
                expect(result).to.have.property('affectedRows').to.eql(1);
              }

              // MSSQL does not return row count
              // so this value is based in the number of rows
              if (dbAdapter === 'sqlserver') {
                expect(result).to.have.property('rowCount').to.eql(0);
              } else {
                expect(result).to.have.property('rowCount').to.eql(undefined);
              }
            });

            it('should execute multiple queries', async () => {
              try {
                const results = await dbConn.executeQuery(`
                  insert into users (username, email, password)
                  values ('user', 'user@hotmail.com', '123456');

                  insert into roles (name)
                  values ('manager');
                `);

                // MSSQL treats multiple non select queries as a single query result
                if (dbAdapter === 'sqlserver') {
                  expect(results).to.have.length(1);
                  const [result] = results;

                  expect(result).to.have.property('command').to.eql('INSERT');
                  expect(result).to.have.property('rows').to.eql([]);
                  expect(result).to.have.property('fields').to.eql([]);
                  expect(result).to.have.property('rowCount').to.eql(0);
                  expect(result).to.have.property('affectedRows').to.eql(2);
                } else {
                  expect(results).to.have.length(2);
                  const [firstResult, secondResult] = results;

                  expect(firstResult).to.have.property('command').to.eql('INSERT');
                  expect(firstResult).to.have.property('rows').to.eql([]);
                  expect(firstResult).to.have.property('fields').to.eql([]);
                  expect(firstResult).to.have.property('rowCount').to.eql(undefined);
                  expect(firstResult).to.have.property('affectedRows').to.eql(1);

                  expect(secondResult).to.have.property('command').to.eql('INSERT');
                  expect(secondResult).to.have.property('rows').to.eql([]);
                  expect(secondResult).to.have.property('fields').to.eql([]);
                  expect(secondResult).to.have.property('rowCount').to.eql(undefined);
                  expect(secondResult).to.have.property('affectedRows').to.eql(1);
                }
              } catch (err) {
                if (dbAdapter === 'cassandra') {
                  if (versionCompare(dbConn.getVersion().version, '3.10') >= 0) {
                    expect((err as {message: string}).message).to.match(/mismatched input 'insert' expecting EOF/);
                  } else {
                    expect((err as {message: string}).message).to.match(/missing EOF at 'insert'/);
                  }
                } else {
                  throw err;
                }
              }
            });
          });

          describe('DELETE', () => {
            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery(`
                delete from users where id = 1
              `);

              expect(results).to.have.length(1);
              const [result] = results;

              expect(result).to.have.property('command').to.eql('DELETE');
              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.property('fields').to.eql([]);

              // Cassandra does not return affectedRows
              if (dbAdapter === 'cassandra') {
                expect(result).to.have.property('affectedRows').to.eql(undefined);
              } else {
                expect(result).to.have.property('affectedRows').to.eql(1);
              }

              // MSSQL does not return row count
              // so these value is based in the number of rows
              if (dbAdapter === 'sqlserver') {
                expect(result).to.have.property('rowCount').to.eql(0);
              } else {
                expect(result).to.have.property('rowCount').to.eql(undefined);
              }
            });

            it('should execute multiple queries', async () => {
              try {
                const results = await dbConn.executeQuery(`
                  delete from users where username = 'maxcnunes';
                  delete from roles where name = 'developer';
                `);

                // MSSQL treats multiple non select queries as a single query result
                if (dbAdapter === 'sqlserver') {
                  expect(results).to.have.length(1);
                  const [result] = results;

                  expect(result).to.have.property('command').to.eql('DELETE');
                  expect(result).to.have.property('rows').to.eql([]);
                  expect(result).to.have.property('fields').to.eql([]);
                  expect(result).to.have.property('rowCount').to.eql(0);
                  expect(result).to.have.property('affectedRows').to.eql(2);
                } else {
                  expect(results).to.have.length(2);
                  const [firstResult, secondResult] = results;

                  expect(firstResult).to.have.property('command').to.eql('DELETE');
                  expect(firstResult).to.have.property('rows').to.eql([]);
                  expect(firstResult).to.have.property('fields').to.eql([]);
                  expect(firstResult).to.have.property('rowCount').to.eql(undefined);
                  expect(firstResult).to.have.property('affectedRows').to.eql(1);

                  expect(secondResult).to.have.property('command').to.eql('DELETE');
                  expect(secondResult).to.have.property('rows').to.eql([]);
                  expect(secondResult).to.have.property('fields').to.eql([]);
                  expect(secondResult).to.have.property('rowCount').to.eql(undefined);
                  expect(secondResult).to.have.property('affectedRows').to.eql(1);
                }
              } catch (err) {
                if (dbAdapter === 'cassandra') {
                  if (versionCompare(dbConn.getVersion().version, '3.10') >= 0) {
                    expect((err as {message: string}).message).to.match(/mismatched input 'delete' expecting EOF/);
                  } else {
                    expect((err as {message: string}).message).to.match(/missing EOF at 'delete'/);
                  }
                } else {
                  throw err;
                }
              }
            });
          });

          describe('UPDATE', () => {
            it('should execute a single query', async () => {
              const results = await dbConn.executeQuery(`
                update users set username = 'max' where id = 1
              `);

              expect(results).to.have.length(1);
              const [result] = results;

              expect(result).to.have.property('command').to.eql('UPDATE');
              expect(result).to.have.property('rows').to.eql([]);
              expect(result).to.have.property('fields').to.eql([]);

              // Cassandra does not return affectedRows
              if (dbAdapter === 'cassandra') {
                expect(result).to.have.property('affectedRows').to.eql(undefined);
              } else {
                expect(result).to.have.property('affectedRows').to.eql(1);
              }

              // MSSQL does not return row count
              // so these value is based in the number of rows
              if (dbAdapter === 'sqlserver') {
                expect(result).to.have.property('rowCount').to.eql(0);
              } else {
                expect(result).to.have.property('rowCount').to.eql(undefined);
              }
            });

            it('should execute multiple queries', async () => {
              try {
                const results = await dbConn.executeQuery(`
                  update users set username = 'max' where username = 'maxcnunes';
                  update roles set name = 'dev' where name = 'developer';
                `);

                // MSSQL treats multiple non select queries as a single query result
                if (dbAdapter === 'sqlserver') {
                  expect(results).to.have.length(1);
                  const [result] = results;

                  expect(result).to.have.property('command').to.eql('UPDATE');
                  expect(result).to.have.property('rows').to.eql([]);
                  expect(result).to.have.property('fields').to.eql([]);
                  expect(result).to.have.property('rowCount').to.eql(0);
                  expect(result).to.have.property('affectedRows').to.eql(2);
                } else {
                  expect(results).to.have.length(2);
                  const [firstResult, secondResult] = results;

                  expect(firstResult).to.have.property('command').to.eql('UPDATE');
                  expect(firstResult).to.have.property('rows').to.eql([]);
                  expect(firstResult).to.have.property('fields').to.eql([]);
                  expect(firstResult).to.have.property('rowCount').to.eql(undefined);
                  expect(firstResult).to.have.property('affectedRows').to.eql(1);

                  expect(secondResult).to.have.property('command').to.eql('UPDATE');
                  expect(secondResult).to.have.property('rows').to.eql([]);
                  expect(secondResult).to.have.property('fields').to.eql([]);
                  expect(secondResult).to.have.property('rowCount').to.eql(undefined);
                  expect(secondResult).to.have.property('affectedRows').to.eql(1);
                }
              } catch (err) {
                if (dbAdapter === 'cassandra') {
                  if (versionCompare(dbConn.getVersion().version, '3.10') >= 0) {
                    expect((err as {message: string}).message).to.match(/mismatched input 'update' expecting EOF/);
                  } else {
                    expect((err as {message: string}).message).to.match(/missing EOF at 'update'/);
                  }
                } else {
                  throw err;
                }
              }
            });
          });

          if (dbAdapter !== 'cassandra' && dbAdapter !== 'sqlite') {
            describe('CREATE', () => {
              describe('DATABASE', () => {
                beforeEach(async () => {
                  try {
                    await dbConn.executeQuery('drop database db_test_create_database');
                  } catch (err) {
                    // just ignore
                  }
                });

                it('should execute a single query', async () => {
                  const results = await dbConn.executeQuery('create database db_test_create_database');

                  // MSSQL does not return any information about CREATE queries
                  if (dbAdapter === 'sqlserver') {
                    expect(results).to.have.length(0);
                    return;
                  }

                  expect(results).to.have.length(1);
                  const [result] = results;

                  expect(result).to.have.property('command').to.eql('CREATE_DATABASE');
                  expect(result).to.have.property('rows').to.eql([]);
                  expect(result).to.have.property('fields').to.eql([]);
                  // seems each db adapter returns a different value for CREATE
                  expect(result).to.have.property('affectedRows').to.oneOf([0, 1, undefined]);
                  expect(result).to.have.property('rowCount').to.eql(undefined);
                });
              });
            });
          }

          if (dbAdapter !== 'cassandra' && dbAdapter !== 'sqlite') {
            describe('DROP', () => {
              describe('DATABASE', () => {
                beforeEach(async () => {
                  try {
                    await dbConn.executeQuery('create database db_test_create_database');
                  } catch (err) {
                    // just ignore
                  }
                });

                it('should execute a single query', async () => {
                  const results = await dbConn.executeQuery('drop database db_test_create_database');

                  // MSSQL does not return any information about DROP queries
                  if (dbAdapter === 'sqlserver') {
                    expect(results).to.have.length(0);
                    return;
                  }

                  expect(results).to.have.length(1);
                  const [result] = results;

                  expect(result).to.have.property('command').to.eql('DROP_DATABASE');
                  expect(result).to.have.property('rows').to.eql([]);
                  expect(result).to.have.property('fields').to.eql([]);
                  // seems each db adapter returns a different value for DROP
                  expect(result).to.have.property('affectedRows').to.oneOf([0, 1, undefined]);
                  expect(result).to.have.property('rowCount').to.eql(undefined);
                });
              });
            });
          }

          if (postgresAdapters.includes(dbAdapter)) {
            describe('EXPLAIN', () => {
              it('should execute a single query', async () => {
                const results = await dbConn.executeQuery('explain select * from users');

                expect(results).to.have.length(1);
                const [result] = results;

                expect(result).to.have.property('command').to.eql('EXPLAIN');
                expect(result).to.have.property('rows').to.have.length.above(0);
                expect(result).to.have.deep.property('fields').to.have.length(1);
                expect(result).to.have.nested.property('fields[0].name').to.eql('QUERY PLAN');
                expect(result).to.have.property('affectedRows').to.eql(undefined);
                expect(result).to.have.property('rowCount').to.eql(undefined);
              });
            });
          }
        });
      });
    });
  });
});
