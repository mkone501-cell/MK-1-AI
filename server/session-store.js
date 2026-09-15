'use strict';

// Phase 2との互換入口です。新規コードはsession-stores配下を使用します。
const { MemorySessionStore } = require('./session-stores/memory-session-store');
const { COOKIE_NAME, parseCookies } = require('./session-stores/session-utils');

module.exports = { SessionStore: MemorySessionStore, MemorySessionStore, COOKIE_NAME, parseCookies };
