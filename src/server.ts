import type { Server as NetServer } from 'net';
import { Database } from './client';
import { CLIENTS } from './clients';

export interface ServerConfig {
  name: string;
  client: string;
  host?: string;
  socketPath?: string;
  port?: number;
  localHost?: string;
  localPort?: number;
  ssh?: {
    user: string;
    password?: string;
    passphrase?: string;
    privateKey?: string;
    host: string;
    port: number;
  }
};

export class Server {
  databases: {[key: string]: Database} = {};
  config: ServerConfig;
  sshTunnel: null | NetServer = null;

  constructor(serverConfig: ServerConfig) {
    this.config = {
      ...serverConfig,
      host: serverConfig.host || serverConfig.socketPath,
    }
  }

  db(dbName: string) {
    return this.databases[dbName];
  }

  /**
   * Disconnect all connected databases
   */
  end() {
    for (const dbName in this.databases) {
      this.databases[dbName].disconnect();
    }

    // close SSH tunnel
    if (this.sshTunnel) {
      this.sshTunnel.close();
      this.sshTunnel = null;
    }
  }

  createConnection(dbName: string) {
    if (this.databases[dbName]) {
      return this.databases[dbName];
    }

    this.databases[dbName] = new Database(this, dbName);

    return this.databases[dbName];
  }

  removeDatabase(dbName: string) {
    if (this.databases[dbName]) {
      delete this.databases[dbName];
    }
  }
}

export function createServer(serverConfig: ServerConfig) {
  if (!serverConfig) {
    throw new Error('Missing server configuration');
  }

  if (!CLIENTS.some((client) => client.key === serverConfig.client)) {
    throw new Error('Invalid SQL client');
  }

  return new Server(serverConfig);
}
