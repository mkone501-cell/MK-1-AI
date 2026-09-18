const APP_VERSION = '0.1.0';
const STORAGE_KEY = 'mk1-ai-headquarters-v01';

const initialState = {
  clients: [{ id: 'client-nsb', name: 'NORTH STAR BEANS', industry: 'スペシャルティコーヒー', contact: 'MK-1 自社事業' }],
  projects: [{ id: 'project-ec', clientId: 'client-nsb', name: 'EC売上アップ計画', goal: 'コーヒー豆のEC販売を伸ばす', status: '進行中', progress: 62, startedAt: '2026-09-01' }],
  conversations: [
    { id: 'msg-1', role: 'assistant', text: 'おはようございます。AI秘書のミライです。\nNORTH STAR BEANSの広告企画が進行中です。今日は何を進めましょうか？', createdAt: '2026-09-15T09:00:00Z' }
  ],
  tasks: [
    { id: 'task-1', projectId: 'project-ec', agent: '広告戦略AI', title: '秋の新規顧客キャンペーン設計', status: '作業中', progress: 72 },
    { id: 'task-2', projectId: 'project-ec', agent: '制作AI', title: 'Instagram動画広告 3案', status: '作業中', progress: 45 },
    { id: 'task-3', projectId: 'project-ec', agent: '分析AI', title: '9月前半の広告結果分析', status: '完了', progress: 100 },
    { id: 'task-4', projectId: 'project-ec', agent: '広告運用AI', title: '広告予算の配分案', status: '承認待ち', progress: 100 }
  ],
  responses: [{ id: 'response-1', taskId: 'task-3', summary: 'リピーター向け広告の費用対効果が高く、継続を推奨します。', createdAt: '2026-09-14T05:00:00Z' }],
  adPlans: [
    { id: 'ad-1', projectId: 'project-ec', type: 'Instagram動画', title: '朝を変える、一杯。', description: '忙しい朝にも、豆を挽く小さな余白を提案する15秒動画。', status: '確認中' },
    { id: 'ad-2', projectId: 'project-ec', type: 'Instagram画像', title: '産地から届く物語', description: '生産者と豆の背景を伝え、品質への信頼につなげる投稿。', status: '下書き' },
    { id: 'ad-3', projectId: 'project-ec', type: '再訪問広告', title: 'もう一度、あの香りを。', description: '商品を見た方に、送料無料特典を提案する広告案。', status: '承認待ち' }
  ],
  approvals: [
    { id: 'approval-1', projectId: 'project-ec', category: '広告費', title: 'Instagram広告 テスト配信', description: '3種類の広告を7日間テストします。上限を超えて使うことはありません。', amount: 30000, status: '承認待ち', requestedBy: '広告運用AI', requestedAt: '2026-09-15T02:30:00Z', decidedAt: null },
    { id: 'approval-2', projectId: 'project-ec', category: '外部公開', title: 'Instagram動画広告の公開', description: '「朝を変える、一杯。」の動画案を外部公開します。', amount: 0, status: '承認待ち', requestedBy: '制作AI', requestedAt: '2026-09-14T08:00:00Z', decidedAt: null }
  ],
  adMetrics: [{ id: 'metric-1', projectId: 'project-ec', period: '2026-09', spend: 128400, clicks: 3821, conversions: 142, cpa: 904, roas: 3.42 }],
  salesMetrics: [{ id: 'sales-1', projectId: 'project-ec', period: '2026-09', revenue: 439200, orders: 142 }],
  auditLog: [{ id: 'log-1', actor: '分析AI', action: '分析レポートを作成', target: '9月前半の広告結果', createdAt: '2026-09-14T05:00:00Z' }],
  settings: { companyName: '株式会社MK-1', ownerName: '代表者', approvalRequired: true }
};

const agents = [
  ['🤝','営業AI','問い合わせを整理し、提案や追客の案を作ります。'],
  ['🎯','広告戦略AI','商品・競合・お客様を分析し、広告計画を作ります。'],
  ['✦','制作AI','文章、画像案、動画台本、商品紹介を作ります。'],
  ['📣','広告運用AI','予算配分や改善案を作ります。実行前に必ず承認を待ちます。'],
  ['📊','分析AI','売上や広告結果を分析し、次の改善を提案します。']
];

const navItems = [
  ['home','⌂','ホーム'], ['chat','✦','AI秘書'], ['projects','▣','案件一覧'], ['agents','◉','AI担当の状況'],
  ['approvals','✓','承認待ち'], ['ads','◇','広告案'], ['reports','▥','分析レポート'], ['settings','⚙','設定']
];

let state = loadState();
let currentRoute = location.hash.replace('#/', '') || 'home';
let serverConversation = false;
let activeConversationId = null;
let conversationLoading = false;
let newConversationPending = false;
let conversationGeneration = 0;
let knowledgeItems = [];
// Unapproved candidates stay in memory only; never localStorage or the knowledge DB.
let memoryProposals = [];
let proposalSequence = 0;
let editingKnowledgeId = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(initialState); }
  catch { return clone(initialState); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(serverConversation ? { ...state, conversations:clone(initialState.conversations) } : state)); }
function yen(value) { return `¥${Number(value).toLocaleString('ja-JP')}`; }
function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}
function waitingCount() { return state.approvals.filter(item => item.status === '承認待ち').length; }
function routeTo(route) { location.hash = `#/${route}`; }
function showToast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }
function iconFor(agent) { return agents.find(a => a[1] === agent)?.[0] || '✦'; }
function statusPill(status) { return `<span class="pill ${status === '承認待ち' ? 'waiting' : status === '完了' || status === '承認済み' ? 'done' : status === '却下' ? 'danger' : ''}">${safe(status)}</span>`; }

function renderNav() {
  document.querySelector('#main-nav').innerHTML = navItems.map(([route, icon, label]) => `<button class="nav-item ${route === currentRoute ? 'active' : ''}" data-route="${route}"><span>${icon}</span>${label}${route === 'approvals' && waitingCount() ? `<span class="badge">${waitingCount()}</span>` : ''}</button>`).join('');
  document.querySelector('#notice-count').textContent = waitingCount();
  document.querySelector('#page-title').textContent = navItems.find(x => x[0] === currentRoute)?.[2] || '案件詳細';
}

function homeView() {
  const metric = state.adMetrics[0], sales = state.salesMetrics[0];
  return `<div class="welcome"><div><h2>おはようございます、代表。</h2><p>今日もAIチームが事業を前に進めています。</p></div><span class="date-pill">2026年9月15日 火曜日</span></div>
  <div class="metrics">
    ${metricCard('今月のEC売上',yen(sales.revenue),'↗ 前月比 18.4%','¥')}
    ${metricCard('広告の効果',`${metric.roas.toFixed(2)}倍`,'広告費1円が3.42円の売上に','↗')}
    ${metricCard('獲得単価',yen(metric.cpa),'目標 ¥1,000以内','◎')}
    ${metricCard('承認待ち',`${waitingCount()}件`,'確認をお願いします','✓','warn')}
  </div>
  <div class="dashboard-grid"><div class="stack">
    <div class="card"><div class="section-head"><h3>AIチームの作業状況</h3><button class="link-button" data-route="agents">すべて見る →</button></div>${state.tasks.slice(0,4).map(taskRow).join('')}</div>
    <div class="card"><div class="section-head"><h3>売上の推移</h3><button class="link-button" data-route="reports">詳しいレポート →</button></div>${chart()}</div>
  </div><div class="stack">
    <div class="card approval-box"><div class="section-head"><h3>承認をお願いします</h3>${statusPill(`${waitingCount()}件`)}</div>${state.approvals.filter(x=>x.status==='承認待ち').slice(0,2).map(approvalMini).join('') || empty('承認待ちはありません','AIは重要な操作を実行していません。')}</div>
    <div class="card"><div class="section-head"><h3>AI秘書に相談</h3></div><p style="color:var(--muted);font-size:13px;line-height:1.8">売上、広告案、進み具合など、普通の言葉で話しかけてください。</p><button class="primary" data-route="chat">ミライに相談する →</button></div>
  </div></div>`;
}
function metricCard(label,value,note,icon,extra='') { return `<div class="card"><div class="metric-label">${label}<span class="metric-icon">${icon}</span></div><div class="metric-value">${value}</div><span class="trend ${extra}">${note}</span></div>`; }
function taskRow(t) { return `<div class="task-row"><span class="agent-icon">${iconFor(t.agent)}</span><div class="row-main"><strong>${safe(t.title)}</strong><small>${safe(t.agent)}</small><div class="progress"><i style="width:${t.progress}%"></i></div></div>${statusPill(t.status)}</div>`; }
function approvalMini(a) { return `<div class="approval-row"><span class="agent-icon">${a.category==='広告費'?'¥':'↗'}</span><div class="row-main"><strong>${safe(a.title)}</strong><small>${a.amount ? `上限 ${yen(a.amount)}・` : ''}${safe(a.requestedBy)}</small><div class="button-row"><button class="primary" data-approval="${a.id}" data-decision="承認済み">承認する</button><button class="secondary" data-route="approvals">詳細</button></div></div></div>`; }
function chart() { return `<div class="report-chart">${[38,48,42,62,58,78,88,76,96].map((h,i)=>`<div class="bar" style="height:${h}%"><span>${i+1}月</span></div>`).join('')}</div>`; }
function empty(title,text) { return `<div class="empty">◌<b>${title}</b><span>${text}</span></div>`; }

function chatView() { const waiting=conversationLoading || newConversationPending; return `<div class="chat-layout"><div class="card chat-card"><div class="chat-header"><span class="agent-icon">✦</span><div><strong>AI秘書 ミライ</strong><small style="display:block;color:var(--muted)"><span class="status-dot"></span>対応できます</small></div>${serverConversation ? `<button class="secondary" type="button" id="new-conversation" ${waiting ? 'disabled' : ''}>＋ 新しい会話</button>` : ''}</div><div class="messages" id="messages">${state.conversations.map(m=>`<div class="message ${m.role === 'user' ? 'user':''}"><div class="bubble">${safe(m.text)}</div></div>`).join('')}${serverConversation && !state.conversations.length ? '<div class="empty">新しい会話です。ミライへ質問してください。</div>' : ''}${serverConversation ? memoryProposals.map(memoryCandidateView).join('') : ''}</div><form class="composer" id="chat-form"><textarea id="chat-input" placeholder="ミライに相談する…" aria-label="メッセージ" ${waiting ? 'disabled' : ''} required></textarea><button type="submit" aria-label="送信" ${waiting ? 'disabled' : ''}>➤</button></form></div>
  <div class="card suggestions"><h3>相談の例</h3><p style="font-size:12px;color:var(--muted)">押すと入力できます。</p>${['今月の広告結果はどう？','新しい広告動画を3案作って','Instagram広告を考えて','今、何を承認すればいい？'].map(x=>`<button data-suggestion="${x}">${x}</button>`).join('')}<div class="notice" style="margin-top:20px">ミライは提案と下書きを作ります。広告費の使用や外部公開は、代表の承認なしに実行しません。</div></div></div>`; }
function projectsView() { return `<div class="page-head"><div><h2>案件一覧</h2><p>クライアントごとの仕事と進み具合を確認できます。</p></div><button class="primary" id="new-project">＋ 新しい案件（準備中）</button></div><div class="card table-card"><table><thead><tr><th>クライアント / 案件</th><th>目的</th><th>進み具合</th><th>状態</th><th></th></tr></thead><tbody>${state.projects.map(p=>{const c=state.clients.find(c=>c.id===p.clientId);return `<tr><td><span class="client-badge">NS</span><strong>${safe(c.name)}</strong><br><small>${safe(p.name)}</small></td><td>${safe(p.goal)}</td><td><div class="progress" style="width:120px"><i style="width:${p.progress}%"></i></div><small>${p.progress}%</small></td><td>${statusPill(p.status)}</td><td><button class="secondary" data-project="${p.id}">詳細を見る</button></td></tr>`}).join('')}</tbody></table></div>`; }
function projectDetail(id) { const p=state.projects.find(x=>x.id===id)||state.projects[0], c=state.clients.find(x=>x.id===p.clientId); return `<div class="page-head"><div><button class="link-button" data-route="projects">← 案件一覧</button><h2>${safe(p.name)}</h2><p>${safe(c.name)} ・ ${safe(p.goal)}</p></div>${statusPill(p.status)}</div><div class="metrics">${metricCard('進み具合',`${p.progress}%`,'計画どおり進行中','◎')}${metricCard('作業中',`${state.tasks.filter(x=>x.status==='作業中').length}件`,'AIチームが対応中','✦')}${metricCard('広告案',`${state.adPlans.length}案`,'1案が承認待ち','◇')}${metricCard('今月の売上',yen(state.salesMetrics[0].revenue),'前月比 18.4%','¥')}</div><div class="dashboard-grid"><div class="card"><div class="section-head"><h3>この案件の作業</h3></div>${state.tasks.map(taskRow).join('')}</div><div class="card"><h3>案件情報</h3><p><small>クライアント</small><br><strong>${safe(c.name)}</strong></p><p><small>開始日</small><br><strong>${p.startedAt}</strong></p><p><small>目標</small><br><strong>${safe(p.goal)}</strong></p></div></div>`; }
function agentsView() { return `<div class="page-head"><div><h2>AI広告事業部</h2><p>5人のAI担当が役割を分けて作業します。</p></div></div><div class="agents-grid">${agents.map(([icon,name,desc])=>{const tasks=state.tasks.filter(t=>t.agent===name);return `<div class="card agent-card"><span class="agent-icon">${icon}</span><h3>${name}</h3><p>${desc}</p>${tasks.length ? tasks.map(taskRow).join('') : '<div class="pill done">待機中</div>'}</div>`}).join('')}</div>`; }
function approvalsView() { const pending=state.approvals.filter(x=>x.status==='承認待ち'), history=state.approvals.filter(x=>x.status!=='承認待ち'); return `<div class="page-head"><div><h2>承認待ち</h2><p>お金の使用や外部公開など、重要な操作はここで止まります。</p></div>${statusPill(`${pending.length}件の確認`)}</div><div class="notice" style="margin-bottom:18px"><strong>安全の仕組み：</strong>「承認する」を押しても、このVer.0.1では外部サービスへの実行は行いません。判断と履歴だけを安全に保存します。</div><div class="card">${pending.map(approvalDetail).join('') || empty('すべて確認済みです','新しい提案が届くまで、重要な操作は行われません。')}</div>${history.length?`<div class="card" style="margin-top:20px"><div class="section-head"><h3>承認・却下の履歴</h3></div>${history.map(approvalDetail).join('')}</div>`:''}`; }
function approvalDetail(a) { return `<div class="approval-detail"><span class="agent-icon">${a.category==='広告費'?'¥':'↗'}</span><div class="row-main"><div>${statusPill(a.status)} <small>${safe(a.category)}</small></div><h3>${safe(a.title)}</h3><p style="color:var(--muted);font-size:13px;line-height:1.7">${safe(a.description)}</p><small>提案：${safe(a.requestedBy)} ・ ${new Date(a.requestedAt).toLocaleString('ja-JP')}${a.amount?` ・ 上限 ${yen(a.amount)}`:''}</small></div>${a.status==='承認待ち'?`<div class="button-row"><button class="primary" data-approval="${a.id}" data-decision="承認済み">承認する</button><button class="danger-button" data-approval="${a.id}" data-decision="却下">却下する</button></div>`:''}</div>`; }
function adsView() { return `<div class="page-head"><div><h2>広告案</h2><p>制作AIが作った案です。外部にはまだ公開されていません。</p></div><button class="primary" data-route="chat">＋ AI秘書に新しい案を依頼</button></div><div class="ads-grid">${state.adPlans.map((a,i)=>`<div class="card"><div class="ad-preview"><div><small>NORTH STAR BEANS</small><br><b>${safe(a.title)}</b></div></div>${statusPill(a.status)} <small>${safe(a.type)}</small><h3>${safe(a.title)}</h3><p style="color:var(--muted);font-size:13px;line-height:1.7">${safe(a.description)}</p><button class="secondary" data-ad="${a.id}">内容を見る</button></div>`).join('')}</div>`; }
function reportsView() { const m=state.adMetrics[0], s=state.salesMetrics[0]; return `<div class="page-head"><div><h2>9月の分析レポート</h2><p>NORTH STAR BEANS ・ 2026年9月1日〜15日</p></div><button class="secondary" id="download-report">レポートを保存</button></div><div class="metrics">${metricCard('売上',yen(s.revenue),'↗ 前月比 18.4%','¥')}${metricCard('広告費',yen(m.spend),'予算内で進行中','◎')}${metricCard('購入数',`${m.conversions}件`,'↗ 前月比 12.7%','▣')}${metricCard('広告の効果',`${m.roas.toFixed(2)}倍`,'目標 3.0倍を達成','↗')}</div><div class="dashboard-grid"><div class="card"><div class="section-head"><h3>EC売上の推移</h3></div>${chart()}</div><div class="card"><h3>AIからの分かりやすいまとめ</h3><p style="line-height:1.8;color:var(--muted)">広告費1円あたり、約3.42円の売上につながっています。特に、一度商品を見たお客様への広告が好調です。</p><div class="notice"><strong>次の提案</strong><br>好調な広告を続けながら、新しい動画3案を少額で比較することをおすすめします。費用を使う前に承認をお願いします。</div></div></div>`; }
function memoryCandidateView(item) {
  return `<section class="memory-candidate notice" aria-label="長期記憶への登録候補"><strong>長期記憶への登録候補があります</strong><p>まだ登録していません。対象の店舗・事業と内容を確認してください。外部操作の承認ではありません。</p><small>${safe(item.category)}</small><h3>${safe(item.title)}</h3><p>${safe(item.body)}</p><p>登録理由：${safe(item.source)}</p><div class="knowledge-actions"><button type="button" class="primary" data-memory-accept="${safe(item.id)}" ${item.pending ? 'disabled' : ''}>登録する</button><button type="button" class="secondary" data-memory-dismiss="${safe(item.id)}" ${item.pending ? 'disabled' : ''}>今回は登録しない</button></div></section>`;
}

async function decideMemoryCandidate(id, accept) {
  const item = memoryProposals.find(item => item.id === id);
  if (!serverConversation || !item || item.pending) return;
  if (!accept) { memoryProposals = memoryProposals.filter(value => value !== item); render(); return; }
  item.pending = true;
  render();
  try {
    const { category, title, body, source } = item;
    const response = await fetch('api/knowledge', { method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ category, title, body, source, confirmed:true }) });
    if (!response.ok) throw new Error('registration failed');
    memoryProposals = memoryProposals.filter(value => value !== item);
    showToast('確認した内容を長期記憶に登録しました。');
    await loadKnowledge();
  } catch { showToast('登録を確認できませんでした。設定の登録済み知識を確認してから再度お試しください。'); }
  finally { item.pending = false; render(); }
}

function knowledgeItemView(item) {
  return `<article class="knowledge-item"><div class="knowledge-content"><small>${safe(item.category)} ・ ${item.active ? '有効' : '無効'}</small><h3>${safe(item.title)}</h3><p class="knowledge-body">${safe(item.body)}</p><small class="knowledge-source">情報源：${safe(item.source)}</small></div>${item.active ? `<div class="knowledge-actions"><button class="secondary" type="button" data-knowledge-edit="${safe(item.id)}">編集</button><button class="danger-button" type="button" data-knowledge-disable="${safe(item.id)}">無効化</button></div>` : ''}</article>`;
}
function knowledgeView(enabled = serverConversation) {
  if (!enabled) return '';
  const editing = knowledgeItems.find(item => item.id === editingKnowledgeId && item.active);
  return `<div class="card" style="margin-top:20px"><div class="section-head"><h3>経営知識（長期記憶）</h3></div><p>登録を確認した情報だけを保存します。会話から自動登録しません。パスワード・APIキー・秘密情報は入力しないでください。</p>
    <form id="knowledge-form"><div class="form-grid"><div class="field"><label>カテゴリ</label><input name="category" list="knowledge-categories" maxlength="40" value="${safe(editing?.category || '')}" required><datalist id="knowledge-categories">${['会社基本情報','事業','店舗','商品','顧客','スタッフ','経営方針','承認ルール','不動産','財務','EC','広告','その他'].map(value=>`<option value="${value}">`).join('')}</datalist></div><div class="field"><label>タイトル</label><input name="title" maxlength="120" value="${safe(editing?.title || '')}" required></div></div><div class="field"><label>本文</label><textarea name="body" maxlength="3000" required>${safe(editing?.body || '')}</textarea></div><div class="field"><label>情報源・登録理由</label><input name="source" maxlength="500" value="${safe(editing?.source || '')}" required></div><div class="field"><label><input type="checkbox" name="confirmed" required> 内容を確認し、長期知識として${editing ? '更新' : '登録'}します</label></div><button class="primary" type="submit">${editing ? '知識を更新' : '知識を登録'}</button> ${editing ? '<button class="secondary" type="button" id="cancel-knowledge-edit">編集をやめる</button>' : ''}</form>
    <div style="margin-top:20px"><h3>質問で参照される知識を確認</h3><p>AIへ送信せずに、現在の質問で選ばれる知識のタイトルだけを確認します。例：私が経営しているコーヒー店について教えてください</p><div class="field"><label for="knowledge-preview-question">質問</label><input id="knowledge-preview-question" maxlength="8000"></div><button class="secondary" type="button" id="knowledge-preview-button">参照する知識を確認</button><div id="knowledge-preview-result" aria-live="polite"></div></div>
    <div style="margin-top:20px"><h3>登録済みの知識</h3>${knowledgeItems.length ? knowledgeItems.map(knowledgeItemView).join('') : '<p>登録された経営知識はまだありません。</p>'}</div></div>`;
}
function settingsView() { const s=state.settings; return `<div class="page-head"><div><h2>設定</h2><p>会社情報と安全ルールを確認できます。</p></div></div><form class="card" id="settings-form"><div class="form-grid"><div class="field"><label>会社名</label><input name="companyName" value="${safe(s.companyName)}"></div><div class="field"><label>代表者名</label><input name="ownerName" value="${safe(s.ownerName)}"></div><div class="field"><label>表示言語</label><select><option>日本語</option></select></div><div class="field"><label>バージョン</label><input value="Ver.${APP_VERSION}" disabled></div></div><div class="notice" style="margin:20px 0"><strong>重要操作の承認：有効</strong><br>広告費、価格変更、重要メッセージ、契約、データ削除、外部公開は必ず承認待ちになります。この設定はVer.0.1では無効にできません。</div><button class="primary" type="submit">設定を保存</button> <button class="danger-button" type="button" id="reset-data">お試しデータに戻す</button></form>${knowledgeView()}`; }

const views = { home:homeView, chat:chatView, projects:projectsView, agents:agentsView, approvals:approvalsView, ads:adsView, reports:reportsView, settings:settingsView };
function render() {
  renderNav();
  document.querySelector('#app').innerHTML = currentRoute.startsWith('project/') ? projectDetail(currentRoute.split('/')[1]) : (views[currentRoute] || homeView)();
  document.querySelector('#sidebar').classList.remove('open');
  if (currentRoute === 'chat') { const m=document.querySelector('#messages'); m.scrollTop=m.scrollHeight; }
}

function demoChatResult(msg) {
  let answer, task = null;
  if (/承認/.test(msg)) answer = `現在、承認待ちは${waitingCount()}件です。「承認待ち」画面で内容と上限金額を確認できます。承認するまで実行しません。`;
  else if (/結果|売上|どう/.test(msg)) answer = `今月のEC売上は${yen(state.salesMetrics[0].revenue)}です。広告費1円あたり約${state.adMetrics[0].roas}円の売上につながっています。特に再訪問向け広告が好調です。`;
  else if (/動画|広告案|作って/.test(msg)) {
    task = { id:`task-${Date.now()}`, projectId:'project-ec', agent:'制作AI', title:msg, status:'作業中', progress:10 };
    answer='承知しました。制作AIへ依頼しました。まず3つの下書きを作ります。外部公開はせず、完成後に代表へ確認をお願いします。';
  }
  else if (/Instagram|広告/.test(msg)) {
    task = { id:`task-${Date.now()}`, projectId:'project-ec', agent:'広告戦略AI', title:msg, status:'作業中', progress:10 };
    answer='承知しました。広告戦略AIに、対象のお客様・内容・予算案をまとめるよう依頼しました。費用が発生する操作は、承認まで止めます。';
  }
  else answer='承知しました。内容を整理し、適切なAI担当へ振り分けます。お金の使用や外部公開が必要な場合は、必ず先に承認をお願いします。';
  return { answer, task };
}

async function requestMirai(message) {
  const history = state.conversations.slice(-12).map(item => ({ role:item.role, content:item.text }));
  const response = await fetch('api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(serverConversation ? { message, ...(activeConversationId ? { conversationId:activeConversationId } : {}) } : { message, history })
  });
  if (!response.ok) throw new Error(`Mirai backend unavailable (${response.status})`);
  const result = await response.json();
  if (!result.answer) throw new Error('Mirai backend returned no answer');
  return result;
}

async function handleChat(text) {
  if (conversationLoading || newConversationPending) return;
  const msg = text.trim(); if (!msg) return;
  const generation = conversationGeneration;
  state.conversations.push({ id:`msg-${Date.now()}`, role:'user', text:msg, createdAt:new Date().toISOString() });
  saveState(); render();
  let result;
  try { result = await requestMirai(msg); }
  catch {
    if (!serverConversation) result = demoChatResult(msg);
    else result = { answer:'会話を保存できませんでした。時間をおいてもう一度お試しください。' };
  }
  if (generation !== conversationGeneration) return;
  if (serverConversation && result.conversationId) {
    activeConversationId = result.conversationId;
    // Replace the preceding turn's unapproved candidates; bound transient UI memory.
    memoryProposals = (result.memoryCandidates || []).slice(0, 1).map(item => ({ ...item, id:String(++proposalSequence) }));
  }
  if (result.mode === 'demo' && !result.task) result.task = demoChatResult(msg).task;
  if (result.task) state.tasks.unshift(result.task);
  state.conversations.push({ id:`msg-${Date.now()+1}`, role:'assistant', text:result.answer, createdAt:new Date().toISOString() });
  saveState(); render();
}

async function startNewConversation() {
  if (!serverConversation || conversationLoading || newConversationPending) return;
  newConversationPending = true;
  render();
  try {
    const response = await fetch('api/conversations', { method:'POST' });
    if (!response.ok) throw new Error('conversation creation failed');
    const result = await response.json();
    if (!result.conversation?.id) throw new Error('missing conversation ID');
    conversationGeneration++;
    activeConversationId = result.conversation.id;
    state.conversations = [];
    memoryProposals = [];
    saveState();
    showToast('新しい会話を開始しました。過去の会話は保存されています。');
  } catch { showToast('新しい会話を作成できませんでした。'); }
  finally { newConversationPending = false; render(); }
}

window.addEventListener('mk1:authenticated', async () => {
  serverConversation = true;
  conversationLoading = true;
  conversationGeneration++;
  loadKnowledge();
  state.conversations = [];
  memoryProposals = [];
  activeConversationId = null;
  saveState();
  render();
  try {
    const listResponse = await fetch('api/conversations', { credentials:'same-origin', cache:'no-store' });
    if (!listResponse.ok) throw new Error('conversation list unavailable');
    const list = await listResponse.json();
    const latest = list.conversations[0];
    if (!latest) return;
    const response = await fetch(`api/conversations/${latest.id}/messages`, { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) throw new Error('conversation unavailable');
    const data = await response.json();
    activeConversationId = latest.id;
    state.conversations = data.messages.map(item => ({ id:item.id, role:item.role, text:item.content, createdAt:item.createdAt }));
    render();
  } catch { showToast('保存済みの会話を読み込めませんでした。'); }
  finally { conversationLoading = false; render(); }
});
async function loadKnowledge() {
  try {
    const response = await fetch('api/knowledge', { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) throw new Error('knowledge unavailable');
    knowledgeItems = (await response.json()).knowledge;
    if (currentRoute === 'settings') render();
  } catch { showToast('経営知識を読み込めませんでした。'); }
}
async function saveKnowledge(form) {
  const data = new FormData(form);
  const value = { category:data.get('category'), title:data.get('title'), body:data.get('body'), source:data.get('source'), confirmed:data.get('confirmed') !== null };
  const response = await fetch(editingKnowledgeId ? `api/knowledge/${editingKnowledgeId}` : 'api/knowledge', {
    method:editingKnowledgeId ? 'PUT' : 'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(value)
  });
  if (!response.ok) { const error=await response.json(); throw new Error(error.error || '登録できませんでした。'); }
  editingKnowledgeId = null;
  await loadKnowledge();
  showToast('経営知識を保存しました。');
}
async function previewKnowledge(question) {
  question = question.trim();
  if (!question) { showToast('確認したい質問を入力してください。'); return; }
  const response = await fetch('api/knowledge/preview', { method:'POST', headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ question }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '検索できませんでした。');
  const target = document.querySelector('#knowledge-preview-result');
  if (!target) return;
  target.replaceChildren();
  if (!data.knowledge.length) { target.textContent = '参照する知識は見つかりませんでした。登録済みのカテゴリ・タイトル・本文を確認してください。'; return; }
  for (const item of data.knowledge) {
    const line = document.createElement('p');
    line.textContent = `${item.category}：${item.title}`;
    target.append(line);
  }
}
function decideApproval(id, decision) { const a=state.approvals.find(x=>x.id===id); if(!a)return; a.status=decision; a.decidedAt=new Date().toISOString(); state.auditLog.unshift({ id:`log-${Date.now()}`, actor:state.settings.ownerName, action:decision, target:a.title, createdAt:a.decidedAt }); saveState(); showToast(`${a.title}を「${decision}」として記録しました。`); render(); }

document.addEventListener('click', e => {
  const acceptMemory = e.target.closest('[data-memory-accept]');
  if (acceptMemory) decideMemoryCandidate(acceptMemory.dataset.memoryAccept, true);
  const dismissMemory = e.target.closest('[data-memory-dismiss]');
  if (dismissMemory) decideMemoryCandidate(dismissMemory.dataset.memoryDismiss, false);
  if(e.target.closest('#new-conversation')) startNewConversation();
  if(e.target.closest('#knowledge-preview-button')) previewKnowledge(document.querySelector('#knowledge-preview-question').value).catch(error=>showToast(error.message));
  const route=e.target.closest('[data-route]')?.dataset.route; if(route) routeTo(route);
  const project=e.target.closest('[data-project]')?.dataset.project; if(project) routeTo(`project/${project}`);
  const approval=e.target.closest('[data-approval]'); if(approval) decideApproval(approval.dataset.approval, approval.dataset.decision);
  const suggestion=e.target.closest('[data-suggestion]')?.dataset.suggestion; if(suggestion) { document.querySelector('#chat-input').value=suggestion; document.querySelector('#chat-input').focus(); }
  if(e.target.closest('#menu-button')) document.querySelector('#sidebar').classList.toggle('open');
  if(e.target.closest('#new-project')) showToast('新しい案件の追加機能は次のバージョンで対応します。');
  if(e.target.closest('[data-ad]')) showToast('広告案の詳細画面は次のバージョンで追加します。');
  if(e.target.closest('#download-report')) showToast('レポート保存機能は次のバージョンで追加します。');
  if(e.target.closest('#reset-data') && confirm('入力・承認履歴をお試しデータに戻しますか？')) { state=clone(initialState); saveState(); render(); showToast('お試しデータに戻しました。'); }
  const edit=e.target.closest('[data-knowledge-edit]'); if(edit) { editingKnowledgeId=edit.dataset.knowledgeEdit; render(); }
  if(e.target.closest('#cancel-knowledge-edit')) { editingKnowledgeId=null; render(); }
  const disable=e.target.closest('[data-knowledge-disable]');
  if(disable && confirm('この経営知識を無効化しますか？ 会話履歴や他の知識は削除されません。')) {
    fetch(`api/knowledge/${disable.dataset.knowledgeDisable}/disable`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ confirmed:true }) })
      .then(response=>{ if(!response.ok) throw new Error(); return loadKnowledge(); })
      .then(()=>showToast('経営知識を無効化しました。')).catch(()=>showToast('無効化できませんでした。'));
  }
});
document.addEventListener('submit', e => {
  if(e.target.id==='chat-form') { e.preventDefault(); handleChat(document.querySelector('#chat-input').value); }
  if(e.target.id==='settings-form') { e.preventDefault(); const data=new FormData(e.target); state.settings.companyName=data.get('companyName'); state.settings.ownerName=data.get('ownerName'); saveState(); showToast('設定を保存しました。'); }
  if(e.target.id==='knowledge-form') { e.preventDefault(); saveKnowledge(e.target).catch(error=>showToast(error.message)); }
});
window.addEventListener('hashchange',()=>{ currentRoute=location.hash.replace('#/','')||'home'; render(); });
render();

// Browser-free tests can import the initial data and safety helpers.
if (typeof module !== 'undefined') module.exports = { initialState, clone, safe, demoChatResult, knowledgeView, knowledgeItemView, memoryCandidateView, APP_VERSION, STORAGE_KEY };
