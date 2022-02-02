import type { Database } from '../database';
import type { DatabaseFilter, SchemaFilter } from '../filters';
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
  rows: unknown;
  fields: unknown;
  rowCount?: number;
  affectedRows?: number;
}

export interface ListTableResult {
  schema?: string;
  name: string;
}

export type ListViewResult = ListTableResult;

export interface ListRoutineResult {
  schema?: string;
  routineName: string;
  routineType: string;
}

export interface ListTableColumnsResult {
  columnName: string;
  dataType: string;
}
export interface TableKeysResult {
  columnName: string;
  keyType: string;
  constraintName: string | null;
  referencedTable: string | null;
}

export type QueryReturn = { execute: () => Promise<QueryRowResult[]>; cancel: () => void };

export abstract class AbstractAdapter {
  readonly server;
  readonly database;
  version: AdapterVersion;

  constructor(server: Server, database: Database) {
    this.server = server;
    this.database = database;
    this.version = {
      name: 'UNKNOWN',
      version: '0.0.0',
      string: 'UNKNOWN 0.0.0',
    };
  }

  abstract connect(): Promise<void>;

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  getVersion(): AdapterVersion {
    return this.version;
  }

  abstract listDatabases(filter?: DatabaseFilter): Promise<string[]>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listSchemas(filter?: SchemaFilter): Promise<string[]> {
    return Promise.resolve([]);
  }

  abstract listTables(filter?: SchemaFilter): Promise<ListTableResult[]>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listViews(filter?: SchemaFilter): Promise<ListViewResult[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listRoutines(filter?: SchemaFilter): Promise<ListRoutineResult[]> {
    return Promise.resolve([]);
  }

  abstract listTableColumns(table: string, schema?: string): Promise<ListTableColumnsResult[]>;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listTableTriggers(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  listTableIndexes(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getTableReferences(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getTableKeys(table: string, schema?: string): Promise<TableKeysResult[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getQuerySelectTop(table: string, limit: number, schema?: string): string {
    return `SELECT * FROM ${this.wrapIdentifier(table)} LIMIT ${limit}`;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getTableCreateScript(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getViewCreateScript(view: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getRoutineCreateScript(routine: string, type: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  truncateAllTables(schema?: string): Promise<void> {
    return Promise.resolve();
  }

  abstract query(queryText: string): QueryReturn;

  abstract executeQuery(queryText: string): Promise<QueryRowResult[]>;

  abstract wrapIdentifier(value: string): string;
}
