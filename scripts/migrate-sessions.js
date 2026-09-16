'use strict';

const { loadConfig } = require('../server/config');
const { createPostgresSessionRepository } = require('../server/session-stores/postgres-session-repository');
const { migrateSessions } = require('../server/session-stores/migrate-sessions');

async function main() {
  const config = loadConfig();
  const repository = createPostgresSessionRepository(config.database.url, { sslCa: config.database.sslCa });
  try {
    await migrateSessions(repository);
    await repository.check();
    console.log('セッション用テーブルを確認しました。');
  } finally { await repository.close(); }
}

main().catch(() => {
  console.error('DB初期化に失敗しました。DATABASE_URLとPostgreSQLの状態を確認してください。秘密情報は表示しません。');
  process.exitCode = 1;
});
