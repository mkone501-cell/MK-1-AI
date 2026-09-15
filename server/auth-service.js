'use strict';

const { verifyPassword } = require('./password');

class AuthService {
  constructor({ ownerEmail = '', passwordHash = '' } = {}) {
    this.ownerEmail = String(ownerEmail).trim().toLowerCase();
    this.passwordHash = String(passwordHash).trim();
  }

  get configured() {
    return Boolean(this.ownerEmail && this.passwordHash);
  }

  get incomplete() {
    return Boolean(this.ownerEmail || this.passwordHash) && !this.configured;
  }

  async authenticate(email, password) {
    if (!this.configured) return null;
    const emailMatches = String(email).trim().toLowerCase() === this.ownerEmail;
    const passwordMatches = await verifyPassword(password, this.passwordHash);
    if (!emailMatches || !passwordMatches) return null;
    return { id: 'owner-inoue', role: 'owner', displayName: '井上さん' };
  }
}

module.exports = { AuthService };

