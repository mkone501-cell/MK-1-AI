# Phase 4: Railway本番移行準備

Phase 4.1でPostgreSQLセッションを接続する手順です。GitHub Pagesの画面は従来の公開デモのままです。

## 井上さんがRailway画面で行う設定

1. Railwayで **MK-1-AI** サービスを開き、**Variables** を開きます。PostgreSQL側ではなくMK-1-AI側です。
2. `DATABASE_URL` という変数を追加し、Railwayの「変数を参照」で **PostgreSQLサービス → DATABASE_URL** を選択します。表示上のサービス名が`Postgres`なら参照形式は `${{Postgres.DATABASE_URL}}` です。サービス名が異なる場合は画面から選んでください。URLをGitHub、README、チャットに貼らないでください。
3. 同じMK-1-AIのVariablesに `NODE_ENV=production`、`SESSION_STORE=database`、`ALLOWED_ORIGINS=https://mkone501-cell.github.io`、`COOKIE_SECURE=true` を設定します。GitHub PagesとRailwayは別サイトのため、実際にブラウザからログインする段階では `COOKIE_SAME_SITE=None` が必要です。SecureとCSRF確認は引き続き有効です。公開デモのJavaScriptはまだ本番APIへ切り替えていません。
4. `MK1_OWNER_EMAIL` と `MK1_OWNER_PASSWORD_HASH` をRailwayのVariablesへ設定します。ハッシュは手元で `npm run create-password-hash` を実行して作ります。**生パスワードは登録しません。** `OPENAI_API_KEY` はAI利用を開始するときだけ登録します。
5. `PORT` はRailwayが与える値をそのまま使います。自分で固定値に上書きする必要はありません。

`DATABASE_URL`が見つからない場合、**MK-1-AIのVariablesでPostgreSQLの変数参照が追加されているか**確認してください。PostgreSQLサービスがオンラインでも、アプリへ変数は自動で渡されません。

## 初回テーブル作成

デプロイ後、アプリ起動前に`db/migrations/001_create_sessions.sql`を自動適用します。`CREATE TABLE IF NOT EXISTS`と`CREATE INDEX IF NOT EXISTS`のみを使い、既存のセッション表を削除しません。DBへの接続や作成に失敗した場合はサーバーの起動を止め、秘密情報のない説明をログへ出します。

手動で実行したい場合は、RailwayのMK-1-AIサービスで同じ環境変数が利用できるシェルから `npm run db:migrate` を実行できます。通常の初回デプロイに手動操作は不要です。

## 接続とヘルスチェック

- Railwayのデプロイログに「ポート ... で起動しました」と表示され、サービスがHealthyになることを確認します。
- MK-1-AIサービスの公開URLへ `/health` を付けて開き、`"ok":true`と`"database":"connected"`を確認します。接続不能ならHTTP 503と`"database":"unavailable"`です。接続URLやDBパスワードは返しません。
- `/api/health`は本番でログインCookieが必要です。未ログインではHTTP 401を返します。

Railway内部ホスト（`*.railway.internal`）はサービス間の私設ネットワークを使用します。外部PostgreSQL URLの場合は証明書検証付きTLSで接続します。外部DBが独自CAを使う場合のみ、Railway側の`DATABASE_SSL_CA`へCA証明書を設定してください。証明書検証を無効にする設定は用意していません。

**今回のPRをマージする前にRailway画面で秘密情報を共有する必要はありません。** マージ後に上記の参照変数と認証設定をRailway画面で確認してください。

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
