#!/usr/bin/env node
/**
 * One-shot migration: copies every JSON account's tasks into Postgres.
 * Requires DATABASE_URL. Run with: npm run migrate:pg
 */
import { migrateJsonToPostgres, StoreError } from '@todo/shared/store';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL is not set — point it at your Postgres instance first.');
  process.exit(1);
}

try {
  const { users, tasks } = await migrateJsonToPostgres();
  console.log(`✔ migrated ${tasks} task(s) for ${users} account(s) into Postgres.`);
  console.log('  Restart with DATABASE_URL set and the server will use Postgres.');
  console.log('  JSON files are left in place as a backup; delete .data/tasks when happy.');
} catch (err) {
  console.error(`✗ migration failed: ${err.message}`);
  process.exit(1);
}
