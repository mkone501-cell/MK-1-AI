'use strict';

// PostgreSQL等の固有クライアントをこの境界の外側へ閉じ込めます。
class SessionRepositoryContract {
  async insert() { throw new Error('SessionRepository.insert must be implemented'); }
  async findByTokenHash() { throw new Error('SessionRepository.findByTokenHash must be implemented'); }
  async deleteByTokenHash() { throw new Error('SessionRepository.deleteByTokenHash must be implemented'); }
}

module.exports = { SessionRepositoryContract };
