#!/bin/sh
# Runs once, when the Postgres data directory is first initialised.
#
# One container, two logical databases. The test suite truncates every table
# between cases, so it must not share a database with the demo data -- but that
# does not require a second container, only a second database inside the same
# instance. Names come from .env through docker-compose.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE \"$POSTGRES_TEST_DB\" OWNER \"$POSTGRES_USER\";"
