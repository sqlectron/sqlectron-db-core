import { expect } from 'chai';
import mysql from 'mysql2/promise';

import config from '../config';
import * as db from '../../../src';
import type { ServerConfig } from '../../../src/server';

describe('test connect', () => {
  it('should connect to db', async () => {
    const client = await mysql.createConnection({
      host: config['mariadb'].host,
      port: config['mariadb'].port,
      user: config['mariadb'].user,
      password: config['mariadb'].password,
      database: config['mariadb'].database,
    });
    await client.query("INSTALL SONAME 'auth_ed25519'");
    await client.query("CREATE USER foo IDENTIFIED VIA ed25519 USING PASSWORD('password')");
    await client.query(`GRANT ALL PRIVILEGES ON \`${config['mariadb'].database}\`.* TO 'foo'@'%'`);
    await client.query('FLUSH PRIVILEGES');
    await client.end();

    const serverInfo: ServerConfig = {
      ...config['mariadb'],
      user: 'foo',
      password: 'password',
      name: 'mariadb',
      adapter: 'mariadb',
    };

    const serverSession = db.createServer(serverInfo);
    const dbConn = serverSession.createConnection(config['mariadb'].database);

    return expect(dbConn.connect()).to.not.be.rejected;
  });
});
