import connectTunnel from './tunnel';
import { adapterFactory } from './clients';
import createLogger from './logger';

import type { AddressInfo } from 'net';
import type { Server } from './server';
import type { AbstractAdapter } from './clients/adapter';

const logger = createLogger('db');

const DEFAULT_LIMIT = 1000;
let limitSelect: number | null = null;

export class Database {
  server: Server;
  database: string;
  connecting: boolean = false;
  connection: null | AbstractAdapter = null;

  constructor(server: Server, database: string) {
    this.server = server;
    this.database = database;
  }

  handleSSHError(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server.sshTunnel) {
        return resolve();
      }

      this.server.sshTunnel.on('success', resolve);
      this.server.sshTunnel.on('error', (error) => {
        logger().error('ssh error %j', error);
        reject(error);
      });
    });
  }

  checkIsConnected() {
    if (this.connecting || !this.connection) {
      throw new Error('There is no connection available.');
    }
  }

  async connect() {
    /* eslint no-param-reassign: 0 */
    if (this.connecting) {
      throw new Error('There is already a connection in progress for this database. Aborting this new request.');
    }

    try {
      this.connecting = true;

      // terminate any previous lost connection for this DB
      if (this.connection) {
        this.connection.disconnect();
      }

      // reuse existing tunnel
      if (this.server.config.ssh && !this.server.sshTunnel) {
        logger().debug('creating ssh tunnel');
        this.server.sshTunnel = await connectTunnel(this.server.config);

        const { address, port } = <AddressInfo>this.server.sshTunnel.address();
        logger().debug('ssh forwarding through local connection %s:%d', address, port);

        this.server.config.localHost = address;
        this.server.config.localPort = port;
      }

      const adapter = adapterFactory(this.server.config.client, this.server, this);

      await Promise.all([
        adapter.connect(),
        this.handleSSHError(),
      ]);

      this.connection = adapter;
    } catch (err) {
      logger().error('Connection error %j', err);
      this.disconnect();
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  disconnect() {
    this.connecting = false;

    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }

    this.server.removeDatabase(this.database);
  }

  getVersion() {
    this.checkIsConnected();
    return this.connection!.getVersion();
  }

  listSchemas(filter: any) {
    this.checkIsConnected();
    return this.connection!.listSchemas(filter);
  }

  listTables(filter: any) {
    this.checkIsConnected();
    return this.connection!.listTables(filter);
  }

  listViews(filter: any) {
    this.checkIsConnected();
    return this.connection!.listViews(filter);
  }

  listRoutines(filter: unknown) {
    this.checkIsConnected();
    return this.connection!.listRoutines(filter);
  }

  listTableColumns(table: string, schema: string) {
    this.checkIsConnected();
    return this.connection!.listTableColumns(table, schema);
  }

  listTableTriggers(table: string, schema: string) {
    this.checkIsConnected();
    return this.connection!.listTableTriggers(table, schema);
  }

  listTableIndexes(table: string, schema: string) {
    this.checkIsConnected();
    return this.connection!.listTableIndexes(table, schema);
  }

  getTableReferences(table: string, schema: string) {
    this.checkIsConnected();
    return this.connection!.getTableReferences(table, schema);
  }

  getTableKeys(table: string, schema: string) {
    this.checkIsConnected();
    return this.connection!.getTableKeys(table, schema);
  }

  query(queryText: string) {
    this.checkIsConnected();
    return this.connection!.query(queryText);
  }

  executeQuery(queryText: string) {
    this.checkIsConnected();
    return this.connection!.executeQuery(queryText);
  }

  listDatabases(filter: unknown) {
    this.checkIsConnected();
    return this.connection!.listDatabases(filter);
  }

  async getQuerySelectTop(table: string, schema: string, limit: number) {
    this.checkIsConnected();
    let limitValue = limit;
    if (typeof limit === 'undefined') {
      await loadConfigLimit();
      limitValue = (typeof limitSelect !== 'undefined' && limitSelect !== null) ? limitSelect : DEFAULT_LIMIT;
    }
    return this.connection!.getQuerySelectTop(table, limitValue, schema);
  }

  getTableCreateScript(table: string, schema: string) {
    this.checkIsConnected();
    return this.connection!.getTableCreateScript(table, schema);
  }

  async getTableSelectScript(table: string, schema: string) {
    const columnNames = await this.getTableColumnNames(table, schema);
    const schemaSelection = this.resolveSchema(schema);
    return [
      `SELECT ${(<string[]>this.wrap(columnNames)).join(', ')}`,
      `FROM ${schemaSelection}${this.wrap(table)};`,
    ].join(' ');
  }

  async getTableInsertScript(table: string, schema: string) {
    const columnNames = await this.getTableColumnNames(table, schema);
    const schemaSelection = this.resolveSchema(schema);
    return [
      `INSERT INTO ${schemaSelection}${this.wrap(table)}`,
      `(${(<string[]>this.wrap(columnNames)).join(', ')})\n`,
      `VALUES (${columnNames.fill('?').join(', ')});`,
    ].join(' ');
  }

  async getTableUpdateScript(table: string, schema: string) {
    const columnNames = await this.getTableColumnNames(table, schema);
    const setColumnForm = (<string[]>this.wrap(columnNames)).map((col) => `${col}=?`).join(', ');
    const schemaSelection = this.resolveSchema(schema);
    return [
      `UPDATE ${schemaSelection}${this.wrap(table)}\n`,
      `SET ${setColumnForm}\n`,
      'WHERE <condition>;',
    ].join(' ');
  }

  getTableDeleteScript(table: string, schema: string) {
    const schemaSelection = this.resolveSchema(schema);
    return [
      `DELETE FROM ${schemaSelection}${this.wrap(table)}`,
      'WHERE <condition>;',
    ].join(' ');
  }

  getViewCreateScript(view: string /* , schema */) {
    this.checkIsConnected();
    return this.connection!.getViewCreateScript(view);
  }

  getRoutineCreateScript(routine: string, type: string, schema: string) {
    this.checkIsConnected();
    return this.connection!.getRoutineCreateScript(routine, type, schema);
  }

  truncateAllTables(schema?: string) {
    return this.connection!.truncateAllTables(schema);
  }

  async getTableColumnNames(table: string, schema: string) {
    this.checkIsConnected();
    const columns = await this.connection!.listTableColumns(table, schema);
    return columns.map((column) => column.columnName);
  }

  resolveSchema(schema: string) {
    return schema ? `${this.wrap(schema)}.` : '';
  }

  wrap(identifier: string | string[]): string | string[] {
    if (!Array.isArray(identifier)) {
      return this.connection!.wrapIdentifier(identifier);
    }

    return identifier.map((item) => this.connection!.wrapIdentifier(item));
  }
}

export function clearLimitSelect() {
  limitSelect = null;
}

async function loadConfigLimit() {
  // TODO: rework, where this value is passed in on createServer as an option
  return undefined;
  /*
  if (typeof limitSelect === 'undefined' || limitSelect === null) {
    const { limitQueryDefaultSelectTop } = await config.get();
    limitSelect = limitQueryDefaultSelectTop;
  }
  return limitSelect;
  */
}
