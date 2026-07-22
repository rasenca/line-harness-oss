# ADR-0006: upstream 追従の運用方針（update-from-upstream を維持・PR 宛先を明示化）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0002, ADR-0004
- tracks: Q-004

## Context

`.github/workflows/update-from-upstream.yml` は本家 `Shudesu/line-harness-oss` の変更をこのフォークへ取り込む唯一の自動経路。P4 で挙動を精査した:

- トリガー: 毎日 cron `17 19 * * *`（= 19:17 UTC / 04:17 JST）＋ 手動 `workflow_dispatch`。
- ガード: `if: github.repository != 'Shudesu/line-harness-oss'`（本家上では動かない）。
- 処理: `upstream`（`https://github.com/Shudesu/line-harness-oss.git`）を fetch → 差分があれば `upstream/update-<ts>` ブランチを作成 → `git merge --no-edit upstream/main` → **`origin` へ push** → `gh pr create` で `main` 宛の PR を作成。
- **方向は upstream → origin のみ。push 先は origin 限定。main へ直 push しない（PR を作る）**ため、ADR-0002（upstream へ書き込まない）とも ADR-0004（main 保護）とも整合。

発見した非対称（軽微）: 本 workflow の `gh pr create` は `--repo` を明示していない。実行時は `github.token`（実行リポジトリ = rasenca にスコープ）＋ Actions コンテキストで宛先が rasenca に解決されるため**実害はない**が、ADR-0002 の「常に `--repo` を明示する」原則とは非対称だった。

## Decision

1. **`update-from-upstream.yml` を現行運用のまま維持する。** 毎日 cron の追従 PR は、内部運用フォークが本家の修正・機能を安全に取り込む手段として妥当。頻度（日次）と方式（PR 経由・自動マージしない）を維持する。
2. **`gh pr create` に `--repo "${{ github.repository }}"` を明示追加する。** 実行リポジトリ（rasenca）に確実に固定し、ADR-0002 の原則（宛先を必ず明示）と揃える。`github.repository` を使うことで本家上では（そもそもガードで動かないが）親へ向かない。
3. **取り込み PR は自動マージしない。** 生成された `chore: update from upstream` PR は人間（またはレビュー後の判断）でマージする。本家変更が Rasenca の追記（`.agents/` 等）や設定と競合しうるため、マージ前に diff を確認する。
4. **マージ後の注意:** upstream 追従をマージすると `main` への push が発生し、`deploy-cloudflare-*` のトリガー条件に該当するが、ADR-0005 の通り変数未設定で dormant のため誤デプロイは起きない。

## Alternatives

- **cron 頻度を下げる／手動のみにする。** → 却下（現時点）。日次でも自動マージしないので負荷は低く、追従漏れを防げる。負荷が問題化したら頻度調整（本 ADR に Update）。
- **`--repo` を追加せず現状維持。** → 却下。実害はないが原則と非対称。1 行の明示で一貫性が上がる（原則 1・9）。
- **fork ネットワーク経由でなく手元 cherry-pick で取り込む。** → 却下。自動化されている現行の方が確実で追える。

## Consequences

- workflow の `gh pr create` に `--repo` が入り、フォーク安全の原則が CI 側でも一貫する。
- Q-004 は ANSWERED（本 ADR が反映先）。継承 workflow の `--repo` 非対称も解消。
- 追従 PR のマージ運用（diff 確認・競合時の対応）は `catch-up` skill の観点に含む（既に upstream/update-* PR の確認を記載済み）。
