'use strict';

class SessionStoreContract {
  async create() { throw new Error('SessionStore.create must be implemented'); }
  async getFromRequest() { throw new Error('SessionStore.getFromRequest must be implemented'); }
  async destroy() { throw new Error('SessionStore.destroy must be implemented'); }
  cookie() { throw new Error('SessionStore.cookie must be implemented'); }
  clearCookie() { throw new Error('SessionStore.clearCookie must be implemented'); }
}

module.exports = { SessionStoreContract };
