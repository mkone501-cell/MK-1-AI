'use strict';

const readline = require('node:readline');
const { hashPassword } = require('../server/password');

function readHidden(prompt) {
  if (!process.stdin.isTTY) {
    return new Promise(resolve => {
      let value = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { value += chunk; });
      process.stdin.on('end', () => resolve(value.trim()));
    });
  }
  return new Promise(resolve => {
    process.stdout.write(prompt);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = character => {
      if (character === '\r' || character === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (character === '\u0003') {
        process.exit(130);
      } else if (character === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

(async () => {
  const password = await readHidden('12文字以上のログインパスワードを入力してください（画面には表示されません）: ');
  const confirmation = await readHidden('確認のため、もう一度入力してください: ');
  if (password !== confirmation) throw new Error('2回のパスワードが一致しません。');
  console.log('\n次の文字列を MK1_OWNER_PASSWORD_HASH 環境変数へ登録してください。');
  console.log('元のパスワードではなく、安全なハッシュ値です。\n');
  console.log(await hashPassword(password));
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

