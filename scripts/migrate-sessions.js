'use strict';

const { loadConfig } = require('../server/config');
const { createPostgresSessionRepository } = require('../server/session-stores/postgres-session-repository');
const { migrateSessions } = require('../server/session-stores/migrate-sessions');
const { migrateConversations } = require('../server/conversations/migrate-conversations');
const { migrateKnowledge } = require('../server/knowledge/migrate-knowledge');

async function main() {
  const config = loadConfig();
  const repository = createPostgresSessionRepository(config.database.url, { sslCa: config.database.sslCa });
  try {
    await migrateSessions(repository);
    await migrateConversations(repository);
    await migrateKnowledge(repository);
    await repository.check();
    console.log('セッション・会話・経営知識用テーブルを確認しました。');
  } finally { await repository.close(); }
}

main().catch(() => {
  console.error('DB初期化に失敗しました。DATABASE_URLとPostgreSQLの状態を確認してください。秘密情報は表示しません。');
  process.exitCode = 1;
});
