'use strict';

const { validateKnowledge } = require('./validation');

// Conservative, deterministic extraction from the current user's statement only.
// Never interpret provider output, history, or business knowledge as approval.
const uncertain = /[?？\n\r「」『』“”"]|(?:どう|教えて|でしょう|ですか|ますか|するか|かな|かも|たぶん|多分|おそらく|思う|思います|検討|予定|希望|願望|仮に|もし|例えば|たとえば|提案|AI|ミライ|おすすめ|勧め|と言|とのこと|らしい|そうです|したい|しようか|今日|明日|今週|今月|来週|来月|本日|今回|一時|当面|期間限定|試し|取り消|取消|撤回|しない|しません|ではない|ではありません)/;
const rules = [
  { category:'商品', title:'価格の決定', topic:/価格/, ending:/(?:に変更する|に変更します|にする|にします)$/ },
  { category:'スタッフ', title:'スタッフ体制の決定', topic:/スタッフ体制/, ending:/(?:に変更する|に変更します|にする|にします)$/ },
  { category:'不動産', title:'物件情報の変更', topic:/(?:家賃|面積)/, ending:/(?:に変更する|に変更します|にする|にします)$/ },
  { category:'店舗', title:'営業時間の決定', topic:/営業時間/, ending:/(?:に変更する|に変更します|に決定する|に決定しました|にする|にします)$/ },
  { category:'店舗', title:'定休日の決定', topic:/定休日/, ending:/(?:にする|にします|に変更する|に変更します|に決定する|に決定しました)$/ },
  { category:'経営方針', title:'売上目標の決定', topic:/(?:月商|年商|売上|利益)/, ending:/(?:を目標にする|を目標にします|を目標とする|を目標とします)$/ }
];

function memoryCandidates(message, config, req) {
  if (typeof message !== 'string') return [];
  const body = message.trim();
  if (!body || body.length > 500 || uncertain.test(body)) return [];
  // Multiple sentences can mix a decision with a question/quotation; leave them for manual registration.
  const statement = body.replace(/[。！!]$/, '');
  if (/[。！!;]/.test(statement)) return [];
  const rule = rules.find(rule => rule.topic.test(statement) && rule.ending.test(statement));
  if (!rule) return [];
  const candidate = { category:rule.category, title:rule.title, body,
    source:'本人の今回の発言にある経営上の決定。今後の判断に再利用するため、内容と対象を確認して登録。' };
  const validated = validateKnowledge({ ...candidate, confirmed:true }, config, req);
  return validated && validated !== 'secret' ? [validated] : [];
}

module.exports = { memoryCandidates };
