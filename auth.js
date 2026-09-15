'use strict';

(() => {
  const nativeFetch = window.fetch.bind(window);
  const auth = { configured: false, authenticated: false, csrfToken: null };

  window.fetch = (input, options = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!auth.csrfToken || !/^\/?api\//.test(url)) return nativeFetch(input, options);
    const headers = new Headers(options.headers || (typeof input === 'string' ? undefined : input.headers));
    headers.set('X-CSRF-Token', auth.csrfToken);
    return nativeFetch(input, { ...options, headers, credentials: 'same-origin' });
  };

  function layer() {
    let element = document.querySelector('#auth-layer');
    if (!element) {
      element = document.createElement('div');
      element.id = 'auth-layer';
      document.body.appendChild(element);
    }
    return element;
  }

  function showLogin(error = '') {
    layer().innerHTML = `<div class="auth-overlay"><form class="card auth-card" id="login-form"><div class="brand-mark">M1</div><p class="eyebrow">MK-1 AI HEADQUARTERS</p><h2>井上さん専用ログイン</h2><p>会社の非公開情報を守るため、本人確認を行います。</p><div class="login-error" hidden></div><div class="field"><label>メールアドレス</label><input name="email" type="email" autocomplete="username" required></div><div class="field"><label>パスワード</label><input name="password" type="password" autocomplete="current-password" required minlength="12"></div><button class="primary" type="submit">ログイン</button><small>パスワードはブラウザに保存せず、サーバーで安全に確認します。</small></form></div>`;
    if (error) {
      const message = document.querySelector('.login-error');
      message.textContent = error;
      message.hidden = false;
    }
  }

  async function checkStatus() {
    try {
      const response = await nativeFetch('api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      Object.assign(auth, await response.json());
      if (auth.configured && !auth.authenticated) showLogin();
    } catch {
      // GitHub Pagesには認証バックエンドがないため、従来の公開デモを維持します。
    }
  }

  document.addEventListener('submit', async event => {
    if (event.target.id !== 'login-form') return;
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    try {
      const response = await nativeFetch('api/auth/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') })
      });
      const result = await response.json();
      form.querySelector('[name="password"]').value = '';
      if (!response.ok) return showLogin(result.error || 'ログインできませんでした。');
      Object.assign(auth, result);
      layer().innerHTML = '';
    } catch {
      showLogin('認証サーバーへ接続できませんでした。');
    }
  });

  checkStatus();
})();
