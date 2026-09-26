'use strict';

const fs = require('node:fs');
const path = require('node:path');

const migrations = [
  fs.readFileSync(path.join(__dirname, '../../db/migrations/005_create_management_data.sql'), 'utf8'),
  fs.readFileSync(path.join(__dirname, '../../db/migrations/006_create_management_data_history.sql'), 'utf8')
];

async function migrateManagementData(repository) {
  if (!repository?.pool) throw new Error('management data repository is required');
  for (const migration of migrations) await repository.pool.query(migration);
}

module.exports = { migrateManagementData };
