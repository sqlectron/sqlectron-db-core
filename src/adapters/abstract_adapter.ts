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
  rows: any;
  fields: unknown;
  rowCount?: number;
  affectedRows?: number;
}

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
  };

  getVersion(): AdapterVersion {
    return this.version;
  }

  abstract listDatabases(filter?: DatabaseFilter): Promise<string[]>;

  listSchemas(filter: SchemaFilter): Promise<string[]> {
    return Promise.resolve([]);
  }

  abstract listTables(filter: SchemaFilter): Promise<{name: string}[]>;

  listViews(filter: SchemaFilter): Promise<{name: string}[]> {
    return Promise.resolve([]);
  }

  listRoutines(filter: SchemaFilter): Promise<{schema?: string, routineName: string, routineType: string}[]> {
    return Promise.resolve([]);
  }

  abstract listTableColumns(table: string, schema?: string): Promise<{columnName: string, dataType: string}[]>

  listTableTriggers(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  listTableIndexes(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getTableReferences(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getTableKeys(table: string, schema?: string): Promise<{
    columnName: string,
    keyType: string,
    constraintName: string | null,
    referencedTable: string | null,
  }[]> {
    return Promise.resolve([]);
  }

  getQuerySelectTop(table: string, limit: number, schema?: string) {
    return `SELECT * FROM ${this.wrapIdentifier(table)} LIMIT ${limit}`;
  }

  getTableCreateScript(table: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getViewCreateScript(view: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  getRoutineCreateScript(routine: string, type: string, schema?: string): Promise<string[]> {
    return Promise.resolve([]);
  }

  truncateAllTables(schema?: string): Promise<void> {
    return Promise.resolve();
  }

  abstract query(queryText: string): {execute: () => Promise<QueryRowResult[]>, cancel: () => void};
  abstract executeQuery(queryText: string): Promise<QueryRowResult[]>;

  abstract wrapIdentifier(value: string): string;
}
