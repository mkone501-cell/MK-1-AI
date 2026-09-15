'use strict';

const { SessionStoreContract } = require('./session-store-contract');
const { tokenHash, newToken, readSessionToken } = require('./session-utils');
const { buildCookie } = require('./memory-session-store');

// repositoryはPostgreSQL等に合わせて後から実装します。生のセッションIDは渡しません。
class DatabaseSessionStore extends SessionStoreContract {
  constructor({ repository, ttlMs = 8 * 60 * 60 * 1000, secure = true, sameSite = 'Strict', now = Date.now } = {}) {
    super();
    if (!repository) throw new Error('永続セッション用repositoryが必要です。');
    this.repository = repository;
    this.ttlMs = ttlMs;
    this.secure = secure;
    this.sameSite = sameSite;
    this.now = now;
  }

  async create(user) {
    const token = newToken();
    const key = tokenHash(token);
    const session = { user, csrfToken: newToken(24), expiresAt: this.now() + this.ttlMs };
    await this.repository.insert({ tokenHash: key, session });
    return { token, session };
  }

  async getFromRequest(req) {
    const token = readSessionToken(req);
    if (!token) return null;
    const key = tokenHash(token);
    const session = await this.repository.findByTokenHash(key);
    if (!session || session.expiresAt <= this.now()) {
      if (session) await this.repository.deleteByTokenHash(key);
      return null;
    }
    return { key, session };
  }

  async destroy(req) {
    const token = readSessionToken(req);
    if (token) await this.repository.deleteByTokenHash(tokenHash(token));
  }

  cookie(token) { return buildCookie(token, this); }
  clearCookie() { return buildCookie('', this, 0); }
}

module.exports = { DatabaseSessionStore };
