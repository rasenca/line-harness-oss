# open-questions.md — 未決事項トラッカー

> 状態: OPEN / ANSWERED / BLOCKER。解決したら ANSWERED にし、反映先(decisions/specs/docs)を記す。

## BLOCKER（着手前に要解消）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| （なし） | | | | |

## OPEN（並行で可）

| ID | 問い | 影響 | 状態 | メモ |
|----|------|------|------|------|
| Q-001 | 本家 Shudesu 由来のドキュメント（`docs/OSS-SYNC-CHARTER.md`・`README*`・`CONTRIBUTING.md`・`SECURITY.md`・`SUPPORT.md`・`.github/`）を Rasenca 版に置換するか／併記か／現状維持か | 誤読リスク（本家手順を Rasenca が実行してしまう）・ブランディング | OPEN | この初手 PR では現状維持（ADR-0001 決定 4）。index.md で「本家由来」と注記済み。フェーズ P1 で判断 |
| Q-002 | Rasenca org 側で `main` のブランチ保護 / Rulesets を設定するか（直 push・force push を技術強制で塞ぐ） | main 保護の担保が「規律のみ」か「技術強制」か | OPEN | 現状は conventions.md の規律 + create-pr skill で担保。org プラン制約の確認が必要 |
| Q-003 | Rasenca が独自にデプロイ／環境運用（Cloudflare 等）を持つか、本家追従のみに留めるか | CI/CD・secrets 運用の要否 | OPEN | 本家の deploy 系ワークフローが継承されている。Rasenca 独自運用が要るなら別 ADR |
| Q-004 | `update-from-upstream.yml`（本家→こちらの日次追従 PR）の運用をこのまま使うか、頻度/レビュー体制を調整するか | 本家の変更取り込みの安全性・レビュー負荷 | OPEN | 本家 → origin 方向で push 先は origin 限定・ガード付き。逆方向禁止は ADR-0002 で担保済み。備忘: 継承 workflow の `gh pr create` は `--repo` 未固定（Actions コンテキスト依存）で、ADR-0002 の「常に `--repo` 明示」原則とは非対称（現状は安全側だが将来 --repo 明示に揃えるか検討） |

## ANSWERED（記録）

| ID | 問い | 回答 | 反映先 |
|----|------|------|--------|
| Q-000 | upstream 本家へ誤って push / PR しないためにどう担保するか | `gh repo set-default` でフォーク固定 + `create-pr` で `--repo` 明示 + upstream remote 非常設（追加時は push 無効化）の多層で塞ぐ | [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md) |
