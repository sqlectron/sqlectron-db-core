import type { Server as NetServer } from 'net';
import { Database } from './database';
import { ADAPTERS } from './adapters';

export interface LegacyServerConfig {
  name: string;
  client?: string;
  adapter?: string;
  host?: string;
  socketPath?: string;
  port?: number;
  localHost?: string;
  localPort?: number;
  user?: string;
  password?: string;
  applicationName?: string;
  domain?: string;
  ssh?: {
    user: string;
    password?: string;
    passphrase?: string;
    privateKey?: string;
    host: string;
    port: number;
  };
  ssl?: {
    key?: string;
    ca?: string;
    cert?: string;
  } | false;
}

export interface ServerConfig extends LegacyServerConfig {
  adapter: string;
}

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

  db(dbName: string): Database {
    return this.databases[dbName];
  }

  /**
   * Disconnect all connected databases
   */
  end(): void {
    for (const dbName in this.databases) {
      this.databases[dbName].disconnect();
    }

    // close SSH tunnel
    if (this.sshTunnel) {
      this.sshTunnel.close();
      this.sshTunnel = null;
    }
  }

  createConnection(dbName?: string): Database {
    const dbKey = dbName || 'undefined';

    if (this.databases[dbKey]) {
      return this.databases[dbKey];
    }

    this.databases[dbKey] = new Database(this, dbName);

    return this.databases[dbKey];
  }

  removeDatabase(dbName?: string): void {
    const dbKey = dbName || 'undefined';
    if (this.databases[dbKey]) {
      delete this.databases[dbKey];
    }
  }
}

export function createServer(serverConfig: LegacyServerConfig): Server {
  if (!serverConfig) {
    throw new Error('Missing server configuration');
  }

  if (!serverConfig.adapter && serverConfig.client) {
    serverConfig.adapter = serverConfig.client;
  }

  const config: ServerConfig = serverConfig as ServerConfig;

  if (!ADAPTERS.some((adapter) => adapter.key === config.adapter)) {
    throw new Error(`Invalid SQL adapter: ${config.adapter}`);
  }

  return new Server(config);
}
