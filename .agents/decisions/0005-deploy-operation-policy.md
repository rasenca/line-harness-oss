# ADR-0005: デプロイ運用方針 — 将来 Rasenca 独自デプロイ（現時点は追従のみ・dormant）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0001
- tracks: Q-003

## Context

継承されたデプロイ系ワークフローの実態を P3 で確認した:

| workflow | トリガー | ガード / 前提 | 現状 |
|---|---|---|---|
| `deploy-cloudflare-worker.yml` | push→main / dispatch（パス限定） | `if: github.repository != 'Shudesu/line-harness-oss' && vars.LINE_HARNESS_CLOUDFLARE_DEPLOY == 'true'`。secrets: `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` / `D1...` | **dormant** |
| `deploy-cloudflare-admin.yml` | push→main / dispatch（パス限定） | 同上 ＋ `NEXT_PUBLIC_API_URL` | **dormant** |
| `deploy-pages.yml` | push→`gh-pages` / dispatch | ガードなし・secrets なし | **dormant**（`gh-pages` ブランチ無し） |
| `release.yml` | tag `v*.*.*` push | `GITHUB_TOKEN` のみ | タグ push 時のみ発火 |

確認時点で **repo variables も secrets も未設定**。したがって Cloudflare デプロイは**発火しない（dormant）**。
= このフォークは現在「upstream 追従のみ」で、独自環境へのデプロイは行っていない。

なお Rasenca が LINE Harness の稼働インスタンスを別途運用しているかどうかは本リポジトリの CI とは独立の話（`create-line-harness` CLI 等で直接デプロイする経路もある）。本 ADR が扱うのは「**このリポジトリの CI から自動デプロイするか**」に限る。

## Decision

**方針: Rasenca は将来、独自の Cloudflare 環境へこのフォークからデプロイする。ただし対応は将来タスクとし、現時点では dormant（追従のみ）を維持する。**

- **今は何も有効化しない。** `LINE_HARNESS_CLOUDFLARE_DEPLOY` は未設定のまま、secrets も入れない。→ upstream 追従 PR をマージしても本番へ誤爆しない（fail-closed）。
- **将来有効化する際の opt-in 手順（正典）:**
  1. Rasenca の Cloudflare アカウントで API トークンを発行（Workers/D1/KV/R2 の Edit + Account Read。R2 権限が無いとデプロイが認証エラー）。
  2. GitHub Actions secrets を登録（`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` / D1 関連 / `NEXT_PUBLIC_API_URL` 等）。**secrets 登録はセキュリティ上ユーザー自身の作業**（AI は代行しない）。
  3. repo variable `LINE_HARNESS_CLOUDFLARE_DEPLOY = true` を設定。
  4. `wrangler` の環境定義（アカウント ID / D1 ID 等）を Rasenca の値に差し替え（本家の値を焼き込まない）。dev デフォルトは非本番リソースへ向ける（誤爆防止）。
  5. 有効化前に `sync-adrs` で本 ADR を ACCEPTED→実運用の記述へ更新し、リリース手順を docs に正典化する。
- **実行タイミング:** `plans.md` の将来フェーズ（P5: Rasenca 独自デプロイ有効化）として積む。着手はユーザ判断。

## Alternatives

- **今すぐ有効化する。** → 却下（ユーザ選択で「将来タスク」）。Cloudflare 資格情報の準備・環境定義の差し替え・リリース手順の正典化が伴い、初手の範囲を超える。
- **恒久的に追従のみ（デプロイしない）と決める。** → 却下。Rasenca は将来独自運用の意思がある。方針は「将来やる」で確定し、実行を遅延させる。
- **継承した deploy 系ワークフローを削除する。** → 却下。opt-in 設計として有用で、将来そのまま使える。dormant のまま残す（削除は不可逆）。

## Consequences

- 当面デプロイ事故のリスクはない（変数未設定で fail-closed）。
- Q-003 は ANSWERED（本 ADR が反映先。結論 = 将来やる・今は dormant）。
- 有効化に着手する時は本 ADR に `## Update (日付)` を追記し、手順の実施結果（secrets 投入・変数有効化・環境定義差し替え）を file:line 付きで記録する。

## Update (2026-07-23) — Rasenca 版 CF デプロイの最小構成方針（不要機能の扱い）

将来デプロイ有効化（P5）に備え、「不要機能を無効化して Cloudflare 構成を簡素化できるか」を調査した（**コード・デプロイ・変数は不改変。設計記録のみ**）。結論を、上部 opt-in 手順の前提として確定する。

### 決定：Rasenca 版 CF 最小構成 = Worker + Admin Pages の 2 デプロイ単位

- 使う CF リソース: **Worker**（+ D1 `DB` / R2 `IMAGES` / 静的アセット `ASSETS` / Cron `*/5`・`0 */6`）と **Admin Pages**（Next.js 静的 export）。KV/Queues/Durable Objects/Hyperdrive 等は未使用（source: `apps/worker/wrangler.toml`, `.github/workflows/deploy-cloudflare-worker.yml`, `.github/workflows/deploy-cloudflare-admin.yml`）。
- LIFF は Worker 同梱（`@cloudflare/vite-plugin` が `apps/worker/src/client` を `dist/client` にビルドし `ASSETS` から配信）。**LIFF 専用 Pages は作らない**（ADR-0007 と整合）。
- Cron は 2 本: 5 分 tick で配信復旧/トークン更新/リマインド/ステップ配信/ブロードキャスト/健全性チェック、6 時間 tick で追加の expirer（source: `apps/worker/src/index.ts:834-961`）。

### 不要機能の扱い（設定で無効化する＝フォーク安全。コード削除はしない）

1. **レガシー LIFF Pages（`apps/liff`）は作らない = 現行の既定**。
   - `apps/liff`（旧 React LIFF SPA, ~1,900 行）は Worker 同梱版（`apps/worker/src/client`, ~5,800 行）へ移植済みで死蔵（証拠: `apps/worker/src/client/affiliate/main.tsx:6`「mirrors apps/liff/src/pages/Affiliate.tsx」／`docs/wiki/21-Deployment.md:360-388`「旧 Pages プロジェクトは任意で削除」）。
   - **CI のデプロイ経路に `apps/liff` の Pages デプロイは存在しない**（`wrangler pages deploy` を呼ぶのは admin のみ: `deploy-cloudflare-admin.yml:51`）。`release.yml` だけが build（manifest hash 用・draft release のみ・デプロイなし）。
   - opt-in 手順への追加: デプロイ時に `LIFF_PAGES_PROJECT` / `LIFF_PUBLIC_URL` を**空文字で注入**すれば、self-update エンジンが worker-assets install と判定し LIFF Pages を probe/作成しない（source: `apps/worker/src/routes/admin-update.ts:194,208`, `packages/create-line-harness/src/commands/update.ts:579`）。既定値 `"line-harness-liff"` を実 Pages として作らない限り無害。
   - コード削除は非推奨（`release.yml` が参照＋ upstream 追従の衝突コスト）。

2. **予約/イベント/フォーム系は「使わない＝データを作らない」で自然に不活性。CF リソースは 1 つも減らない**。
   - これらは独立 CF リソースを持たず、単一 Worker 内の route（`apps/worker/src/index.ts:186-196` で無条件登録）+ client 画面（`ASSETS` 同梱）+ cron + 共有 D1 テーブル（migration 007/024/036/037）に閉じる。R2 は不使用。
   - 全体 ON/OFF スイッチは存在しない（`reminder_day_before_enabled` はイベント単位のデータ列であって feature flag ではない）。無効化にはコード改変が必要 → フォーク追従で恒常衝突 → **非推奨**。
   - cron は data-driven で空振り無害: `processDueReminders` 等は due 行を 1 回 SELECT し 0 件なら即 return（source: `apps/worker/src/services/booking-reminders.ts:39-60`）。予約/イベントを作らなければ near-zero コスト。

### Consequences（追記）

- P5 有効化時の opt-in 手順（本 ADR 上部 4.）に「LIFF 用 Pages を作らない（worker-assets 同梱を既定）」「`LIFF_PAGES_PROJECT`/`LIFF_PUBLIC_URL` は空注入」を織り込む。
- 予約/イベント/フォームは製品機能として温存（フォーク安全）。運用で使わないだけで CF コストは発生しない。CF 簡素化を狙って無効化する価値は無い（減る CF リソースがゼロ）。
- 本 Update 時点でコード・デプロイ・変数は未変更（設計記録のみ）。実有効化は将来 P5。
