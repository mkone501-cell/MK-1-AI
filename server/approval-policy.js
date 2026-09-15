'use strict';

const protectedActions = [
  { category: '外部送信', pattern: /送信|メールを?送|連絡して|返信して/ },
  { category: '外部公開', pattern: /公開|投稿|出稿|配信開始/ },
  { category: '支払い', pattern: /支払|振込|決済|購入して|発注して/ },
  { category: 'データ削除', pattern: /削除|消去|破棄/ },
  { category: '価格変更', pattern: /価格.*変更|値上げ|値下げ/ },
  { category: '契約', pattern: /契約|締結/ },
  { category: '金融取引', pattern: /株.*買|株.*売|投資信託.*買|注文を出/ }
];

function inspectApprovalNeed(text) {
  const matches = protectedActions
    .filter(({ pattern }) => pattern.test(String(text || '')))
    .map(({ category }) => category);

  return {
    required: matches.length > 0,
    categories: [...new Set(matches)]
  };
}

module.exports = { inspectApprovalNeed, protectedActions };

