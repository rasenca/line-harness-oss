# ADR-0001: このフォークを bootstrap-playbook 流儀で運用し、トポロジーを宣言する

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0002
- source: Rasenca 社内 project-bootstrap-playbook

## Context

`rasenca/line-harness-oss` は OSS 本家 `Shudesu/line-harness-oss` をフォークしたリポジトリ。
プロダクト（LINE Harness）の「何を作るか」「技術スタック」は本家で既に確定しているため、
グリーンフィールド前提の playbook をそのまま適用はできない。一方で、Rasenca org のリポジトリとして
意思決定・計画・運用規律を時系列で追える形に育てたい。そこで**フォーク文脈に読み替えて playbook 流儀を採用**する。

本家由来のドキュメントがフォークに継承されている点に注意が必要:
- `docs/OSS-SYNC-CHARTER.md` は **Shudesu の Private ↔ OSS 同期憲章**（`Shudesu/line-harness` Private → `Shudesu/line-harness-oss` OSS）。Rasenca のトポロジーとは別物。
- `README.md` / `CONTRIBUTING.md` / `SECURITY.md` / `SUPPORT.md` / `.github/` 等も本家運用向けの内容を含む。
- これらは「本家の運用記録」として情報価値はあるが、**Rasenca フォークの正典ではない**。

## Decision

1. **playbook 流儀を採用する。** `.agents/`（意思決定ログ）と `.claude/skills/`（運用手順の常設化）を導入し、
   9 原則を [conventions.md](../conventions.md) の「憲法」として書き写す。
2. **フォークのトポロジーを明文化する。** 本 ADR と conventions.md に、`Shudesu/line-harness-oss`（upstream）→ `rasenca/line-harness-oss`（origin, 作業対象）の一方向関係を記録する。
3. **フォーク安全規律を最優先の不変ルールとする。** upstream への push/PR を塞ぐ具体手順は [ADR-0002](0002-fork-safety-no-upstream-writes.md) に分離して強く記載する。
4. **本家由来ドキュメントの扱い。** 当面は削除・改変せず**そのまま残す**（情報として保持）。ただし `.agents/index.md` で「本家由来・Rasenca の正典ではない」と注記し、`.agents/` を Rasenca の入口とする。Rasenca 版への置換要否は open-questions で追跡する。
5. **ADR-0001/0002 の意味づけをフォーク文脈に読み替える。** playbook の「ADR-0001=何を作るか / ADR-0002=技術スタック」はプロダクトが本家確定済みのため踏襲しない。本フォークでは ADR-0001=運用方針の採用+トポロジー、ADR-0002=フォーク安全規律とする。

## Alternatives

- **何も導入せず ad hoc に運用する。** → 却下。why が失われ、フォーク特有の footgun（upstream 誤爆）も塞げない。
- **本家ドキュメントを今すぐ Rasenca 版に全面置換する。** → 却下（この初手 PR では深入りしない方針）。影響範囲が広く、置換の要否自体が未決。open-questions に起こしてフェーズ順に判断する。
- **フォークを解除して独立リポにする。** → 却下。本家追従（`update-from-upstream.yml`）の利点を残す。ADR-0002 の Alternatives 参照。

## Consequences

- 以降の意思決定は `decisions/` に ADR として積む。計画は [plans.md](../plans.md)、未決は [open-questions.md](../open-questions.md)。
- AI エージェントの入口は既存の [AGENTS.md](../../AGENTS.md) を維持し（→ `.agents/index.md`）、協働・作業の作法と規律への誘導をそこに集約する（playbook の CLAUDE.md 相当を AGENTS.md が担う）。
- 本家由来ドキュメントの Rasenca 版化・ブランチ保護・Rasenca 独自デプロイ運用は TODO バックログ（plans.md）と open-questions で追跡する。
