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
