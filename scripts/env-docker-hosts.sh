#!/bin/bash
# Script to resolve container hosts when running the tests from the the host machine
# but the rest of the depdencies in docker containers.
# Usually we could just use localhost to access those dependencies since their port are
# exposed to the host. But, because of ssh tunnel tests we need to have their real IP/hostname
# to properly forward the connection through the ssh tunnel.
# And because it is using the container direct IP, the port used to connect must be the container internal port.

export MYSQL_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mysql)
export MYSQL_PORT=3306

export MARIADB_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mariadb)
export MARIADB_PORT=3306

export POSTGRES_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' postgres)
export POSTGRES_PORT=5432

export REDSHIFT_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' redshift)
export REDSHIFT_PORT=5432

export CASSANDRA_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cassandra)
export CASSANDRA_PORT=9042

export SQLSERVER_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' sqlserver)
export SQLSERVER_PORT=1433

# On running from host the SSH_HOST must be localhost, using the real IP address won't work
export SSH_HOST=localhost
