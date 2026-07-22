---
name: sync-adrs
description: ADR（.agents/decisions/）が現行コード・運用に追いついているかを監査し、ドリフト（決定が覆った／status が古い／前提がコード上で不成立／後続 ADR で置換）を見つけて `## Update (日付)` 形式で追記・status 更新・index.md 同期する。「ADRを実装に同期して」「ADRドリフト監査」「statusの棚卸し」等で起動。大きめの実装マージ後・本家追従の取り込み後は明示依頼が無くても使ってよい。rasenca/line-harness-oss リポジトリ用。
---

# sync-adrs — ADR ドリフト監査＆追記

## 原則（なぜ）

- ADR は「決定の正典」。実装・運用に追い越されると嘘をつく。乖離を検出し、追記で直す。
- 上書きせず `## Update (日付)` で追記する（歴史を消さない）。証拠は file:line で自分で裏取り。
- **フォーク特有の観点:** 本家追従（`update-from-upstream.yml`）で取り込んだ変更が ADR の前提を崩していないか（特に ADR-0002 のフォーク安全規律・remote 構成）を確認する。

## 手順

0. 今日の日付を確認。記法の乱れを整える。
1. ADR を読み、それぞれの前提（例: 「origin は rasenca のみ」「gh default はフォーク固定」）が現行で成立しているか **grep / `git remote -v` / `gh repo set-default --view` 等で裏取り**する。
2. 指摘を鵜呑みにせず、自分で確認する。
3. ドリフトが実在する ADR に `## Update (YYYY-MM-DD)` を追記 + status 更新 + 相互ポインタ + index.md 同期。
4. 別サブエージェントで**対立レビュー**（追記の主張を file:line / コマンド出力で反証させる）。
5. diff を自己レビュー。スコープ外の発見は open-questions か別タスクに切り出す。

## 完了時の報告

更新した ADR 一覧（status 遷移含む）/ 見つけたドリフトと根拠 / 対立レビューの結果
