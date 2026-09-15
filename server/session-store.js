'use strict';

const crypto = require('node:crypto');

const COOKIE_NAME = 'mk1_owner_session';

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

class SessionStore {
  constructor({ ttlMs = 8 * 60 * 60 * 1000, secure = process.env.NODE_ENV === 'production' } = {}) {
    this.ttlMs = ttlMs;
    this.secure = secure;
    this.sessions = new Map();
  }

  create(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const session = {
      user,
      csrfToken: crypto.randomBytes(24).toString('base64url'),
      expiresAt: Date.now() + this.ttlMs
    };
    this.sessions.set(key, session);
    return { token, session };
  }

  getFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const session = this.sessions.get(key);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }
    return { key, session };
  }

  destroy(req) {
    const current = this.getFromRequest(req);
    if (current) this.sessions.delete(current.key);
  }

  cookie(token) {
    const secure = this.secure ? '; Secure' : '';
    return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.ttlMs / 1000)}${secure}`;
  }

  clearCookie() {
    const secure = this.secure ? '; Secure' : '';
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
  }
}

module.exports = { SessionStore, COOKIE_NAME, parseCookies };

