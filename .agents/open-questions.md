# open-questions.md — 未決事項トラッカー

> 状態: OPEN / ANSWERED / BLOCKER。解決したら ANSWERED にし、反映先(decisions/specs/docs)を記す。

## BLOCKER（着手前に要解消）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| （なし） | | | | |

## OPEN（並行で可）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| （現在 OPEN なし） | | | | 立ち上げ〜運用ハードニング（P0〜P4）は解決済み。将来 P5（独自デプロイ有効化）着手時に新規論点が出たらここに追加 |

## ANSWERED（記録）

| ID | 問い | 回答 | 反映先 |
|----|------|------|--------|
| Q-004 | `update-from-upstream.yml`（本家追従）の運用をこのまま使うか、頻度/レビュー体制を調整するか | 日次 cron・PR 経由（自動マージしない）を維持。`gh pr create` に `--repo` を明示追加してフォーク安全原則と整合 | [ADR-0006](decisions/0006-upstream-tracking-policy.md) |
| Q-003 | Rasenca が独自にデプロイ／環境運用を持つか、本家追従のみに留めるか | 将来 Rasenca 独自デプロイする方針で確定。現時点は変数未設定で dormant（追従のみ）。opt-in 手順を ADR に明記し実行は将来 P5 | [ADR-0005](decisions/0005-deploy-operation-policy.md) |
| Q-002 | Rasenca org 側で `main` のブランチ保護 / Rulesets を設定するか | public リポ＋admin 権限で実施可能と判明。ruleset「protect-main」を適用（PR 必須・force push/削除禁止・admin bypass・required check なし） | [ADR-0004](decisions/0004-protect-main-branch.md) |
| Q-000 | upstream 本家へ誤って push / PR しないためにどう担保するか | `gh repo set-default` でフォーク固定 + `create-pr` で `--repo` 明示 + upstream remote 非常設（追加時は push 無効化）の多層で塞ぐ | [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md) |
| Q-001 | 本家 Shudesu 由来のドキュメントを Rasenca 版に置換するか／併記か／現状維持か | 位置づけ = 社内運用フォークと確定。4 分類し、Cat1/4 は維持・Cat2 はヘッダ注記・Cat3 は fork バナー＋誤誘導の中立化（最小変更・削除しない） | [ADR-0003](decisions/0003-inherited-shudesu-docs-triage.md) |
