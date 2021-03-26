import connectTunnel from './tunnel';
import { adapterFactory } from './adapters';
import createLogger from './logger';

import type { AddressInfo } from 'net';
import type { DatabaseFilter, SchemaFilter } from './filters';
import type { Server } from './server';
import type { AbstractAdapter, AdapterVersion, QueryRowResult } from './adapters/abstract_adapter';

const logger = createLogger('db');

const DEFAULT_LIMIT = 1000;
let selectLimit: number | null = null;

export class Database {
  server: Server;
  database: string | undefined;
  connecting = false;
  connection: null | AbstractAdapter = null;

  constructor(server: Server, database?: string) {
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

  checkIsConnected(): void {
    if (this.connecting || !this.connection) {
      throw new Error('There is no connection available.');
    }
  }

  async connect(): Promise<void> {
    /* eslint no-param-reassign: 0 */
    if (this.connecting) {
      throw new Error(
        'There is already a connection in progress for this database. Aborting this new request.',
      );
    }

    try {
      this.connecting = true;

      // terminate any previous lost connection for this DB
      if (this.connection) {
        void this.connection.disconnect();
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

      const adapter = adapterFactory(this.server.config.adapter, this.server, this);

      await Promise.all([adapter.connect(), this.handleSSHError()]);

      this.connection = adapter;
    } catch (err) {
      logger().error('Connection error %j', err);
      this.disconnect();
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  disconnect(): void {
    this.connecting = false;

    if (this.connection) {
      void this.connection.disconnect();
      this.connection = null;
    }

    this.server.removeDatabase(this.database);
  }

  getVersion(): AdapterVersion {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).getVersion();
  }

  listDatabases(filter?: DatabaseFilter): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listDatabases(filter);
  }

  listSchemas(filter: SchemaFilter): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listSchemas(filter);
  }

  listTables(filter: SchemaFilter): Promise<{ name: string }[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listTables(filter);
  }

  listViews(filter: SchemaFilter): Promise<{ name: string }[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listViews(filter);
  }

  listRoutines(
    filter: SchemaFilter,
  ): Promise<
    {
      schema?: string;
      routineName: string;
      routineType: string;
    }[]
  > {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listRoutines(filter);
  }

  listTableColumns(
    table: string,
    schema?: string,
  ): Promise<
    {
      columnName: string;
      dataType: string;
    }[]
  > {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listTableColumns(table, schema);
  }

  listTableTriggers(table: string, schema?: string): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listTableTriggers(table, schema);
  }

  listTableIndexes(table: string, schema?: string): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).listTableIndexes(table, schema);
  }

  getTableReferences(table: string, schema?: string): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).getTableReferences(table, schema);
  }

  getTableKeys(
    table: string,
    schema?: string,
  ): Promise<
    {
      columnName: string;
      keyType: string;
      constraintName: string | null;
      referencedTable: string | null;
    }[]
  > {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).getTableKeys(table, schema);
  }

  query(
    queryText: string,
  ): {
    execute: () => Promise<QueryRowResult[]>;
    cancel: () => void;
  } {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).query(queryText);
  }

  executeQuery(queryText: string): Promise<QueryRowResult[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).executeQuery(queryText);
  }

  getQuerySelectTop(table: string, schema?: string, limit?: number): Promise<string> {
    this.checkIsConnected();
    let limitValue = limit;
    if (limit === undefined) {
      limitValue = selectLimit !== null ? selectLimit : DEFAULT_LIMIT;
    }
    return Promise.resolve(
      (<AbstractAdapter>this.connection).getQuerySelectTop(table, <number>limitValue, schema),
    );
  }

  getTableCreateScript(table: string, schema?: string): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).getTableCreateScript(table, schema);
  }

  async getTableSelectScript(table: string, schema?: string): Promise<string> {
    const columnNames = await this.getTableColumnNames(table, schema);
    const schemaSelection = this.resolveSchema(schema);
    return [
      `SELECT ${columnNames.map((name) => this.wrap(name)).join(', ')}`,
      `FROM ${schemaSelection}${this.wrap(table)};`,
    ].join(' ');
  }

  async getTableInsertScript(table: string, schema?: string): Promise<string> {
    const columnNames = await this.getTableColumnNames(table, schema);
    const schemaSelection = this.resolveSchema(schema);
    return [
      `INSERT INTO ${schemaSelection}${this.wrap(table)}`,
      `(${columnNames.map((name) => this.wrap(name)).join(', ')})\n`,
      `VALUES (${columnNames.fill('?').join(', ')});`,
    ].join(' ');
  }

  async getTableUpdateScript(table: string, schema?: string): Promise<string> {
    const columnNames = await this.getTableColumnNames(table, schema);
    const setColumnForm = columnNames.map((col) => `${this.wrap(col)}=?`).join(', ');
    const schemaSelection = this.resolveSchema(schema);
    return [
      `UPDATE ${schemaSelection}${this.wrap(table)}\n`,
      `SET ${setColumnForm}\n`,
      'WHERE <condition>;',
    ].join(' ');
  }

  getTableDeleteScript(table: string, schema?: string): Promise<string> {
    const schemaSelection = this.resolveSchema(schema);
    return Promise.resolve(
      [`DELETE FROM ${schemaSelection}${this.wrap(table)}`, 'WHERE <condition>;'].join(' '),
    );
  }

  getViewCreateScript(view: string, schema?: string): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).getViewCreateScript(view, schema);
  }

  getRoutineCreateScript(routine: string, type: string, schema?: string): Promise<string[]> {
    this.checkIsConnected();
    return (<AbstractAdapter>this.connection).getRoutineCreateScript(routine, type, schema);
  }

  truncateAllTables(schema?: string): Promise<void> {
    return (<AbstractAdapter>this.connection).truncateAllTables(schema);
  }

  async getTableColumnNames(table: string, schema?: string): Promise<string[]> {
    this.checkIsConnected();
    const columns = await (<AbstractAdapter>this.connection).listTableColumns(table, schema);
    return columns.map((column) => column.columnName);
  }

  resolveSchema(schema?: string): string {
    return schema ? `${this.wrap(schema)}.` : '';
  }

  wrap(identifier: string): string {
    return (<AbstractAdapter>this.connection).wrapIdentifier(identifier);
  }
}

export function clearSelectLimit(): void {
  selectLimit = null;
}

export function setSelectLimit(limit: number): void {
  selectLimit = limit;
}
