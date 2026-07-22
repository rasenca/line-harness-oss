# AGENTS.md — このリポジトリで働く AI エージェントへの常設指示

> **まず [.agents/index.md](.agents/index.md) を読むこと。** 意思決定・計画・未決事項の入口。

## このリポジトリは何か（最重要）

`rasenca/line-harness-oss` は OSS 本家 `Shudesu/line-harness-oss` を **Rasenca org にフォーク**したもの。

```
Shudesu/line-harness-oss (Public / OSS)   ← UPSTREAM = フォーク元（本家）※書き込み禁止
        ↓ GitHub fork + update-from-upstream.yml（本家→こちらへ PR）
rasenca/line-harness-oss (Public)          ← 我々のフォーク = origin（作業対象）
```

- **🚫 upstream（`Shudesu/line-harness-oss`）へ push / PR しない。** 変更の宛先は常に origin = `rasenca/line-harness-oss`。
  PR は必ず [`create-pr` skill](.claude/skills/create-pr/SKILL.md) の経路で `--repo rasenca/line-harness-oss` を明示して作る。
  （理由と多層の担保は [.agents/decisions/0002-fork-safety-no-upstream-writes.md](.agents/decisions/0002-fork-safety-no-upstream-writes.md)）
- 本家由来のドキュメント（`docs/OSS-SYNC-CHARTER.md`・`README*` 等）は Shudesu 視点の内容がフォークで継承されたもの。Rasenca の正典ではない（→ [ADR-0001](.agents/decisions/0001-adopt-bootstrap-playbook-in-rasenca-fork.md)）。

## 協働の作法（ユーザーとのコミュニケーション）

- 要求はざっくり来る前提。品質の高い成果のために必要な情報は着手前に遠慮なくヒアリングする（自明な既定は自分で決めて進め、些末は聞きすぎない）。
- 質問は可能な限り「選択肢＋比較」でクリック選択できる形にする。無理なときだけ自由記述。
- 大きい/並列可能なタスクはサブエージェントでチーム編成する。
- 成果物は確定前に対立的レビュアーを組成し、指摘は自分で裏取りしてから反映する。

## 作業の作法（安全・効率）

- ファイルは実フォルダに直接読み書きする（サンドボックスを介さない）。**削除を伴う操作は、権限バイパス設定でも必ずユーザーに確認**を取る。
- コンテキストを専有しすぎない。本当に必要なファイルだけを読む。画像は縮小/変換してから読む。
- シンプルを最優先に。必要十分な最小限の規模で、最大の価値と最高の品質を出す。

## このリポジトリの規律

- 運用・記録の流儀は [.agents/conventions.md](.agents/conventions.md) に従う。
- 不変ルール（**upstream へ書き込まない**・main 直 push 禁止・意思決定は追記主義・秘密をコミットしない 等）を厳守する。
- 迷ったら [.agents/index.md](.agents/index.md) から意思決定ログを辿る。
