'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

async function hashPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('パスワードは12文字以上にしてください。');
  }
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, saltText, hashText] = String(storedHash).split('$');
    if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64url');
    const actual = await scrypt(String(password), Buffer.from(saltText, 'base64url'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };

