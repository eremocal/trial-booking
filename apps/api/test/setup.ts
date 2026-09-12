import { testDatabaseUrl } from '../src/common/env';

// Every test runs against the test database (POSTGRES_TEST_DB) -- same Postgres
// container as the demo, separate database -- so a test run never truncates
// the data a reviewer is looking at.
process.env.DATABASE_URL = testDatabaseUrl();
