import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

sqlite3.verbose();

export default function run(config: {database: string}): void {
  before(async () => {
    const db = new sqlite3.Database(config.database);

    const script = fs.readFileSync(
      path.join(__dirname, 'schema/schema.sql'),
      { encoding: 'utf8' }
    );

    await executeQuery(db, script);

    db.close();
  });
}


function executeQuery(client: sqlite3.Database, query: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.exec(query, (err) => {
      if (err) {
        return reject(err);
      }

      return resolve();
    });
  });
}
