---
name: catch-up
description: セッション開始時のキャッチアップ手順。最新 main へ安全に追従し、意思決定記録/計画/未決事項をざっと把握して次タスク開始に備える。「mainに追従して」「最新に追いついて」「次のタスクの準備」「状況把握して」等で起動。rasenca/line-harness-oss リポジトリ用。
---

# catch-up — 追従＆状況把握＆次タスク準備

このリポジトリは `Shudesu/line-harness-oss` のフォーク（origin = `rasenca/line-harness-oss`）。
追従・push の宛先は常に origin。**upstream 本家へは触れない**（→ [ADR-0002](../../../.agents/decisions/0002-fork-safety-no-upstream-writes.md)）。

## 重要な約束

以下の手順を実施するが、決して深入りせず、短時間でざっと把握し、ユーザーに返すこと。

## 1. 最新 main へ追従（データを絶対に失わない）

```bash
git status -sb                 # 未コミット変更・現在ブランチ
git stash list                 # 既存 stash の有無
```

- 未コミット変更があれば `git diff` で確認。価値ある作業は退避、破棄しない:
  ```bash
  git stash push -m "wip: <何の作業か>" <対象パス...>
  ```
- 追従本体（宛先は必ず origin）:
  ```bash
  git fetch origin --prune
  git checkout main
  git pull --ff-only origin main
  git stash pop                 # 退避していれば戻す
  ```
- squash-merge 済みブランチ（origin が prune で消えた）は、内容が入ったのを確認してから削除:
  ```bash
  git diff main <branch> --stat   # 空なら安全
  git branch -D <branch>
  ```
- stash pop で衝突したら、勝手にマージせずユーザーに報告する。

## 2. 意思決定記録・計画・未決を把握

- `.agents/index.md`（入口）/ `plans.md`（現在地）/ `open-questions.md`（最優先タグ）を読む。
- `decisions/` の ADR を確認（現状 ADR-0001/0002。特に ADR-0002 のフォーク安全規律を毎回思い出す）。
- 本家追従の状況を見る: `update-from-upstream.yml` が開いた `upstream/update-*` ブランチの PR が origin に無いか（あれば本家の取り込み待ち）。

## 3. 次タスクを提示

plans の次アクション・open-questions の最優先を突き合わせ、**候補を数個に絞り推奨 1 つを添えて**提示（丸投げの列挙をしない）。着手時は作業ブランチを切る。

## 完了時の報告

追従結果 / 現在地要約（実装済↔未実装の境目）/ 最優先未決 / 次タスク推奨
