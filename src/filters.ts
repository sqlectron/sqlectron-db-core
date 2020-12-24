export interface DatabaseFilter {
  database?: string | {
    only?: string[];
    ignore?: string[];
  }
}

export interface SchemaFilter {
  schema?: string | {
    only?: string[]
    ignore?: string[]
  }
}

export function buildSchemaFilter({ schema }: SchemaFilter = {}, schemaField: string = 'schema_name') {
  if (!schema) { return null; }

  if (typeof schema === 'string') {
    return `${schemaField} = '${schema}'`;
  }

  const where = [];
  const { only, ignore } = schema;

  if (only && only.length) {
    where.push(`${schemaField} IN (${only.map((name) => `'${name}'`).join(',')})`);
  }

  if (ignore && ignore.length) {
    where.push(`${schemaField} NOT IN (${ignore.map((name) => `'${name}'`).join(',')})`);
  }

  return where.join(' AND ');
}

export function buildDatabaseFilter({ database }: DatabaseFilter = {}, databaseField: string) {
  if (!database) { return null; }

  if (typeof database === 'string') {
    return `${databaseField} = '${database}'`;
  }

  const where = [];
  const { only, ignore } = database;

  if (only && only.length) {
    where.push(`${databaseField} IN (${only.map((name) => `'${name}'`).join(',')})`);
  }

  if (ignore && ignore.length) {
    where.push(`${databaseField} NOT IN (${ignore.map((name) => `'${name}'`).join(',')})`);
  }

  return where.join(' AND ');
}
