# plans.md — マスタープラン

> 更新日: 2026-07-22（P1 完了）
> ゴール: `Shudesu/line-harness-oss` のフォークである `rasenca/line-harness-oss` を、Rasenca org の
> リポジトリとして bootstrap-playbook 流儀で（意思決定を追える形で・upstream 誤爆なく）運用できる状態に育てる。

## フェーズ

> 立ち上げ初手は P0。P1 以降はユーザと相談しながらフェーズ順に育てる TODO。

| Phase | 内容 | 状態 | 主成果物 |
|-------|------|------|---------|
| P0 | 骨格 + 運用スキル配置 + フォーク安全規律の明文化（初手 PR #2） | ✅ DONE | `.agents/`・`.claude/skills/`・AGENTS.md |
| P1 | 本家由来ドキュメントの棚卸しと扱い方針（Q-001 / ADR-0003） | ✅ DONE | ADR-0003・README/CONTRIBUTING/SECURITY 注記 |
| P2 | ブランチ保護 / Rulesets を Rasenca org 側で設定（Q-002） | ⬜ NEXT | GitHub 設定 + ADR |
| P3 | Rasenca 独自のデプロイ／環境運用を決めるか（Q-003） | ⬜ | ADR・docs/ |
| P4 | 本家追従（update-from-upstream）運用の確認・調整（Q-004） | ⬜ | .github/workflows/ |

## 直近の意思決定（ADR）

- [ADR-0001](decisions/0001-adopt-bootstrap-playbook-in-rasenca-fork.md) — playbook 流儀の採用＋フォークのトポロジー宣言（ACCEPTED）
- [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md) — フォーク安全規律：upstream へ push/PR しない（ACCEPTED）

## 次アクション

1. P2: Rasenca org 側で `main` のブランチ保護 / Rulesets を検討（Q-002）。直 push・force push を技術強制で塞げるか（org プラン制約の確認）。
2. P3: Rasenca が独自にデプロイ／環境運用（Cloudflare 等）を持つかを判断（Q-003）。持つなら別 ADR。
3. P4: `update-from-upstream.yml`（本家追従）の運用確認・調整（Q-004。継承 workflow の `gh pr create` --repo 未固定も併せて）。
