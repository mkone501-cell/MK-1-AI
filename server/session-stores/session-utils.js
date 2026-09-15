'use strict';

const crypto = require('node:crypto');
const COOKIE_NAME = 'mk1_owner_session';

function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { /* 壊れたCookieは認証失敗として扱います。 */ }
  }
  return cookies;
}

function tokenHash(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function newToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function readSessionToken(req) { return parseCookies(req.headers.cookie)[COOKIE_NAME] || null; }

module.exports = { COOKIE_NAME, parseCookies, tokenHash, newToken, readSessionToken };
