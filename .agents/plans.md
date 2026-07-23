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
| P6 | Upstream 由来 docs の設計意図を ADR 化（0007〜0017・全ドメイン） | ✅ DONE | .agents/decisions/0007-0017 |
| P7 | 転記 ADR とコードの突合・留保解消（`sync-adrs`） | ✅ DONE | Q-005〜Q-008 を裏取り。ADR-0007〜0012 に `## Update (2026-07-23)` |

## 直近の意思決定（ADR）

- ADR-0001〜0017 まで ACCEPTED。全件の要約は [index.md の decisions/ 節](index.md) を参照。
- 0001〜0006 = フォーク運用の意思決定（Rasenca 発）。0007〜0017 = 本家由来 docs から転記した設計意図（要所は要コード裏取り）。

## 次アクション

> P0〜P4 の立ち上げ・運用ハードニング、P6 の upstream docs → ADR 転記、P7 の転記 ADR ↔ コード突合まで完了。

1. **（残・任意）転記 ADR 0013〜0017 の細部裏取り**。P7 で Q-005〜Q-008（ADR-0007〜0012 中心）は解消。残る stale doc の是正（例: 22-Operations.md の CORS `*` 表記）や 0013〜0017 の要所確認は必要に応じて `sync-adrs` で追う。
2. （将来 P5）Rasenca 独自デプロイを有効化する場合は [ADR-0005](decisions/0005-deploy-operation-policy.md) の opt-in 手順に従う（LIFF 用 Pages は作らない／secrets はユーザーが登録）。
3. upstream 追従 PR（`chore: update from upstream`）が来たら diff を確認してマージ（自動マージしない）。**未処理: `origin/upstream/update-20260722-203245`（PR 未作成・明示依頼まで保留）**。
