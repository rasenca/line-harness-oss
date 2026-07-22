# ADR-0002: フォーク安全規律 — upstream（Shudesu/line-harness-oss）へ push / PR しない

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0001
- scope: git remote 操作・`gh` 操作・PR 作成の全経路（人間・AI エージェントを問わず）

## Context

`rasenca/line-harness-oss` は OSS 本家 `Shudesu/line-harness-oss` を GitHub フォークしたリポジトリ。
このため、以下の「本家へ誤って書き込む」事故のリスクが構造的に存在する。これは Rasenca org のリポジトリを
育てるうえで**最優先で塞ぐべき不変ルール**であり、ユーザーからも明示的に強い記載を求められている。

具体的な footgun:

1. **`gh pr create` の既定 base がフォーク親（upstream）に向く。** フォークされたリポジトリで `gh pr create` を
   実行すると、GitHub CLI は base リポジトリの候補として**フォーク親（`Shudesu/line-harness-oss`）を提示・既定化する**
   ことがある。無意識に進めると、こちらのブランチが本家への PR になる。
2. **`gh` のデフォルトリポジトリ未設定。** 導入時点で `gh repo set-default` が未設定だった。未設定だと
   `gh pr create` / `gh pr view` 等の暗黙の向き先が確定せず、上記 1 の事故に繋がりやすい。
3. **`git push upstream ...` / `git remote add upstream` 後の誤 push。** `.github/workflows/update-from-upstream.yml`
   は本家を取り込むために CI 内で `upstream` remote を追加するが、これは「本家 → こちら」方向で push 先は origin 限定・
   本家上では動かないガード付き（`if: github.repository != 'Shudesu/line-harness-oss'`）。一方、**ローカルで人間/AI が
   `upstream` を追加して push する経路には何のガードも無い**。
4. **公開リポなので事故が即座に外部から可視。** 本家に誤 PR が出れば本家メンテナ・コミュニティに通知が飛ぶ。

現状（導入時に確認済み）:
- `git remote -v` は `origin git@github.com:rasenca/line-harness-oss.git` のみ。ローカルに `upstream` remote は無い。
- `gh repo set-default rasenca/line-harness-oss` を設定済み（ローカル `.git/config`・コミット対象外）。

## Decision

**変更（push / PR）の宛先は、常に `rasenca/line-harness-oss`（origin）のみとする。upstream `Shudesu/line-harness-oss` へは push も PR も一切行わない。** 具体的な担保を多層で置く。

1. **PR は必ず origin・main 宛に明示して作る。** `gh pr create` は宛先を必ず明示する:
   ```bash
   gh pr create --repo rasenca/line-harness-oss --base main --head "<branch>" ...
   ```
   `--repo` と `--head` を省略しない。これを [`create-pr` skill](../../.claude/skills/create-pr/SKILL.md) に組み込み、唯一の PR 作成経路にする。
2. **`gh` のデフォルトリポジトリをフォークに固定する。**
   ```bash
   gh repo set-default rasenca/line-harness-oss
   ```
   （ローカル設定。クローンし直したら再設定する。`gh repo set-default --view` で確認。）
3. **`upstream` remote は原則追加しない。** 本家を手元で参照する必要が出た場合のみ追加し、**push を無効化する**:
   ```bash
   git remote add upstream https://github.com/Shudesu/line-harness-oss.git
   git remote set-url --push upstream DISABLE   # 誤 push を fail-closed で塞ぐ
   ```
   本家取り込みは原則 `update-from-upstream.yml`（CI）に任せ、ローカルで upstream を常設しない。
4. **`git push` の宛先は常に `origin`。** `git push upstream ...` は禁止。push 時は宛先を目視する。
5. **人間・AI を問わず適用。** AI エージェントはこの ADR と [conventions.md](../conventions.md) の不変ルールに従い、PR/push の前に宛先を確認・報告する。

## Alternatives

- **規律（記憶）だけで守る。** → 却下。人間・AI ともに記憶依存は再現性が無く、footgun が構造的に残る。技術的固定（set-default / --repo 明示 / push 無効化）と併用する。
- **フォーク関係を解除して独立リポにする。** → 却下（現時点）。`update-from-upstream.yml` による本家追従の利点を失う。追従が不要になった時点で再検討（open-questions で追跡）。
- **本家へのコントリビュートを許容する運用にする。** → 却下（現時点）。Rasenca 独自運用を確立するのが先。将来本家へ還元する PR を出す場合は、その時に別 ADR で「意図的・明示的な例外手順」を定義する（この ADR の禁止は「無意識・誤爆の防止」が主眼）。

## Consequences

- `create-pr` skill は `--repo rasenca/line-harness-oss` を常にハードコードする。体裁ブレと誤爆を同時に防ぐ。
- クローンやマシン移行のたびに `gh repo set-default` の再設定が必要（skill の前提チェックに含める）。
- 本家由来の既存ドキュメント（`docs/OSS-SYNC-CHARTER.md` 等）は Shudesu 視点で「本家へ逆マージ」等を記述しているが、**Rasenca フォークではそれらの upstream 書き込み手順を実行しない**。読み替えは [ADR-0001](0001-adopt-bootstrap-playbook-in-rasenca-fork.md) を参照。
- 将来、本家へ意図的に還元する必要が生じたら、この ADR に `## Update (日付)` を追記し、例外手順を明示してから行う（黙って例外を作らない）。
