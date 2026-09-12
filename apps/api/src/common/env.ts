import { config } from 'dotenv';

/**
 * Loads the root .env (copied from .env.example). Imported for its side effect
 * before anything constructs a PrismaClient. Real environment variables win,
 * which is how the API container points at the `db` service.
 */
config({ path: ['../../.env', '.env'] });

/** Reads a setting, failing with a fix instead of falling back to a guess. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env at the repo root.`);
  }
  return value;
}

/** Builds a connection URL from the POSTGRES_* settings, so credentials live in one place. */
function postgresUrl(database: string): string {
  const user = encodeURIComponent(required('POSTGRES_USER'));
  const password = encodeURIComponent(required('POSTGRES_PASSWORD'));
  const host = required('POSTGRES_HOST');
  const port = required('POSTGRES_PORT');
  return `postgresql://${user}:${password}@${host}:${port}/${database}?schema=public`;
}

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? postgresUrl(required('POSTGRES_TEST_DB'));
}

process.env.DATABASE_URL ??= postgresUrl(required('POSTGRES_DB'));
