import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';
const packageDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(packageDirectory, '../../.env') });
dotenv.config({ path: resolve(packageDirectory, '.env'), override: false });
export default defineConfig({schema:'./src/schema.ts',out:'./drizzle',dialect:'postgresql',dbCredentials:{url:(process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL)!}});
