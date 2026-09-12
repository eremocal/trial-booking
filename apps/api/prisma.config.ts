import path from 'node:path';
import { defineConfig } from 'prisma/config';
// Loads the optional root .env and fills in defaults, so Prisma CLI commands
// work in a fresh clone with no .env.
import './src/common/env';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
