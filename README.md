# 文化祭 受付・整理券システム

文化祭展示の受付、紙整理券、呼出、入退場、統計を管理する Cloudflare Workers + D1 アプリです。

## 構成

- Next.js / React UI
- Vinext + Vite
- Cloudflare Workers
- Cloudflare D1
- Drizzle schema / migrations
- GitHub Actions による build / test / deploy

## ローカル開発

必要環境: Node.js 22.13 以上。

```bash
npm ci
npx wrangler d1 migrations apply DB --local
npm run dev
```

ビルドとテスト:

```bash
npm run build
npm test
```

## Cloudflare設定

`wrangler.jsonc` の D1 binding は `DB` です。

Worker secrets として次を設定します。

```text
STAFF_PIN
ADMIN_PIN
STAFF_SESSION_SECRET
```

値はリポジトリへコミットしないでください。

## デプロイ

手動の場合:

```bash
npm run build
npx wrangler deploy
```

安全機能用の `operation_requests` / `mutation_locks` / `auth_rate_limits` は、Workerが最初に必要になった時に `CREATE TABLE IF NOT EXISTS` で初期化します。これにより、Workers deploy用API TokenにD1管理API権限を追加しなくても安全に導入できます。

`drizzle/0005_festival_hardening.sql` も同じDDLを `IF NOT EXISTS` 付きで保持しているため、将来D1 migration権限を追加した後にremote migrationを適用して履歴へ記録しても衝突しません。

GitHub Actions では `main` への push 時に以下を順に実行します。

1. `npm ci`
2. D1 migrations をローカルDBで検証
3. build
4. test
5. Cloudflare Workers deploy

自動デプロイには GitHub Actions の repository secrets が必要です。

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Pull Request では本番D1・本番Workerには触れず、ローカルmigration / build / test のみ実行します。

## 安全性

受付・管理の更新操作は同じ日単位のD1 mutation lockを通します。これにより複数端末からの同時更新を直列化し、定員判定と更新の競合を防ぎます。

受付APIの `requestId` は `operation_requests` に保存されます。同じ `requestId` が再送された場合、完了済みなら保存済みレスポンスを返し、同じ操作を二重実行しません。

スタッフ / 管理者PINはIP相当のハッシュ単位で失敗回数を記録し、短時間に5回失敗すると一時的に認証を制限します。セッションCookieは `HttpOnly; Secure; SameSite=Strict` です。

## 整理券フロー

```text
整理券を準備
  ↓
紙を実際に渡す
  ↓
「紙を渡した」
  ↓
待機
  ↓
呼出
  ↓
入場確認
  ↓
入場中
  ↓
退場
```

紙の受け渡しが未確認の間は、次の整理券番号を進める操作を止めます。

## テスト

`tests/queue-guidance.test.mjs` は案内優先度・空き確保・待ち時間予測を検証します。

`tests/safety-regressions.test.mjs` は以下の安全性を回帰確認します。

- requestIdの正規化
- PIN連続失敗時の一時ロック
- 公開整理券取得がスタッフ認証分岐より優先されること
- 受付・管理更新が同じmutation guardを通ること
- hardeningテーブルをWorker自身が安全に初期化できること
- local migration検証 → build → test → deploy の順序
