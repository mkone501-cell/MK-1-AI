'use strict';

const fs = require('node:fs');
const path = require('node:path');
const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/002_create_conversations.sql'), 'utf8');

async function migrateConversations(repository) { await repository.pool.query(migration); }
module.exports = { migrateConversations };
