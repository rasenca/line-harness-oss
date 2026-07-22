# plans.md — マスタープラン

> 更新日: 2026-07-22（P1〜P4 完了）
> ゴール: `Shudesu/line-harness-oss` のフォークである `rasenca/line-harness-oss` を、Rasenca org の
> リポジトリとして bootstrap-playbook 流儀で（意思決定を追える形で・upstream 誤爆なく）運用できる状態に育てる。

## フェーズ

> 立ち上げ初手は P0。P1 以降はユーザと相談しながらフェーズ順に育てる TODO。

| Phase | 内容 | 状態 | 主成果物 |
|-------|------|------|---------|
| P0 | 骨格 + 運用スキル配置 + フォーク安全規律の明文化（初手 PR #2） | ✅ DONE | `.agents/`・`.claude/skills/`・AGENTS.md |
| P1 | 本家由来ドキュメントの棚卸しと扱い方針（Q-001 / ADR-0003） | ✅ DONE | ADR-0003・README/CONTRIBUTING/SECURITY 注記 |
| P2 | main ブランチ保護 ruleset を設定（Q-002 / ADR-0004） | ✅ DONE | ruleset「protect-main」(id 19551161)・ADR-0004 |
| P3 | Rasenca 独自デプロイ運用の方針（Q-003 / ADR-0005） | ✅ DONE | ADR-0005（将来やる・現状 dormant） |
| P4 | 本家追従 update-from-upstream の運用確認・改修（Q-004 / ADR-0006） | ✅ DONE | ADR-0006・workflow に --repo 明示 |
| P5 | （将来）Rasenca 独自デプロイの有効化（ADR-0005 の opt-in 手順を実施） | ⬜ 将来 | secrets/変数設定・wrangler 環境定義・リリース手順正典化 |

## 直近の意思決定（ADR）

- ADR-0001〜0006 まで ACCEPTED。全件の要約は [index.md の decisions/ 節](index.md) を参照。
- 直近: [ADR-0004](decisions/0004-protect-main-branch.md)（main 保護）/ [ADR-0005](decisions/0005-deploy-operation-policy.md)（デプロイ方針）/ [ADR-0006](decisions/0006-upstream-tracking-policy.md)（upstream 追従）。

## 次アクション

> P0〜P4 の立ち上げ・運用ハードニングは完了。以降はユーザ判断で着手する将来タスク。

1. （将来 P5）Rasenca 独自デプロイの有効化に着手する場合は [ADR-0005](decisions/0005-deploy-operation-policy.md) の opt-in 手順に従う（secrets はユーザーが登録）。
2. 大きめの取り込み・実装マージ後は `sync-adrs` で ADR と現行の乖離をならす。
3. upstream 追従 PR（`chore: update from upstream`）が来たら diff を確認してマージ（自動マージしない）。
