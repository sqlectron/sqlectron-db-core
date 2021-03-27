# sqlectron-db-core

[![Build Status](https://github.com/sqlectron/sqlectron-db-core/workflows/Test/badge.svg?branch=master)](https://github.com/sqlectron/sqlectron-db-core/actions?query=workflow%3ATest+branch%3Amain)
[![npm](https://img.shields.io/npm/v/sqlectron-db-core)](https://www.npmjs.com/package/sqlectron-db-core)

The common code used by all sqlectron clients.

> Requires node v10 or higher.
> For ed25519 ssh support it requires node v12.

## How to pronounce

It is pronounced "sequelectron" - https://translate.google.com/?source=osdd#en/en/sequelectron

## Current supported databases

- [PostgreSQL](http://www.postgresql.org/)
- [Redshift](https://aws.amazon.com/redshift/)
- [MySQL](https://www.mysql.com/)
- [MariaDB](https://mariadb.org/)
- [Microsoft SQL Server](http://www.microsoft.com/en-us/server-cloud/products/sql-server/)
- [Cassandra](http://cassandra.apache.org/) (NoSQL; [Exceptions about this client](https://github.com/sqlectron/sqlectron-core/releases/tag/v6.3.0))
- [SQLite](https://sqlite.org/)

Do you want to support another SQL database? Please follow [these steps](/CONTRIBUTING.md#adding-a-new-client).

## Installation

Install via npm:

```bash
npm install sqlectron-db-core
```

## Example Usage

```javascript
const serverSession = db.createServer(serverInfo);
const dbConn = serverSession.createConnection(serverInfo.database);
dbConn.connect().then(() => {
  console.log(dbConn.executeQuery('SELECT 1'));
});
```

Where serverInfo is an array with the following fields:

- `id`: in case including a new server manually there is no need setting an id field because SQLECTRON will do it for you
- `name`
- `client`: `postgresql`, `mysql` or `sqlserver`
- `host`
- `port`
- `user`
- `password`
- `database`
- `ssh`
  - `host`
  - `user`
  - `port`
  - `privateKey`
  - `passphrase`
  - `useAgent`
- `ssl`

## Contributing

Please check out it [here](/CONTRIBUTING.md).

## License

Copyright (c) 2015 The SQLECTRON Team. This software is licensed under the [MIT License](http://raw.github.com/sqlectron/sqlectron-db-core/master/LICENSE).
