# conventions.md — 運用規約・記録の流儀・リポジトリ構成

## このリポジトリの目的

`rasenca/line-harness-oss` は、OSS 本家 [`Shudesu/line-harness-oss`](https://github.com/Shudesu/line-harness-oss) を
**Rasenca org にフォーク**したリポジトリ。プロダクト（LINE Harness）の実体は本家由来だが、
Rasenca としての運用・意思決定・計画を、社内の project-bootstrap-playbook の流儀に寄せて時系列で蓄積する。
`.agents/` は「なぜそう決めたか（why）」を後から追えることを最優先にする場所。

**このフォークにおける最重要トポロジー（誤解防止）:**

```
Shudesu/line-harness-oss (Public / OSS)   ← UPSTREAM = フォーク元（本家）※書き込み禁止
        ↓ GitHub fork + .github/workflows/update-from-upstream.yml（本家→こちらへ PR）
rasenca/line-harness-oss (Public)          ← 我々のフォーク = origin（作業対象）
```

- **変更は必ず `rasenca/line-harness-oss`（origin）に対してのみ行う。** 詳細は [decisions/0002-fork-safety-no-upstream-writes.md](decisions/0002-fork-safety-no-upstream-writes.md)。
- `docs/OSS-SYNC-CHARTER.md` など一部の既存ドキュメントは**本家 Shudesu 視点の内容がフォークで継承されたもの**。Rasenca の読み替えは [decisions/0001-adopt-bootstrap-playbook-in-rasenca-fork.md](decisions/0001-adopt-bootstrap-playbook-in-rasenca-fork.md) を参照。
- **用語注意「upstream」:** 本家由来の `docs/OSS-SYNC-CHARTER.md` では upstream = `Shudesu/line-harness`（Private）を指す。**本 `.agents/` では upstream = フォーク元 `Shudesu/line-harness-oss`** を指す（同じ語が別リポを指すので混同しない）。

## 設計哲学（この体系の背骨・9 原則）

以降の全規約はこの 9 原則の具体化にすぎない。

1. **意思決定は必ず残す（why を失わない）。** 「何を決めたか」ではなく「なぜそう決めたか」を、上書きせず時系列で積む。決定は ADR に、迷いは open-questions に、実装詳細は spec に。
2. **AI 向けの文脈と人間向けの正典を分ける。** `.agents/`（過程・意思決定・計画）と `docs/`（今の完成形）を分離する。寿命と更新方針が違うものを混ぜない。
3. **反復する運用手順は「常設化」して自動再現する。** セッション追従・PR 作成・ADR 監査のような繰り返し作業は `.claude/skills/` に手順書として常設し、トリガー語で毎回同一品質に再現する。人間の記憶に規律を依存させない。
4. **テスト容易性を第一級の設計制約にする。** 依存を引数で注入し（DI）、計算を純粋関数に切り出す。
5. **危険な操作は fail-closed で塞ぐ。** 素の `deploy` は誤爆するので無効化し、環境を明示したコマンドだけ許す。認可はサーバ側で必ず再チェック。
6. **プラットフォーム標準に寄せ、依存を増やさない。** 外部依存は最小化し、避けられないものはサーバ経由で「囲う」。
7. **成果物は対立レビューを通してから確定する。** 実装・ドキュメント・テストは、確定前に批判的レビュアー（別サブエージェント）に反証させる。指摘は鵜呑みにせず自分で裏取りする。
8. **ユーザーと能動的に協働する。** 要求はざっくり来る前提で、質問は選択肢＋比較でクリック選択できる形に。大きい/並列可能な仕事はチーム編成する。
9. **シンプルは全てに勝る（最小で最大を）。** 器・依存・抽象・ファイル・手順を足す前に「これは本当に要るか」を問い、迷ったら増やすより減らす側に倒す。

## 記録の流儀

- 意思決定は ADR に残す（`decisions/NNNN-kebab-title.md`、4 桁ゼロ埋め連番・欠番/再利用なし）。
  フォーマット: `status / date / relates` ＋ `Context / Decision / Alternatives / Consequences`。
  任意フィールド（`reference:` / `tracks:` / `source:` / `scope:` / `refines:`）を必要に応じて足してよい。
  status は `PROPOSED / ACCEPTED / SUPERSEDED / DEPRECATED`。**上書きせず `## Update (日付)` で追記**。
- 決めきれない論点は `open-questions.md` に積む（`OPEN / ANSWERED / BLOCKER`）。解決したら反映先（decisions/specs/docs）を明記。
- 仕様の詳細は `specs/` に（横断的関心事の型が出てきた時点で作る）。ADR は「決定の記録」、spec は「実装可能な詳細」。
- **どのファイルを足しても `index.md` を同期する。**
- `docs/` は「今の完成形」（上書き更新される正典）、`.agents/decisions/` は「その時点でなぜそう決めたか」（不変に積むログ）。両者を混ぜない。

## 命名規則

- Git 管理下のファイル名/フォルダ名は英数字（＋ハイフン/アンダースコア）。**日本語ファイル名は禁止**。
- ADR: `NNNN-kebab-title.md`。ブランチ: `type-kebab-summary`（hyphen 形で統一）。ブランチ type = `feat|fix|docs|chore|refactor`（コミットの type はこれに加え `test|ci` も可）。

## コミット/PR 運用

- **`main` への直 push は厳禁。** 変更は必ずブランチ → PR 経由でマージ。PR は必ず [`create-pr` skill](../.claude/skills/create-pr/SKILL.md) の経路を通す。
- **PR / push の宛先は必ず `rasenca/line-harness-oss`（origin）。upstream（`Shudesu/line-harness-oss`）へは絶対に出さない**（→ [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md)）。
- CI 対象パスを含む PR は CI 緑を確認してからマージ（赤ならマージしない）。CI が起動しない変更（docs / `.agents/` / `.claude/` のみ等）は PR 本文「検証」の手動確認をゲートとする。
- PR タイトルは英文（Conventional Commits）、本文は日本語可。コミット末尾に `Co-Authored-By: <使用中の AI モデル名> <noreply@anthropic.com>` を付ける（モデル名だけ実際のものに、メールは固定）。
- 破壊的 git 操作・force push はユーザー承認なしに行わない。コミット/push/merge は明示依頼時のみ。ファイル削除は権限バイパス設定でも必ずユーザー確認を取る。

## 不変ルール（絶対に破らない規律）

1. **upstream（`Shudesu/line-harness-oss`）へ push / PR しない。** 変更の宛先は常に origin = `rasenca/line-harness-oss`。（→ [ADR-0002](decisions/0002-fork-safety-no-upstream-writes.md)）
2. **`main` への直 push は厳禁。** 変更は必ずブランチ → PR → CI 緑 → マージ。
3. **意思決定は上書きせず追記。** ADR は `## Update (日付)`、open-questions は反映先を残す。証拠は file:line で自分で裏取り。
4. **破壊的 git 操作・force push・勝手なマージはしない。** コミット/push/merge はユーザー依頼時のみ。既定ブランチ上なら先にブランチを切る。
5. **秘密はコミットしない。** 公開リポなので特に厳格に。新規ファイルは push 前にシークレット混入を確認する。
6. **成果物は対立レビューを通してから確定。** 指摘は鵜呑みにせず自分で検証する。
7. **ファイルを足したら `index.md` を同期。**
8. **Git 管理下のファイル名は英数字（＋ハイフン/アンダースコア）。** 日本語ファイル名は禁止。
9. **ファイルは実フォルダに直接読み書きする。削除を伴う操作は、権限バイパス設定でも必ずユーザー確認を取る。**
