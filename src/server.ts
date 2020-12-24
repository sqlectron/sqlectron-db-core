import type { Server as NetServer } from 'net';
import { Database } from './database';
import { ADAPTERS } from './adapters';

export interface ServerConfig {
  name: string;
  adapter: string;
  host?: string;
  socketPath?: string;
  port?: number;
  localHost?: string;
  localPort?: number;
  user?: string;
  password?: string;
  ssh?: {
    user: string;
    password?: string;
    passphrase?: string;
    privateKey?: string;
    host: string;
    port: number;
  };
  ssl?: {

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

  if (!ADAPTERS.some((adapter) => adapter.key === serverConfig.adapter)) {
    throw new Error('Invalid SQL adapter');
  }

  return new Server(serverConfig);
}
