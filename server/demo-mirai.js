'use strict';

function demoReply(message) {
  if (/承認/.test(message)) {
    return '承認が必要な操作は「承認待ち」で止めます。このデモ環境から外部への実行は行いません。';
  }
  if (/結果|売上|どう/.test(message)) {
    return '現在はデモデータを使っています。本番接続後は、売上・広告費・ECなどの許可されたデータを確認して回答します。';
  }
  if (/動画|広告案|作って/.test(message)) {
    return '承知しました。制作AIへ依頼する想定で受け付けました。外部公開はせず、完成後に代表の承認を待ちます。';
  }
  if (/Instagram|広告/.test(message)) {
    return '承知しました。広告戦略AIへ振り分ける想定です。費用や外部公開が発生する場合は、必ず承認待ちで停止します。';
  }
  return '承知しました。現在はAPIキー未設定の安全なデモモードです。本番では内容を整理し、適切なAI担当へ振り分けます。';
}

module.exports = { demoReply };

