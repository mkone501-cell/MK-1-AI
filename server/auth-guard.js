'use strict';

function createAuthGuard({ auth, sessions, sendJson }) {
  return async function requireOwner(req, res, { csrf = false, allowSetupMode = false } = {}) {
    if (!auth.configured) {
      if (allowSetupMode) return { setupMode: true };
      sendJson(req, res, 503, { error: '本人認証が設定されていません。', code: 'AUTH_NOT_CONFIGURED' });
      return null;
    }
    const current = await sessions.getFromRequest(req);
    if (!current?.session?.user || current.session.user.role !== 'owner') {
      sendJson(req, res, 401, { error: 'ログインが必要です。', code: 'AUTH_REQUIRED' });
      return null;
    }
    if (csrf && req.headers['x-csrf-token'] !== current.session.csrfToken) {
      sendJson(req, res, 403, { error: '安全確認に失敗しました。もう一度ログインしてください。', code: 'CSRF_INVALID' });
      return null;
    }
    return current.session;
  };
}

module.exports = { createAuthGuard };
