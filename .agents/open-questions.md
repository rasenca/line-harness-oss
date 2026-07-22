# open-questions.md — 未決事項トラッカー

> 状態: OPEN / ANSWERED / BLOCKER。解決したら ANSWERED にし、反映先(decisions/specs/docs)を記す。

## BLOCKER（着手前に要解消）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| （なし） | | | | |

## OPEN（並行で可）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| Q-005 | `docs/ad-conversion-spec.md`（広告CV返送）は本家向けの*提案仕様書*。Rasenca フォークのコードで実装済みか？ | ADR-0012 の広告返送記述が「現行の正」か「未実装の構想」か | OPEN | `sync-adrs`/grep で `sendAdConversions`・`ad_platforms`・`ad_conversion_logs` の実在確認 → ADR-0012 に `## Update` |
| Q-006 | 友だち重複検出の実装方式は「picture_url トークン照合」（README主張）か「identity_key 複合キー」（docs）か | ADR-0012 の重複検知記述の正確性・不正検知の実挙動 | OPEN | 実装で確認して ADR-0012 を確定 |
| Q-007 | マルチアカウント移行は「受動 UUID 再マッチ」のみか、能動的トラフィックプール（送信元ローテ）が実在するか（MCP `manage_traffic_pools` あり） | ADR-0010 の移行/BAN 対策記述の正確性 | OPEN | `traffic_pool` 系のコード/スキーマ確認 → ADR-0010 に反映 |
| Q-008 | docs 内の記述揺れをコードで正す（CORS `*`/限定・`NEXT_PUBLIC_API_KEY` 可否・テーブル数 42/45・パッケージ名 `@line-harness/*`/`@line-crm/*`・reminder `offset_minutes` 符号・automation アクション 6/8 種） | ADR-0008/0009/0010/0011 の細部の正確性 | OPEN | `sync-adrs` で一括裏取り。stale な doc（22-Operations.md の CORS `*` 等）も是正候補 |

## ANSWERED（記録）

| ID | 問い | 回答 | 反映先 |
|----|------|------|--------|
| Q-004 | `update-from-upstream.yml`（本家追従）の運用をこのまま使うか、頻度/レビュー体制を調整するか | 日次 cron・PR 経由（自動マージしない）を維持。`gh pr create` に `--repo` を明示追加してフォーク安全原則と整合 | [ADR-0006](decisions/0006-upstream-tracking-policy.md) |
| Q-003 | Rasenca が独自にデプロイ／環境運用を持つか、本家追従のみに留めるか | 将来 Rasenca 独自デプロイする方針で確定。現時点は変数未設定で dormant（追従のみ）。opt-in 手順を ADR に明記し実行は将来 P5 | [ADR-0005](decisions/0005-deploy-operation-policy.md) |
| Q-002 | Rasenca org 側で `main` のブランチ保護 / Rulesets を設定するか | public リポ＋admin 権限で実施可能と判明。ruleset「protect-main」を適用（PR 必須・force push/削除禁止・admin bypass・required check なし） | [ADR-0004](decisions/0004-protect-main-branch.md) |
| Q-000 | upstream 本家へ誤って push / PR しないためにどう担保するか | `gh repo set-default` でフォーク固定 + `create-pr` で `--repo` 明示 + upstream remote 非常設（追加時は push 無効化）の多層で塞ぐ | [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md) |
| Q-001 | 本家 Shudesu 由来のドキュメントを Rasenca 版に置換するか／併記か／現状維持か | 位置づけ = 社内運用フォークと確定。4 分類し、Cat1/4 は維持・Cat2 はヘッダ注記・Cat3 は fork バナー＋誤誘導の中立化（最小変更・削除しない） | [ADR-0003](decisions/0003-inherited-shudesu-docs-triage.md) |
