# plans.md — マスタープラン

> 更新日: 2026-07-22
> ゴール: `Shudesu/line-harness-oss` のフォークである `rasenca/line-harness-oss` を、Rasenca org の
> リポジトリとして bootstrap-playbook 流儀で（意思決定を追える形で・upstream 誤爆なく）運用できる状態に育てる。

## フェーズ

> 立ち上げ初手は P0。P1 以降はユーザと相談しながらフェーズ順に育てる TODO。

| Phase | 内容 | 状態 | 主成果物 |
|-------|------|------|---------|
| P0 | 骨格 + 運用スキル配置 + フォーク安全規律の明文化（この初手 PR） | ✅ DONE | `.agents/`・`.claude/skills/`・AGENTS.md |
| P1 | 本家由来ドキュメントの棚卸しと Rasenca 版方針（Q-001） | ⬜ NEXT | decisions/・docs/ |
| P2 | ブランチ保護 / Rulesets を Rasenca org 側で設定（Q-002） | ⬜ | GitHub 設定 + ADR |
| P3 | Rasenca 独自のデプロイ／環境運用を決めるか（Q-003） | ⬜ | ADR・docs/ |
| P4 | 本家追従（update-from-upstream）運用の確認・調整（Q-004） | ⬜ | .github/workflows/ |

## 直近の意思決定（ADR）

- [ADR-0001](decisions/0001-adopt-bootstrap-playbook-in-rasenca-fork.md) — playbook 流儀の採用＋フォークのトポロジー宣言（ACCEPTED）
- [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md) — フォーク安全規律：upstream へ push/PR しない（ACCEPTED）

## 次アクション

1. この初手 PR を `create-pr` skill で `rasenca/line-harness-oss` の `main` 宛に出す（本 PR の変更は `.agents/`・`.claude/`・`AGENTS.md` のみで worker-ci のパス対象外＝CI は起動しない。PR 本文「検証」に「骨格＋運用スキル＋規約のみ・アプリ挙動への影響なし・手動確認内容」を明記）。
2. P1: 本家由来ドキュメント（OSS-SYNC-CHARTER / README / CONTRIBUTING 等）を棚卸しし、Rasenca 版へ置換 or 併記 or 現状維持を判断（Q-001）。
3. P2: Rasenca org 側で main のブランチ保護 / Rulesets を検討（Q-002）。
