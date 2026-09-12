import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Next only reads .env files beside this config, but the project keeps a single
// .env at the repo root. Inside Docker there is no .env; the value arrives as a
// build arg instead.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error('NEXT_PUBLIC_API_URL is not set. Copy .env.example to .env at the repo root.');
}

/** @type {import('next').NextConfig} */
export default {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};
