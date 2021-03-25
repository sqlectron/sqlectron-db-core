#!/bin/bash
# This script is used to set-up containers that do not support initialization sequences

# Create Cassandra Schema
docker exec -i cassandra /bin/bash \
  -c "until cqlsh -f /docker-entrypoint-initdb.d/schema.cql; do sleep 2; done"

# Create SQLServer Database
docker exec -i sqlserver /opt/mssql-tools/bin/sqlcmd \
  -S localhost,1433 \
  -U sa -P Password12! \
  -Q "CREATE DATABASE sqlectron" \
  -d "master"


# Initialize SQLServer Schema
docker exec -i sqlserver /opt/mssql-tools/bin/sqlcmd \
  -S localhost,1433 \
  -U sa \
  -P Password12! \
  -i /docker-entrypoint-initdb.d/schema.sql \
  -d "sqlectron"
