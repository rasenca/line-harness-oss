---
name: create-pr
description: rasenca/line-harness-oss の変更を、リポジトリの流儀に沿ってブレなく、かつ「フォーク安全」に PR 化する。ブランチ作成→論理単位コミット→push→gh pr create までを、Conventional Commits の英文タイトル・日本語の構造化本文（概要/主な変更/検証/補足）・関連 ADR の紐づけつきで実行し、宛先を必ず origin（rasenca/line-harness-oss）に固定して upstream（Shudesu/line-harness-oss）への誤爆を防ぐ。「PRを作って」「PR出して」「プルリク作成」「この変更をPRにして」「ブランチ切ってPR」等で起動。マージに向けて出す局面では明示依頼が無くても使ってよい（main直push厳禁・upstream誤爆厳禁なので必ずこの経路を通す）。rasenca/line-harness-oss リポジトリ用。
---

# create-pr — 規約準拠かつフォーク安全な PR 生成

このリポジトリは `Shudesu/line-harness-oss` の**フォーク**（origin = `rasenca/line-harness-oss`）。
PR には house style があり、毎回それを再現して体裁ブレをなくす。
**2 つの厳禁を必ず守る:**
- **`main` への直 push は厳禁**（変更は必ずこの経路で PR にする）。
- **upstream（`Shudesu/line-harness-oss`）への push / PR は厳禁**（→ [ADR-0002](../../../.agents/decisions/0002-fork-safety-no-upstream-writes.md)）。

## 原則（なぜ）

- PR は「何を・なぜ」を後から追える記録。本文で関連 ADR・課題・先行 PR を紐づける。
- 1 PR = 1 論理単位。無関係な未コミット/未追跡は巻き込まない。混在なら PR を分ける。
- **フォークでは `gh pr create` の既定 base が親（upstream）に向くことがある。** だから宛先を常に明示する。
- コミット/push/PR 作成・マージはユーザー依頼時のみ。破壊的 git 操作・force push は承認なしに行わない。

## 0. 前提・フォーク安全チェック（最重要）

```bash
gh auth status
gh repo set-default --view          # → rasenca/line-harness-oss であること。違う/未設定なら次行で固定
gh repo set-default rasenca/line-harness-oss
git remote -v                        # push 先が origin = rasenca/line-harness-oss だけであること
```

- `git remote -v` に `upstream`（Shudesu）が push 先として出ていたら push を無効化する:
  ```bash
  git remote set-url --push upstream DISABLE
  ```
- 今 `main` にいるか確認。いるなら §1 で先にブランチを切る。
- PR に含める変更を必ず目視する: `git status -sb` / `git diff`。

## 1. ブランチ

命名: `type-kebab-summary`（hyphen 形）。type = `feat|fix|docs|chore|refactor`。

```bash
git checkout -b docs-<short-summary>
```

## 2. コミット（論理単位）

タイトル = Conventional Commits・英文・命令形・小文字始まり・末尾ピリオドなし。body は日本語可。末尾に Co-Authored-By:

```bash
git add <論理単位のパス...>
git commit -m "$(cat <<'EOF'
type(scope): imperative summary in English

<日本語で「何を・なぜ」。関連 ADR/課題/先行 PR を紐づける>

Co-Authored-By: <使用中の AI モデル名> <noreply@anthropic.com>
EOF
)"
```

## 3. push 前のローカルチェック（赤 PR を出さない）

コードを含む PR は、`pull_request` で走る CI（現状 `.github/workflows/worker-ci.yml` のみ・パス限定）と同じチェックを手元で通す。このリポジトリは **pnpm** 運用:

```bash
pnpm install --frozen-lockfile
pnpm --filter @line-crm/shared --filter @line-crm/line-sdk --filter @line-crm/db --filter @line-harness/update-engine build
pnpm --filter worker typecheck
pnpm --filter worker test
pnpm --filter worker build
```

- **ドキュメント / `.agents/` / `.claude/` のみの PR は worker-ci の対象パス外で CI が走らない。** ローカルチェックは省略し、PR 本文「検証」に手動確認内容を明記する。

## 4. push & PR 作成（宛先を必ず明示）

宛先は必ず origin。`gh pr create` は継続行に行末コメントを付けない（`\` の後にコメントを置くとコマンドが途中で切れる）。

```bash
git push -u origin <branch>

# ★ --repo で宛先リポを明示（フォーク親 upstream へ出さない）。--head も省略しない
gh pr create \
  --repo rasenca/line-harness-oss \
  --base main \
  --head "<branch>" \
  --title "type(scope): summary" \
  --body "$(cat <<'EOF'
## 概要

<何を・なぜ。関連 #PR / ADR / 課題を紐づける>

## 主な変更

| ファイル/ドキュメント | 変更内容 |
|---|---|
| ... | ... |

## 検証

<lint/test/e2e の結果。対立レビュー（サブエージェント）の有無と修正件数。影響範囲。
 ドキュメントのみなら「コード・挙動への影響なし」と明記>

## 補足

<任意。意図的な非変更・フォローアップ・残タスク・関連 ADR>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- 作成後、PR の URL が `github.com/rasenca/line-harness-oss/pull/...` であることを目視で確認する（`Shudesu/...` になっていたら即クローズし作り直す）。

## 5. マージ規律

- CI 対象パスを含む PR は **CI が緑になるまでマージしない**。赤なら原因を直す。
- CI 対象外（docs / `.agents/` / `.claude/` のみ等）で CI が起動しない PR は、待つべき「緑」が無い。この場合は PR 本文「検証」の手動確認をもってゲートとする。
- いずれも勝手にマージせず、状況を報告して可否をユーザー判断に委ねる。

## 完了時の報告

作成した PR の URL（**rasenca/line-harness-oss であることを明記**）・タイトル / 含めたスコープ（外した変更があればその旨）/ CI 状況とマージ可否
