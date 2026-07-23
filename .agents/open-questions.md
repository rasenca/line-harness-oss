# open-questions.md — 未決事項トラッカー

> 状態: OPEN / ANSWERED / BLOCKER。解決したら ANSWERED にし、反映先(decisions/specs/docs)を記す。

## BLOCKER（着手前に要解消）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| （なし） | | | | |

## OPEN（並行で可）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| Q-009 | 統合スキーマ `packages/db/schema.sql` に `traffic_pools` の `CREATE TABLE` が欠落（`pool_accounts` が FK 参照するのに定義なし。migration 016/bootstrap.sql にはある） | schema.sql 単体からの新規 DB 構築が壊れ得る（upstream 側スキーマ欠落） | OPEN | P7 の対立レビューで発見。フォーク安全のため直接修正せず、本家追従で是正されるか監視 or upstream に報告検討。→ [ADR-0010 Update (2026-07-23)](decisions/0010-delivery-scheduling-stealth-and-multi-account.md) |

## ANSWERED（記録）

| ID | 問い | 回答 | 反映先 |
|----|------|------|--------|
| Q-005 | `docs/ad-conversion-spec.md`（広告CV返送）は Rasenca フォークで実装済みか？ | **実装済み（現行の正）**。`sendAdConversions`（`ad-conversion.ts:16`）が Meta CAPI/Google Ads へ実送信、`ad_platforms`/`ad_conversion_logs` は本番スキーマ在、event-bus 統合済み | [ADR-0012 Update (2026-07-23)](decisions/0012-measurement-tracked-links-and-attribution.md) |
| Q-006 | 友だち重複検出は「picture_url トークン」か「identity_key 複合キー」か | **両立・同一トークンが土台**。`identity_key`=`COALESCE(picture_url由来url_token, uid, id)`（電話/メールは不含＝ADR記述は誤り）。picture_url トークンの直接照合は `duplicate-detect.ts`（cron 無効化済み・on-demand） | [ADR-0012 Update (2026-07-23)](decisions/0012-measurement-tracked-links-and-attribution.md) |
| Q-007 | マルチアカウントは受動 UUID 再マッチのみか、能動トラフィックプールが実在するか | **能動プールは実在（流入分散）**。`getRandomPoolAccount`（`traffic-pools.ts:186`）+ `liff.ts:433-445` で友だち追加先をランダム振り分け。BAN 後の「移行」は受動 UUID 再マッチのまま（別機構） | [ADR-0010 Update (2026-07-23)](decisions/0010-delivery-scheduling-stealth-and-multi-account.md) |
| Q-008 | docs 記述揺れをコードで正す（CORS/API_KEY/テーブル数/パッケージ名/reminder符号/automation数） | **CORS=許可リスト reflection（`*`不使用）／CRM 本体 API キーは非露出（cookie 認証）だが自己更新用 `NEXT_PUBLIC_ADMIN_API_KEY` はバンドル露出（本番は self-update 不活性で実害低）／テーブル55／パッケージ名混在は史実／reminder offset は負=前・シナリオは正経過／automation=8種**。stale doc（22-Operations `*` 等）は継続是正候補 | [ADR-0008](decisions/0008-data-model-and-schema-conventions.md)/[0009](decisions/0009-auth-authz-and-api-security.md)/[0010](decisions/0010-delivery-scheduling-stealth-and-multi-account.md)/[0011](decisions/0011-crm-friends-tags-scoring-automation.md) の Update (2026-07-23) |
| Q-004 | `update-from-upstream.yml`（本家追従）の運用をこのまま使うか、頻度/レビュー体制を調整するか | 日次 cron・PR 経由（自動マージしない）を維持。`gh pr create` に `--repo` を明示追加してフォーク安全原則と整合 | [ADR-0006](decisions/0006-upstream-tracking-policy.md) |
| Q-003 | Rasenca が独自にデプロイ／環境運用を持つか、本家追従のみに留めるか | 将来 Rasenca 独自デプロイする方針で確定。現時点は変数未設定で dormant（追従のみ）。opt-in 手順を ADR に明記し実行は将来 P5 | [ADR-0005](decisions/0005-deploy-operation-policy.md) |
| Q-002 | Rasenca org 側で `main` のブランチ保護 / Rulesets を設定するか | public リポ＋admin 権限で実施可能と判明。ruleset「protect-main」を適用（PR 必須・force push/削除禁止・admin bypass・required check なし） | [ADR-0004](decisions/0004-protect-main-branch.md) |
| Q-000 | upstream 本家へ誤って push / PR しないためにどう担保するか | `gh repo set-default` でフォーク固定 + `create-pr` で `--repo` 明示 + upstream remote 非常設（追加時は push 無効化）の多層で塞ぐ | [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md) |
| Q-001 | 本家 Shudesu 由来のドキュメントを Rasenca 版に置換するか／併記か／現状維持か | 位置づけ = 社内運用フォークと確定。4 分類し、Cat1/4 は維持・Cat2 はヘッダ注記・Cat3 は fork バナー＋誤誘導の中立化（最小変更・削除しない） | [ADR-0003](decisions/0003-inherited-shudesu-docs-triage.md) |
