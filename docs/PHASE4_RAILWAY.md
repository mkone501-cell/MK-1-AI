# Phase 4: Railway本番移行準備

この文書は、Phase 3で作った安全基盤をRailway + PostgreSQLへ接続する前のチェックリストです。

## このPhaseで行うこと

- RailwayがNode.jsサーバーを起動できる設定をリポジトリに追加する。
- `/health`をデプロイ時のヘルスチェックとして使う。
- PostgreSQL接続用repositoryを次の実装段階で安全に差し込めることを確認する。
- 本番環境変数と秘密情報をGitHub Pagesやソースコードへ置かない方針を固定する。

## このPhaseでは行わないこと

- Railwayの有料プラン契約やクレジットカード登録
- PostgreSQLサービスの作成
- 実際のDATABASE_URLの登録
- OpenAI APIキーの登録
- オーナーの実パスワードや実メールアドレスのコミット
- GitHub Pagesから本番APIへの切り替え
- mainへの直接変更

## Railwayで将来設定する秘密情報

実値はRailwayのVariables/Secrets管理画面だけに登録します。GitHubへコミットしません。

- `NODE_ENV=production`
- `SESSION_STORE=database`
- `ALLOWED_ORIGINS=https://mkone501-cell.github.io`
- `COOKIE_SECURE=true`
- `COOKIE_SAME_SITE=None`（GitHub PagesとRailwayが別サイトになる場合。実運用前にブラウザCookie挙動を再確認する）
- `MK1_OWNER_EMAIL`
- `MK1_OWNER_PASSWORD_HASH`
- `DATABASE_URL`
- `OPENAI_API_KEY`（AI接続を有効化する段階だけ）
- `OPENAI_MODEL`

## PostgreSQL接続前の必須条件

1. `db/migrations/001_create_sessions.sql`を本番DBへ適用する手順を用意する。
2. `SessionRepositoryContract`に適合するPostgreSQL repositoryを実装する。
3. 生のセッションIDをSQLへ渡さず、既存`DatabaseSessionStore`が生成したSHA-256ハッシュだけを保存する。
4. SQLは必ずパラメータ化し、文字列連結でクエリを作らない。
5. 接続エラー時にDATABASE_URL、パスワード、Cookie、APIキーをログへ出さない。
6. DBのTLS/暗号化接続を本番サービスの仕様に合わせて有効にする。
7. 期限切れセッション削除を安全に行えるようにする。
8. 本番起動時、DB repositoryがない場合は既存の安全弁で起動を止める。

## デプロイ前テスト

- `npm test`がすべて成功する。
- `NODE_ENV=production`で秘密情報不足時に起動が拒否される。
- 未ログイン、偽Cookie、期限切れセッションが拒否される。
- DBには64文字のハッシュだけが保存され、生トークンが保存されない。
- `/health`に秘密情報が含まれない。
- GitHub Pagesの既存デモ表示が壊れていない。

## Railway設定

`railway.toml`は`npm start`でNode.jsサーバーを起動し、`/health`をヘルスチェックに使うだけの最小設定です。秘密情報は含みません。

この準備をmainへマージしても、Railwayの契約・デプロイ・課金は自動では発生しません。
