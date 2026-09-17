'use strict';

const fs = require('node:fs');
const path = require('node:path');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/003_create_management_knowledge.sql'), 'utf8');

async function migrateKnowledge(repository) { await repository.pool.query(migration); }
module.exports = { migrateKnowledge };
