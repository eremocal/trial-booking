import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from '../src/common/env';

/**
 * Migrate the test database before any test runs, so `pnpm test` works
 * against a freshly started stack without a separate migrate command.
 */
export default function globalSetup() {
  const url = testDatabaseUrl();

  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      'Could not migrate the test database. Is "docker compose up -d db" running?\n' +
        `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    );
  }
}
