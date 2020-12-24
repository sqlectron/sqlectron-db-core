import type { Database } from '../database';
import type { ListDatabaseFilter } from '../filters';
import type { Server } from '../server';

export interface AdapterVersion {
  name: string;
  version: string;
  string: string;
}

export interface QueryArgs {
  query: string;
  params?: unknown[];
  multiple?: boolean;
}

export interface QueryRowResult {
  command: string;
  rows: any;
  fields: {name: string}[];
  rowCount?: number;
  affectedRows?: number;
}

export abstract class AbstractAdapter {
  readonly server;
  readonly database;
  version?: AdapterVersion;

  constructor(server: Server, database: Database) {
    this.server = server;
    this.database = database;
  }

  abstract connect(): Promise<void>;

  disconnect(): Promise<void> {
    return Promise.resolve();
  };

  getVersion(): AdapterVersion | undefined {
    return this.version;
  }

  listSchemas(filter: unknown): Promise<string[]> {
    return Promise.resolve([]);
  }

  abstract listTables(filter: unknown): Promise<{name: string}[]>;

  listViews(filter: unknown): Promise<{name: string}[]> {
    return Promise.resolve([]);
  }

  listRoutines(filter: unknown): Promise<{schema?: string, routineName: string, routineType: string}[]> {
    return Promise.resolve([]);
  }

  abstract listTableColumns(table: string, schema: string): Promise<{columnName: string, dataType: string}[]>

  listTableTriggers(table: string, schema: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  listTableIndexes(table: string, schema: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getTableReferences(table: string, schema: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getTableKeys(table: string, schema: string): Promise<{
    constraintName: string,
    columnName: string,
    referencedTable: string,
    keyType: string,
  }[]> {
    return Promise.resolve([]);
  }

  abstract listDatabases(filter: ListDatabaseFilter): Promise<string[]>;

  getQuerySelectTop(table: string, limit: number, schema: string) {
    return `SELECT * FROM ${this.wrapIdentifier(table)} LIMIT ${limit}`;
  }

  getTableCreateScript(table: string, schema: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getViewCreateScript(view: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getRoutineCreateScript(routine: string, type: string, schema: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  truncateAllTables(schema?: string): Promise<void> {
    return Promise.resolve();
  }

  abstract query(queryText: string): {execute: () => Promise<QueryRowResult[]>, cancel: () => void};
  abstract executeQuery(queryText: string): Promise<QueryRowResult[]>;

  abstract wrapIdentifier(value: string): string;
}
