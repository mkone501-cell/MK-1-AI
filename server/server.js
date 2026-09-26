'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { MiraiService } = require('./mirai-service');
const { AuthService } = require('./auth-service');
const { loadConfig } = require('./config');
const { createSessionStore } = require('./session-store-factory');
const { createAuthGuard } = require('./auth-guard');
const { createLogger } = require('./safe-logger');
const { migrateSessions } = require('./session-stores/migrate-sessions');
const { PostgresConversationRepository, UUID } = require('./conversations/postgres-conversation-repository');
const { migrateConversations } = require('./conversations/migrate-conversations');
const { containsSecret } = require('./conversations/secret-filter');
const { PostgresKnowledgeRepository } = require('./knowledge/postgres-knowledge-repository');
const { migrateKnowledge } = require('./knowledge/migrate-knowledge');
const { validateKnowledge } = require('./knowledge/validation');
const { knowledgeContext } = require('./knowledge/context');
const { proposeMemory } = require('./knowledge/update-candidates');
const { detectManagementDataCandidate, detectManagementDataCandidates } = require('./management-data/candidates');
const { PostgresManagementDataRepository } = require('./management-data/postgres-management-data-repository');
const { migrateManagementData } = require('./management-data/migrate-management-data');
const { detectManagementDataQuery, managementDataContext, managementDataSummaryContext, managementDataComparisonContext, managementDataMonthlyComparisonContext, managementDataAnnualComparisonContext, managementDataMultiMonthContext, managementDataMultiYearContext, managementDataPeriodContext, managementDataFocusedPeriodContext, scopeManagementAnalysisInputs } = require('./management-data/query');

const ROOT = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 30;
const publicFiles = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/auth.js', 'auth.js'], ['/styles.css', 'styles.css']]);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}

function sendJson(res, status, value, extraHeaders = {}) {
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }));
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let rejected = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (rejected) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        rejected = true;
        reject(Object.assign(new Error('too large'), { statusCode: 413 }));
      }
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('invalid json'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function requestOriginAllowed(req, config) {
  const origin = req.headers.origin;
  if (!origin) return !config.production;
  try { return config.allowedOrigins.includes(new URL(origin).origin); }
  catch { return false; }
}

function createApplication(options = {}) {
  const config = options.config || loadConfig(options.env || process.env);
  const logger = options.logger || createLogger();
  const auth = options.auth || new AuthService({ ownerEmail: config.owner.email, passwordHash: config.owner.passwordHash });
  const sessions = options.sessions || createSessionStore(config, { sessionRepository: options.sessionRepository });
  const conversations = options.conversations || (config.session.driver === 'database' && sessions.repository?.pool ? new PostgresConversationRepository(sessions.repository.pool) : null);
  const knowledge = options.knowledge || (config.session.driver === 'database' && sessions.repository?.pool ? new PostgresKnowledgeRepository(sessions.repository.pool) : null);
  const managementData = options.managementData || (config.session.driver === 'database' && sessions.repository?.pool ? new PostgresManagementDataRepository(sessions.repository.pool) : null);
  const mirai = options.mirai || new MiraiService({
    // 認証未設定のサーバーから有料APIを利用しない安全弁です。
    apiKey: auth.configured ? config.openai.apiKey : '',
    model: config.openai.model
  });
  const rateBuckets = new Map();

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !requestOriginAllowed(req, config)) return { Vary: 'Origin' };
    return {
      'Access-Control-Allow-Origin': new URL(origin).origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin'
    };
  }

  function respondJson(req, res, status, value, extraHeaders = {}) {
    sendJson(res, status, value, { ...corsHeaders(req), ...extraHeaders });
  }

  const requireOwner = createAuthGuard({ auth, sessions, sendJson: respondJson });

  async function selectKnowledge(ownerId, message, req) {
    if (!knowledge) return { context:[], matches:[] };
    const matches = (await knowledge.relevant(ownerId, message)).filter(item => {
      const checked = validateKnowledge({ ...item, confirmed:true }, config, req);
      return checked && checked !== 'secret';
    });
    return { context:knowledgeContext(matches), matches };
  }

  function isRateLimited(req, scope = 'general', limit = RATE_LIMIT) {
    const key = `${scope}:${req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= 60_000) {
      rateBuckets.set(key, { startedAt: now, count: 1 });
      return false;
    }
    bucket.count += 1;
    return bucket.count > limit;
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if ((url.pathname.startsWith('/api/') || url.pathname === '/health') && req.headers.origin && !requestOriginAllowed(req, config)) {
      return respondJson(req, res, 403, { error: '許可されていない接続元です。', code: 'ORIGIN_NOT_ALLOWED' });
    }

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      res.writeHead(204, securityHeaders({ ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token', 'Access-Control-Max-Age': '600' }));
      return res.end();
    }

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      if (url.pathname === '/api/health' && config.production && !await requireOwner(req, res)) return;
      try {
        if (config.session.driver === 'database') await sessions.repository.check();
        return respondJson(req, res, 200, { ok: true, service: 'mk1-mirai', mode: mirai.mode, environment: config.environment, sessionStore: config.session.driver, authentication: auth.incomplete ? 'invalid' : auth.configured ? 'required' : 'setup', database: config.session.driver === 'database' ? 'connected' : 'unused' });
      } catch {
        logger.error('database.health_failed');
        return respondJson(req, res, 503, { ok: false, service: 'mk1-mirai', database: 'unavailable' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      const current = auth.configured ? await sessions.getFromRequest(req) : null;
      return respondJson(req, res, 200, {
        configured: auth.configured,
        authenticated: Boolean(current),
        user: current ? current.session.user : null,
        csrfToken: current ? current.session.csrfToken : null,
        conversationStorage: Boolean(conversations)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error: 'この画面からログインしてください。' });
      if (!auth.configured) return respondJson(req, res, 503, { error: 'ログイン設定がまだ完了していません。', code: 'AUTH_NOT_CONFIGURED' });
      if (isRateLimited(req, 'login', 5)) return respondJson(req, res, 429, { error: 'ログイン試行が多すぎます。1分後にお試しください。' });
      try {
        const body = await readJson(req);
        const user = await auth.authenticate(body.email, body.password);
        if (!user) return respondJson(req, res, 401, { error: 'メールアドレスまたはパスワードが違います。' });
        const { token, session } = await sessions.create(user);
        return respondJson(req, res, 200, { authenticated: true, user, csrfToken: session.csrfToken, conversationStorage:Boolean(conversations) }, { 'Set-Cookie': sessions.cookie(token) });
      } catch (error) {
        logger.warn('auth.login_failed');
        return respondJson(req, res, error.statusCode || 400, { error: 'ログイン情報を確認できませんでした。' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error: '安全確認に失敗しました。' });
      const session = await requireOwner(req, res, { csrf: true });
      if (!session) return;
      await sessions.destroy(req);
      return respondJson(req, res, 200, { authenticated: false }, { 'Set-Cookie': sessions.clearCookie() });
    }

    if (req.method === 'GET' && url.pathname === '/api/conversations') {
      const session = await requireOwner(req, res);
      if (!session) return;
      if (!conversations) return respondJson(req, res, 503, { error: '会話の保存機能が利用できません。' });
      try { return respondJson(req, res, 200, { conversations:await conversations.list(session.user.id) }); }
      catch { logger.error('conversation.read_failed'); return respondJson(req, res, 503, { error:'会話を取得できませんでした。' }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/conversations') {
      const session = await requireOwner(req, res, { csrf:true });
      if (!session) return;
      if (!conversations) return respondJson(req, res, 503, { error:'会話の保存機能が利用できません。' });
      if (isRateLimited(req, 'conversation-create', 10)) return respondJson(req, res, 429, { error:'新しい会話の作成が多すぎます。時間をおいてお試しください。' });
      try {
        const conversation = await conversations.create(session.user.id);
        return respondJson(req, res, 201, { conversation });
      } catch { logger.error('conversation.create_failed'); return respondJson(req, res, 503, { error:'新しい会話を作成できませんでした。' }); }
    }

    const messagesRoute = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
    if (req.method === 'GET' && messagesRoute) {
      const session = await requireOwner(req, res);
      if (!session) return;
      if (!UUID.test(messagesRoute[1])) return respondJson(req, res, 400, { error:'会話IDが正しくありません。' });
      if (!conversations) return respondJson(req, res, 503, { error:'会話の保存機能が利用できません。' });
      try {
        if (!await conversations.exists(session.user.id, messagesRoute[1])) return respondJson(req, res, 404, { error:'会話が見つかりません。' });
        return respondJson(req, res, 200, { messages:await conversations.messages(session.user.id, messagesRoute[1]) });
      } catch { logger.error('conversation.read_failed'); return respondJson(req, res, 503, { error:'会話を取得できませんでした。' }); }
    }

    if (url.pathname === '/api/knowledge/preview') {
      if (req.method !== 'POST') return respondJson(req, res, 405, { error:'この操作は利用できません。' });
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error:'この画面からご利用ください。' });
      const session = await requireOwner(req, res, { csrf:true });
      if (!session) return;
      if (!knowledge) return respondJson(req, res, 503, { error:'経営知識の検索機能が利用できません。' });
      if (isRateLimited(req, 'knowledge-preview', 20)) return respondJson(req, res, 429, { error:'検索回数が多すぎます。時間をおいてお試しください。' });
      try {
        const body = await readJson(req);
        const question = typeof body.question === 'string' ? body.question.trim() : '';
        if (!question || question.length > 8000) return respondJson(req, res, 400, { error:'質問を入力してください。' });
        if (containsSecret(question, config, req)) return respondJson(req, res, 400, { error:'認証情報を含む質問は検索できません。' });
        const selected = await selectKnowledge(session.user.id, question, req);
        return respondJson(req, res, 200, { knowledge:selected.context.map((item, index) => ({
          id:selected.matches[index].id, category:item.category, title:item.title
        })) });
      } catch { logger.error('knowledge.preview_failed'); return respondJson(req, res, 503, { error:'経営知識を検索できませんでした。' }); }
    }

    const updateApproval = /^\/api\/knowledge\/([^/]+)\/approve-update$/.exec(url.pathname);
    if (updateApproval) {
      if (req.method !== 'POST') return respondJson(req, res, 405, { error:'この操作は利用できません。' });
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error:'この画面からご利用ください。' });
      const session = await requireOwner(req, res, { csrf:true });
      if (!session) return;
      if (!knowledge) return respondJson(req, res, 503, { error:'経営知識を利用できません。' });
      if (!UUID.test(updateApproval[1])) return respondJson(req, res, 400, { error:'知識IDが正しくありません。' });
      if (isRateLimited(req, 'knowledge', 10)) return respondJson(req, res, 429, { error:'時間をおいてお試しください。' });
      try {
        const body = await readJson(req);
        if (body.confirmed !== true || typeof body.message !== 'string' || body.message.length > 500 ||
            typeof body.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedRevision) || typeof body.proposedBody !== 'string') {
          return respondJson(req, res, 400, { error:'更新には内容の比較と本人の明示的な確認が必要です。' });
        }
        const candidates = await proposeMemory(body.message, knowledge, session.user.id, config, req);
        const candidate = candidates.find(item => item.kind === 'update' && item.knowledgeId === updateApproval[1] &&
          item.expectedRevision === body.expectedRevision && item.body === body.proposedBody);
        if (!candidate) return respondJson(req, res, 409, { error:'情報が変更されたか対象を特定できません。最新の内容を再確認してください。' });
        const value = validateKnowledge({ ...candidate, confirmed:true }, config, req);
        if (!value || value === 'secret') return respondJson(req, res, 400, { error:'この内容は保存できません。' });
        const updated = await knowledge.approveUpdate(session.user.id, candidate.knowledgeId, value, candidate.expectedRevision);
        return respondJson(req, res, updated ? 200 : 409, updated ? { knowledge:updated } : { error:'情報が変更されました。最新の内容を再確認してください。' });
      } catch { logger.error('knowledge.approval_failed'); return respondJson(req, res, 503, { error:'更新を確認できませんでした。設定画面で現在の情報を確認してください。' }); }
    }

    const knowledgeRoute = /^\/api\/knowledge\/([^/]+)(\/disable)?$/.exec(url.pathname);
    if (url.pathname === '/api/knowledge' || knowledgeRoute) {
      const writing = req.method === 'PUT' || req.method === 'POST';
      if (req.method !== 'GET' && !writing) return respondJson(req, res, 405, { error:'この操作は利用できません。' });
      const session = await requireOwner(req, res, { csrf:writing });
      if (!session) return;
      if (!knowledge) return respondJson(req, res, 503, { error:'経営知識の保存機能が利用できません。' });
      if (knowledgeRoute && !UUID.test(knowledgeRoute[1])) return respondJson(req, res, 400, { error:'知識IDが正しくありません。' });
      if (writing && isRateLimited(req, 'knowledge', 10)) return respondJson(req, res, 429, { error:'操作が多すぎます。時間をおいてお試しください。' });
      try {
        const ownerId = session.user.id;
        if (req.method === 'GET' && !knowledgeRoute) return respondJson(req, res, 200, { knowledge:await knowledge.list(ownerId) });
        if (req.method === 'GET' && knowledgeRoute && !knowledgeRoute[2]) {
          const item = await knowledge.get(ownerId, knowledgeRoute[1]);
          return respondJson(req, res, item ? 200 : 404, item ? { knowledge:item } : { error:'知識が見つかりません。' });
        }
        const body = await readJson(req);
        if (knowledgeRoute?.[2]) {
          if (req.method !== 'POST' || body.confirmed !== true) return respondJson(req, res, 400, { error:'無効化には本人の明示的な確認が必要です。' });
          const item = await knowledge.disable(ownerId, knowledgeRoute[1]);
          return respondJson(req, res, item ? 200 : 404, item ? { knowledge:item } : { error:'知識が見つかりません。' });
        }
        if ((req.method === 'POST' && knowledgeRoute) || (req.method === 'PUT' && !knowledgeRoute)) return respondJson(req, res, 405, { error:'この操作は利用できません。' });
        const value = validateKnowledge(body, config, req);
        if (value === 'secret') return respondJson(req, res, 400, { error:'認証情報の可能性がある内容は登録できません。' });
        if (!value) return respondJson(req, res, 400, { error:'カテゴリ・タイトル・本文・情報源と確認が必要です。' });
        // Recheck even submissions from a stale Phase 5.3 UI: never turn an update into an insert.
        if (!knowledgeRoute) {
          const proposals = await proposeMemory(value.body, knowledge, ownerId, config, req);
          if (proposals.some(item => ['update', 'review', 'duplicate'].includes(item.kind))) {
            return respondJson(req, res, 409, { error:'既存情報との更新・重複の確認が必要です。会話の更新候補または設定画面で確認してください。', code:'KNOWLEDGE_REVIEW_REQUIRED', memoryCandidates:proposals });
          }
        }
        const item = knowledgeRoute ? await knowledge.update(ownerId, knowledgeRoute[1], value) : await knowledge.create(ownerId, value);
        return respondJson(req, res, item ? knowledgeRoute ? 200 : 201 : 404, item ? { knowledge:item } : { error:'知識が見つかりません。' });
      } catch { logger.error('knowledge.request_failed'); return respondJson(req, res, 503, { error:'経営知識を処理できませんでした。時間をおいてお試しください。' }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/management-data/confirm') {
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error:'この画面からご利用ください。' });
      const session = await requireOwner(req, res, { csrf:true });
      if (!session) return;
      if (!managementData) return respondJson(req, res, 503, { error:'経営数値の保存機能が利用できません。' });
      if (isRateLimited(req, 'management-data', 10)) return respondJson(req, res, 429, { error:'操作が多すぎます。時間をおいてお試しください。' });
      try {
        const body = await readJson(req);
        if (body.confirmed !== true || typeof body.originalText !== 'string') {
          return respondJson(req, res, 400, { error:'保存には本人の明示的な確認が必要です。' });
        }
        const candidate = detectManagementDataCandidates(body.originalText).find(item =>
          item.businessKey && item.dataDate &&
          item.metricType === body.metricType && item.amount === Number(body.amount) &&
          item.currency === body.currency && item.businessKey === body.businessKey &&
          item.dataDate === body.dataDate
        );
        if (!candidate) {
          return respondJson(req, res, 409, { error:'事業・日付・数値を安全に確認できません。もう一度会話から入力してください。' });
        }
        const saved = await managementData.create(auth.ownerEmail, {
          ...candidate,
          confirmed:true,
          source:'owner confirmed conversation',
          note:candidate.originalText
        });
        if (!saved) return respondJson(req, res, 400, { error:'経営数値を保存できませんでした。内容を確認してください。' });
        return respondJson(req, res, 201, { managementData:saved });
      } catch {
        logger.error('management_data.confirm_failed');
        return respondJson(req, res, 503, { error:'経営数値を保存できませんでした。時間をおいてお試しください。' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error: 'この画面からミライをご利用ください。' });
      const session = await requireOwner(req, res, { csrf: auth.configured, allowSetupMode: !config.production });
      if (!session) return;
      if (isRateLimited(req, 'chat')) return respondJson(req, res, 429, { error: 'しばらく待ってから、もう一度お試しください。' });
      try {
        const body = await readJson(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message || message.length > 8000) return respondJson(req, res, 400, { error: 'メッセージは1文字以上8,000文字以内で入力してください。' });
        if (session.user && conversations) {
          const id = body.conversationId;
          if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) return respondJson(req, res, 400, { error:'会話IDが正しくありません。' });
          if (containsSecret(message, config, req)) return respondJson(req, res, 400, { error:'認証情報を含むメッセージは送信できません。' });
          let history = [];
          try {
            if (id) {
              history = await conversations.context(session.user.id, id);
              if (!history) return respondJson(req, res, 404, { error:'会話が見つかりません。' });
            }
          } catch { logger.error('conversation.read_failed'); return respondJson(req, res, 503, { error:'会話を取得できませんでした。' }); }
          let replyHistory = history;
          let selectedKnowledge = [];
          if (knowledge) {
            try {
              selectedKnowledge = (await selectKnowledge(session.user.id, message, req)).context;
            } catch { logger.error('knowledge.search_failed'); return respondJson(req, res, 503, { error:'経営情報を確認できませんでした。時間をおいてお試しください。' }); }
          }
          let proposals = [];
          if (knowledge) {
            try { proposals = await proposeMemory(message, knowledge, session.user.id, config, req); }
            catch { logger.error('knowledge.candidate_failed'); return respondJson(req, res, 503, { error:'既存の経営知識を確認できませんでした。時間をおいてお試しください。' }); }
          }
          const managementDataCandidates = detectManagementDataCandidates(message);
          if (managementData) {
            const managementQuery = detectManagementDataQuery(message);
            if (managementQuery) {
              try {
                if (managementQuery.metricType === 'annual_period_analysis') {
                  const groups = [];
                  for (const year of managementQuery.years) {
                    groups.push({
                      ...year,
                      entries:await managementData.findRange(auth.ownerEmail, { businessKey:managementQuery.businessKey, startDate:year.startDate, endDate:year.endDate })
                    });
                  }
                  const context = managementDataMultiYearContext(groups);
                  const scoped = scopeManagementAnalysisInputs({ query:managementQuery, history:replyHistory, knowledge:selectedKnowledge, context });
                  replyHistory = scoped.history;
                  selectedKnowledge = scoped.knowledge;
                } else if (managementQuery.metricType === 'annual_comparison') {
                  const groups = [];
                  for (const year of managementQuery.years) {
                    groups.push({
                      ...year,
                      entries:await managementData.findRange(auth.ownerEmail, { businessKey:managementQuery.businessKey, startDate:year.startDate, endDate:year.endDate })
                    });
                  }
                  const context = managementDataAnnualComparisonContext(groups);
                  const scoped = scopeManagementAnalysisInputs({ query:managementQuery, history:replyHistory, knowledge:selectedKnowledge, context });
                  replyHistory = scoped.history;
                  selectedKnowledge = scoped.knowledge;
                } else if (managementQuery.metricType === 'monthly_period_analysis') {
                  const groups = [];
                  for (const month of managementQuery.months) {
                    groups.push({
                      ...month,
                      entries:await managementData.findRange(auth.ownerEmail, { businessKey:managementQuery.businessKey, startDate:month.startDate, endDate:month.endDate })
                    });
                  }
                  const context = managementDataMultiMonthContext(groups);
                  const scoped = scopeManagementAnalysisInputs({ query:managementQuery, history:replyHistory, knowledge:selectedKnowledge, context });
                  replyHistory = scoped.history;
                  selectedKnowledge = scoped.knowledge;
                } else if (managementQuery.metricType === 'monthly_comparison') {
                  const groups = [];
                  for (const month of managementQuery.months) {
                    groups.push({
                      ...month,
                      entries:await managementData.findRange(auth.ownerEmail, { businessKey:managementQuery.businessKey, startDate:month.startDate, endDate:month.endDate })
                    });
                  }
                  const context = managementDataMonthlyComparisonContext(groups);
                  const scoped = scopeManagementAnalysisInputs({ query:managementQuery, history:replyHistory, knowledge:selectedKnowledge, context });
                  replyHistory = scoped.history;
                  selectedKnowledge = scoped.knowledge;
                } else if (managementQuery.metricType === 'period_analysis') {
                  const entries = await managementData.findRange(auth.ownerEmail, managementQuery);
                  const context = managementQuery.analysisFocus
                    ? managementDataFocusedPeriodContext(entries, managementQuery.startDate, managementQuery.endDate, managementQuery.analysisFocus)
                    : managementDataPeriodContext(entries, managementQuery.startDate, managementQuery.endDate);
                  const scoped = scopeManagementAnalysisInputs({ query:managementQuery, history:replyHistory, knowledge:selectedKnowledge, context });
                  replyHistory = scoped.history;
                  selectedKnowledge = scoped.knowledge;
                } else if (managementQuery.metricType === 'daily_comparison') {
                  const groups = [];
                  for (const dataDate of managementQuery.dataDates) {
                    groups.push({ dataDate, entries:await managementData.findDaily(auth.ownerEmail, { ...managementQuery, dataDate }) });
                  }
                  const context = managementDataComparisonContext(groups);
                  const scoped = scopeManagementAnalysisInputs({ query:managementQuery, history:replyHistory, knowledge:selectedKnowledge, context });
                  replyHistory = scoped.history;
                  selectedKnowledge = scoped.knowledge;
                } else if (managementQuery.metricType === 'daily_summary' || managementQuery.metricType === 'daily_analysis') {
                  const entries = await managementData.findDaily(auth.ownerEmail, managementQuery);
                  const context = managementQuery.metricType === 'daily_analysis'
                    ? (managementQuery.analysisFocus
                      ? managementDataFocusedPeriodContext(entries, managementQuery.dataDate, managementQuery.dataDate, managementQuery.analysisFocus)
                      : managementDataPeriodContext(entries, managementQuery.dataDate, managementQuery.dataDate))
                    : managementDataSummaryContext(entries);
                  if (managementQuery.metricType === 'daily_analysis') {
                    const scoped = scopeManagementAnalysisInputs({ query:managementQuery, history:replyHistory, knowledge:selectedKnowledge, context });
                    replyHistory = scoped.history;
                    selectedKnowledge = scoped.knowledge;
                  } else if (context) {
                    selectedKnowledge = [...selectedKnowledge, context];
                  }
                } else {
                  const entry = await managementData.findExact(auth.ownerEmail, managementQuery);
                  const context = managementDataContext(entry);
                  if (context) selectedKnowledge = [...selectedKnowledge, context];
                }
              } catch {
                logger.error('management_data.search_failed');
                return respondJson(req, res, 503, { error:'経営数値を確認できませんでした。時間をおいてお試しください。' });
              }
            }
          }
          const result = await mirai.reply({ message, history:replyHistory, knowledge:selectedKnowledge });
          if (typeof result.answer !== 'string' || containsSecret(result.answer, config, req)) {
            logger.error('conversation.answer_rejected');
            return respondJson(req, res, 502, { error:'ミライの回答を安全に保存できませんでした。' });
          }
          try {
            const conversationId = await conversations.appendExchange({ ownerId:session.user.id, conversationId:id, message, answer:result.answer });
            return respondJson(req, res, 200, { ...result, conversationId,
              memoryCandidates:proposals,
              managementDataCandidates });
          } catch {
            logger.error('conversation.save_failed');
            return respondJson(req, res, 503, { error:'会話を保存できませんでした。時間をおいてお試しください。' });
          }
        }
        const history = Array.isArray(body.history) ? body.history : [];
        return respondJson(req, res, 200, await mirai.reply({ message, history }));
      } catch (error) {
        const status = error.statusCode || 502;
        const diagnostic = error.providerStatus ? { status, providerStatus: error.providerStatus, category: error.providerCategory || 'unknown' } : { status };
        logger.error('mirai.request_failed', diagnostic);
        return respondJson(req, res, status, { error: status === 502 ? 'ミライとの通信に失敗しました。時間をおいてお試しください。' : 'リクエストを確認できませんでした。' });
      }
    }

    // 将来の非公開APIは必ずこの共通ガードを通すテンプレートです。
    if (req.method === 'GET' && url.pathname === '/api/private/ping') {
      const session = await requireOwner(req, res);
      if (!session) return;
      return respondJson(req, res, 200, { ok: true, role: session.user.role });
    }

    if (req.method === 'GET' && publicFiles.has(url.pathname)) {
      const file = path.join(ROOT, publicFiles.get(url.pathname));
      const type = contentTypes[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, securityHeaders({ 'Content-Type': type, 'Cache-Control': 'no-cache' }));
      return fs.createReadStream(file).pipe(res);
    }

    respondJson(req, res, 404, { error: '見つかりません。' });
  }

  return { handler, auth, sessions, conversations, knowledge, managementData, mirai, config };
}

function createServer(options = {}) {
  const app = createApplication(options);
  return http.createServer((req, res) => app.handler(req, res).catch(error => {
    (options.logger || createLogger()).error('server.unhandled');
    if (!res.headersSent) sendJson(res, 500, { error: 'サーバーエラーが発生しました。' });
    else res.end();
  }));
}

async function start(options = {}) {
  const app = createApplication(options);
  if (app.auth.incomplete) {
    throw new Error('MK1_OWNER_EMAILとMK1_OWNER_PASSWORD_HASHの両方を設定してください。');
  }
  if (app.config.session.driver === 'database') {
    await migrateSessions(app.sessions.repository);
    await migrateConversations(app.conversations);
    await migrateKnowledge(app.knowledge);
    await migrateManagementData(app.managementData);
    await app.sessions.repository.check();
  }
  const server = createServer({ ...options, config: app.config, auth: app.auth, sessions: app.sessions, conversations: app.conversations, knowledge: app.knowledge, managementData: app.managementData, mirai: app.mirai });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(app.config.port, '0.0.0.0', resolve); });
  console.log(`MK-1 AI経営本部: ポート ${server.address().port} で起動しました。`);
  return server;
}

if (require.main === module) {
  start().catch(() => {
    console.error('起動できませんでした。DATABASE_URL、PostgreSQL接続、認証とOrigin設定をRailwayで確認してください。秘密情報はログに表示しません。');
    process.exitCode = 1;
  });
}

module.exports = { createApplication, createServer, start, securityHeaders, requestOriginAllowed };
