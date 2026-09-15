'use strict';

const { SessionStoreContract } = require('./session-store-contract');
const { COOKIE_NAME, tokenHash, newToken, readSessionToken } = require('./session-utils');

class MemorySessionStore extends SessionStoreContract {
  constructor({ ttlMs = 8 * 60 * 60 * 1000, secure = false, sameSite = 'Strict', now = Date.now } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.secure = secure;
    this.sameSite = sameSite;
    this.now = now;
    this.sessions = new Map();
  }

  async create(user) {
    const token = newToken();
    const key = tokenHash(token);
    const session = { user, csrfToken: newToken(24), expiresAt: this.now() + this.ttlMs };
    this.sessions.set(key, session);
    return { token, session };
  }

  async getFromRequest(req) {
    const token = readSessionToken(req);
    if (!token) return null;
    const key = tokenHash(token);
    const session = this.sessions.get(key);
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return null;
    }
    return { key, session };
  }

  async destroy(req) {
    const current = await this.getFromRequest(req);
    if (current) this.sessions.delete(current.key);
  }

  cookie(token) { return buildCookie(token, this); }
  clearCookie() { return buildCookie('', this, 0); }
}

function buildCookie(token, options, maxAge = Math.floor(options.ttlMs / 1000)) {
  const secure = options.secure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=${options.sameSite}; Path=/; Max-Age=${maxAge}${secure}`;
}

module.exports = { MemorySessionStore, buildCookie };
