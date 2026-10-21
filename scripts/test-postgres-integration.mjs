import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/api/package.json'));
const dotenv = require('dotenv');
const pg = require('pg');
dotenv.config({ path: resolve(root, '.env') });
const configured = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!configured) throw new Error('Local PostgreSQL connection is not configured.');
const source = new URL(configured);
const host = source.hostname.toLowerCase();
if (!['localhost', '127.0.0.1', '::1'].includes(host) || decodeURIComponent(source.pathname.slice(1)) !== 'unit111_admin_test') {
  throw new Error('Refusing integration DB creation: configured connection must be local unit111_admin_test.');
}

const suffix = randomBytes(4).toString('hex');
const databaseName = `unit111_it_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${suffix}`;
if (!/^unit111_it_[0-9]{14}_[a-f0-9]{8}$/.test(databaseName)) throw new Error('Invalid generated test database name.');
const adminUrl = new URL(source);
adminUrl.pathname = '/postgres';
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const exists = await client.query('select 1 from pg_database where datname = $1', [databaseName]);
  if (exists.rowCount) throw new Error('Generated test database name already exists; refusing to modify it.');
  await client.query(`CREATE DATABASE "${databaseName}"`);
} finally { await client.end(); }

const testUrl = new URL(source);
testUrl.pathname = `/${databaseName}`;
const env = { ...process.env, DATABASE_URL: testUrl.toString(), DIRECT_DATABASE_URL: testUrl.toString(), UNIT111_TEST_DATABASE_INTEGRATION: '1' };
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
function run(args) {
  const result = spawnSync(pnpm, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Integration step failed with exit code ${result.status}. Test database retained: ${databaseName}`);
}
console.log(`Isolated PostgreSQL integration database: ${databaseName}`);
run(['--filter', '@unit111/api', 'db:migrate']);
run(['--filter', '@unit111/api', 'build']);
const seeded = spawnSync(process.execPath, ['apps/api/dist/seed.js'], { cwd: root, env, stdio: 'inherit' });
if (seeded.error) throw seeded.error;
if (seeded.status !== 0) throw new Error(`Integration seed failed with exit code ${seeded.status}. Test database retained: ${databaseName}`);
run(['--filter', '@unit111/api', 'exec', 'node', '--test', 'dist/learning-retry.integration.test.js', 'dist/question-import.integration.test.js', 'dist/learning-theory.integration.test.js', 'dist/admin-authoring.integration.test.js', 'dist/self-service-auth.integration.test.js']);
console.log(`Integration test database retained for inspection: ${databaseName}`);
