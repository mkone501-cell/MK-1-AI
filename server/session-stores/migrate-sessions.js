'use strict';

const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/001_create_sessions.sql'), 'utf8');

async function migrateSessions(repository) {
  await repository.pool.query(migration);
}

module.exports = { migrateSessions };
