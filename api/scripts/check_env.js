#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const { configErrors, databaseOptions } = require('../security');
async function main() {
    const errors = configErrors(process.env);
    if (errors.length) { errors.forEach(error => console.error(error)); process.exitCode = 1; return; }
    const pool = new Pool(databaseOptions(process.env));
    try { await pool.query('SELECT id FROM orders LIMIT 0'); console.log('Configuration and order schema ready. Provider credentials still need a staging smoke test.'); }
    catch { console.error('Database or order schema unavailable'); process.exitCode = 1; }
    finally { await pool.end(); }
}
void main();
