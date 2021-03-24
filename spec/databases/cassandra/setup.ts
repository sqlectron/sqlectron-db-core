import fs from 'fs';
import path from 'path';
import cassandra from 'cassandra-driver';

type ResultSet = cassandra.types.ResultSet;

export default function run(config: { host: string }): void {
  before(async () => {
    const client = new cassandra.Client({
      contactPoints: [config.host],
    });
    const script = fs.readFileSync(path.join(__dirname, 'schema/schema.cql'), { encoding: 'utf8' });
    const queries = script.split(';').filter((query) => query.trim().length);
    const promises: Promise<ResultSet>[] = [];
    queries.forEach((query) => {
      promises.push(executeQuery(client, query));
    });
    await Promise.all(promises);
  });
}

function executeQuery(client: cassandra.Client, query: string): Promise<ResultSet> {
  return new Promise((resolve, reject) => {
    client.execute(query, (err, data) => {
      if (err) {
        return reject(err);
      }

      return resolve(data);
    });
  });
}
