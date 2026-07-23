# reviews/ — コードレビュー報告書の保管場所

このフォルダは、`rasenca/line-harness-oss`（upstream 由来コードを含む）に対して実施した**横断的コードレビュー/監査**の報告書を置く。ADR（意思決定）とは別レイヤーの「観測結果」であり、修正はフォーク安全のため別途 PR で行う（[ADR-0002](../decisions/0002-fork-safety-no-upstream-writes.md)）。

## 索引

| 日付 | 報告書 | 対象 | 総所見 | critical/high |
|---|---|---|---|---|
| 2026-07-23 | [包括コードレビュー](2026-07-23-comprehensive-code-review.md) | 全コードベース（約 81k LOC・main `0bb43d3`） | 91（+除外5） | 🔴3 / 🟠14 |

## 運用メモ

- 各報告書は「17 次元のクリーンセッション・ファインダー → 独立検証者による対立的反証（find→verify）」方式で作成。深刻度は検証後の再評価値、判定は `CONFIRMED`/`PLAUSIBLE`（`REJECTED` は除外）。
- 報告書の critical/high はデプロイ前の是正対象。是正は `create-pr` 経由で PR 化し、根拠として本報告書の該当節を参照する。
- 参照元: [../index.md](../index.md)、[ADR-0009（認証・認可・APIセキュリティ）](../decisions/0009-auth-authz-and-api-security.md)。
