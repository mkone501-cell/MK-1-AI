'use strict';

const { MemorySessionStore } = require('./session-stores/memory-session-store');
const { DatabaseSessionStore } = require('./session-stores/database-session-store');

function createSessionStore(config, { sessionRepository } = {}) {
  const options = { ttlMs: config.session.ttlMs, secure: config.cookie.secure, sameSite: config.cookie.sameSite };
  if (config.session.driver === 'memory') return new MemorySessionStore(options);
  if (config.session.driver === 'database') return new DatabaseSessionStore({ ...options, repository: sessionRepository });
  throw new Error(`未対応のSESSION_STOREです: ${config.session.driver}`);
}

module.exports = { createSessionStore };
