#!/usr/bin/env node
/** Connectivity smoke: prints the server version using DATABASE_URL. */
const pg = await import('pg');
const Pool = pg.default?.Pool ?? pg.Pool;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await pool.query('select version() as v');
  console.log('PG OK:', r.rows[0].v.split(',')[0]);
} finally {
  await pool.end();
}
