# index.md — .agents/ 全ファイル索引

> このリポジトリ（`rasenca/line-harness-oss`）の「意思決定・計画・仕様」を AI/人間で共有するための入口。
> **ファイル追加・更新時は、この索引も必ず同期すること。**

## このリポジトリは何か（30 秒）

`Shudesu/line-harness-oss`（OSS 本家）を **Rasenca org にフォーク**したリポジトリ。運用の型は Rasenca 社内の
project-bootstrap-playbook 流儀に寄せて育てる。

```
Shudesu/line-harness-oss (Public / OSS)   ← UPSTREAM = フォーク元（本家）※書き込み禁止
        ↓ GitHub fork + update-from-upstream.yml（本家→こちらへ PR）
rasenca/line-harness-oss (Public)          ← 我々のフォーク = origin（作業対象）
```

> **最重要の不変ルール: upstream（本家 `Shudesu/line-harness-oss`）へは push / PR しない。**
> → [decisions/0002-fork-safety-no-upstream-writes.md](decisions/0002-fork-safety-no-upstream-writes.md)

## ルート

- [plans.md](plans.md) — マスタープラン（現在地・TODO バックログ）
- [conventions.md](conventions.md) — 運用規約・記録の流儀（この体系の「憲法」）
- [open-questions.md](open-questions.md) — 未決事項トラッカー
- （glossary.md — ドメイン語・旧称が出てきたら追加）
- （specs/ — 横断的関心事の型が要るときに追加）

## リポジトリ入口

- [../AGENTS.md](../AGENTS.md) — AI エージェント常設指示（毎セッション最初に読む）

## .claude/skills/（運用手順の常設化）

- [../.claude/skills/create-pr/SKILL.md](../.claude/skills/create-pr/SKILL.md) — 規約準拠かつ**フォーク安全**な PR 生成（唯一の変更経路）
- [../.claude/skills/catch-up/SKILL.md](../.claude/skills/catch-up/SKILL.md) — セッション開始時の追従＆状況把握
- [../.claude/skills/sync-adrs/SKILL.md](../.claude/skills/sync-adrs/SKILL.md) — ADR ドリフト監査＆追記

## docs/（.agents 外・一部は本家 Shudesu 由来）

> 下記は**本家由来のドキュメントがフォークで継承されたもの**。Rasenca の正典ではない。棚卸しと扱いの方針は [ADR-0003](decisions/0003-inherited-shudesu-docs-triage.md)（位置づけ = 社内運用フォーク）。

- [../README.md](../README.md)（+翻訳 en/zh-CN/ko/es） — プロダクト概要。冒頭に「Rasenca 社内運用フォーク」バナーを追記済み
- [../CONTRIBUTING.md](../CONTRIBUTING.md) / [../SECURITY.md](../SECURITY.md) — フォーク注記・報告経路を Rasenca 向けに整理済み
- [../docs/OSS-SYNC-CHARTER.md](../docs/OSS-SYNC-CHARTER.md) / [../docs/OSS-SANDBOX-MERGE-GATE.md](../docs/OSS-SANDBOX-MERGE-GATE.md) — ⚠ 本家 Shudesu の内部運用ドキュメント（冒頭注記済み・Rasenca では実行しない）

## decisions/（ADR — 意思決定の履歴）

- [0001-adopt-bootstrap-playbook-in-rasenca-fork.md](decisions/0001-adopt-bootstrap-playbook-in-rasenca-fork.md) — playbook 流儀の採用＋フォークのトポロジー宣言（ACCEPTED）
- [0002-fork-safety-no-upstream-writes.md](decisions/0002-fork-safety-no-upstream-writes.md) — フォーク安全規律：upstream へ push/PR しない（ACCEPTED）
- [0003-inherited-shudesu-docs-triage.md](decisions/0003-inherited-shudesu-docs-triage.md) — 本家由来ドキュメントの棚卸し方針＝社内運用フォークとして扱う（ACCEPTED）
- [0004-protect-main-branch.md](decisions/0004-protect-main-branch.md) — main を ruleset で保護（PR 必須・force push/削除禁止・admin bypass）（ACCEPTED）
- [0005-deploy-operation-policy.md](decisions/0005-deploy-operation-policy.md) — デプロイ運用方針：将来 Rasenca 独自デプロイ・現時点は追従のみ dormant（ACCEPTED）
- [0006-upstream-tracking-policy.md](decisions/0006-upstream-tracking-policy.md) — upstream 追従の運用方針（update-from-upstream 維持・PR 宛先明示化）（ACCEPTED）
