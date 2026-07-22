# ADR-0004: main ブランチを ruleset で保護する（PR 必須・force push/削除禁止）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0002
- tracks: Q-002

## Context

conventions.md / ADR-0002 は「`main` への直 push 厳禁」を不変ルールとしていたが、初手（P0）時点では
**技術強制が無く運用規律のみ**で担保していた。playbook §3.3 は「ブランチ保護がプラン制約で使えない環境なら
その事実を記録し規律で守る」とし、将来のハードゲート候補に「リポジトリ公開」を挙げていた。

P2 で前提を確認した結果:
- 本リポジトリは **public**。public リポジトリは GitHub Free でも branch protection / rulesets が使える。
- 実行者は本リポジトリの **admin** 権限を持つ（`permissions.admin = true`）。
- 適用前は branch protection・rulesets ともに未設定（`main` は未保護＝直 push・force push が技術的に可能だった）。

したがって Q-002 の懸念（プラン制約で使えないかも）は外れ、**技術強制が可能**と判明した。

## Decision

`main` に **ruleset「protect-main」（id: 19551161, enforcement: active）** を適用し、規律を技術強制する。強度は「標準」:

- **`pull_request`（PR 必須）**: `required_approving_review_count: 0`。→ 直 push を塞ぎつつ、ソロ運用でも作者自身がマージできる（第三者レビュー必須にはしない）。`allowed_merge_methods: squash|merge|rebase`。
- **`non_fast_forward`（force push 禁止）**。
- **`deletion`（ブランチ削除禁止）**。
- **bypass_actors**: RepositoryRole `admin`（id 5, `bypass_mode: always`）。→ 緊急時の逃げ道として admin のみ手動 bypass 可能。通常運用は PR 経由を強制する。
- **required status checks は付けない。** `worker-ci` はパス限定で docs/`.agents` のみの PR では起動しないため、必須チェックにすると「起動しない check を永遠に待つ」stuck が起きる（ADR-0002 の Update / conventions と整合）。CI は引き続き「可視化ゲート」として運用。

適用コマンド（記録）: `gh api -X POST repos/rasenca/line-harness-oss/rulesets --input <ruleset.json>`。

## Alternatives

- **厳格（admin も bypass なし）。** → 却下（ユーザ選択）。ソロ運用での緊急対応の逃げ道を残す方を採った。将来チーム化したら bypass を外して厳格化しうる。
- **最小（force push/削除禁止のみ・直 push は許容）。** → 却下。conventions の「main 直 push 厳禁」を技術強制する主目的を満たさない。
- **classic branch protection を使う。** → 却下。ruleset の方が新しく宣言的で、将来 org 横断ルールへ拡張しやすい。
- **required status checks を必須化。** → 却下。path 限定 CI で docs PR が stuck する（既知の footgun）。

## Consequences

- `main` への直 push は技術的に不可能になった（PR 経由のみ。admin の手動 bypass を除く）。`create-pr` skill の経路がそのまま活きる。
- `update-from-upstream.yml` は PR を作る方式なので本保護と両立する（main へ直 push しない。→ ADR-0006）。feature ブランチへの push は影響を受けない。
- ruleset の設定変更・解除は admin が GitHub 上／API で行える。設定を変えたら本 ADR に `## Update (日付)` を追記する。
- Q-002 は ANSWERED（本 ADR が反映先）。将来チーム運用に移行する場合は「required approvals ≥ 1」「bypass 撤廃」を再検討。
