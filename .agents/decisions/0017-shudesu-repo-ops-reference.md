# ADR-0017: 【参考記録】Shudesu本家のリポ運用・同期・リリースプロセス

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0001, ADR-0003, ADR-0004, ADR-0005, ADR-0006
- source: docs/OSS-SYNC-CHARTER.md, docs/OSS-SANDBOX-MERGE-GATE.md, docs/FORK_CLOUDFLARE_WORKFLOW.md, docs/CREATE_LINE_HARNESS_SANDBOX.md, CONTRIBUTING.md
- scope: 本家 Shudesu のリポ運用プロセス（参考）
- relevance: shudesu-only-reference

> **この ADR について:** 以下は**本家 `Shudesu` のリポ運用の意思決定・プロセスの記録**であり、**Rasenca フォークでは実行しない**（ADR-0003 の Cat2 整理に対応）。ユーザー要望「抽出できる全部を転記」に応え、Shudesu 由来ドキュメントに残る決定を**参考記録**として 1 枚に集約する。Rasenca 自身の運用規律は ADR-0002/0004/0005/0006 が正典。

## Context

継承ドキュメント（`docs/OSS-SYNC-CHARTER.md` 等）には、本家が Private↔OSS を運用するための決定・不変ルールが詳細に残る。これらは Rasenca の手順ではないが、「なぜ本家がこう作ったか」を理解する文脈として、また将来 Rasenca が類似運用を要する場合の参照として記録価値がある。

## Decision（＝本家の決定の記録。Rasenca は実行しない）

**リポジトリ同期モデル**
- **二層リポジトリ**: `Shudesu/line-harness`(Private=本番設定/secret を持つ source-of-truth) が upstream、`Shudesu/line-harness-oss`(Public) が downstream。外部 PR は Private へ逆マージ。理由=利用者の本番安全を公開速度より優先（source: OSS-SYNC-CHARTER.md:16-19, CONTRIBUTING.md:17-31）。**※ Rasenca のトポロジー（本家=単純フォーク元）とは別物（ADR-0001/0003）**。
- **OSS main へ直 push 禁止・常に PR、`scripts/sync-oss.sh` は dry-run 既定・`--apply` 必須・main/master checkout では失敗・`rsync --delete` 不使用**（footgun 封じ）（source: OSS-SYNC-CHARTER.md:31-38）。
- **除外/秘匿化/リーク検知はスクリプトを単一の真実に集約**（`oss-sync.excludes`/`oss-secret-redactions.sed`/`oss-secret-grep.patterns`。doc の表と二重管理しない）（source: OSS-SYNC-CHARTER.md:37-159）。
- **OSS→Private 逆同期は次回 sync 前に必須**（取り込まないと同一領域が競合・上書き）（source: OSS-SYNC-CHARTER.md:67-74）。

**秘匿・セキュリティ運用**
- **秘匿化 + リーク時対応を単独悪用可否で分岐**: sync 時に CF アカウント ID/D1 ID/運営メールをプレースホルダ置換、sync 前 grep でリーク検知し検出時中止。事故時は即ローテ優先、単独悪用不可（ID 等）は履歴書換不要（force push はフォーク破壊のため回避）、単独悪用可（API キー等）のみ BFG+force push を天秤にかけ検討（source: OSS-SYNC-CHARTER.md:156-188）。
- **高リスク領域（認証/CORS/webhook 検証/broadcast/migration/deploy 自動化/送信可能な MCP・SDK）は公開前に Private で再実装しうる**（source: CONTRIBUTING.md:118-132）。

**マージゲート / サンドボックス**
- **merge と production deploy を同一操作にしない（不変ルール）**: `OSS CI → sandbox smoke → merge → Private 逆同期 → deploy 判断`。理由=OSS main は利用者 fork に取り込まれ CF に deploy されるため merge は他人の環境も壊しうる（source: OSS-SANDBOX-MERGE-GATE.md:10-23）。
- **本番と sandbox の完全分離**（Worker/D1/R2/LINE channel/Pages/cron を分け、本番 D1・本番 channel を検証に使わない。`LINE_CAPTURE_ONLY=1` 等）（source: OSS-SANDBOX-MERGE-GATE.md:26-38）。
- **リスク三分類でゲート段階化**（Safe-ish=CI+手動 / Needs Sandbox=auth・CORS・LIFF・webhook・scenario・migration → sandbox smoke+rollback / High Risk=大規模 refactor・権限・送信・migration+配信 → PR 分割+sandbox+deploy を merge と別日）（source: OSS-SANDBOX-MERGE-GATE.md:41-89）。
- **未信頼コード（外部 PR）をローカル実機で実行しない**（GH Actions/CF sandbox/使い捨て VM で checkout）（source: OSS-SANDBOX-MERGE-GATE.md:91-106）。
- **`create-line-harness` インストーラ再現は HOME 隔離シェルで**（`~/.line-harness`/wrangler auth/npm 設定を汚さないため。CF/LINE 実リソースは別途分離）（source: CREATE_LINE_HARNESS_SANDBOX.md:1-79）。

**外部 PR / 貢献プロセス**
- **OSS Issue/PR の DoD**: 修正は必ず Private、回帰/source-level テスト、typecheck/build/test 記録、`git diff --check`、dry-run で公開差分確認、OSS sync PR + CI 通過、Issue/PR への検証済み返信まで。「コードを書いた」では未完了（source: OSS-SYNC-CHARTER.md:95-110）。
- **外部 PR 受け入れ基準**（セキュリティ/非破壊/style/secret 無し/テスト）と**マージ禁止**（破壊的変更/大規模 refactor/ライセンス変更/依存大幅変更）（source: OSS-SYNC-CHARTER.md:210-229, CONTRIBUTING.md:43-132）。**※ Rasenca フォークは外部コントリビュートを受け付けない（CONTRIBUTING.md 冒頭の Rasenca 注記・ADR-0003）**。

**fork-as-production モデル**
- **利用者は fork を本番として育てる**（fork の main=本番デプロイ、`feature/*`=開発、`upstream/*`=本流取り込み）。CF secrets/LINE token を GH に commit しない、wrangler.toml に本番 secret 書かない（source: FORK_CLOUDFLARE_WORKFLOW.md:5-118）。→ Rasenca の main 保護は ADR-0004、デプロイ dormancy は ADR-0005 でカバー済み。

**バージョニング / リリース**
- **semver + root `package.json` を単一の真実**、umbrella（apps/web,worker,packages/sdk,mcp-server）を `scripts/sync-versions.sh` で同期。`db`/`shared`/`create-line-harness`/`plugin-template` は独立バージョン。`.githooks/pre-push` が版差を push 前チェックし不一致で拒否（source: OSS-SYNC-CHARTER.md:237-289）。
- **npm publish でなく `pnpm publish`**（`workspace:*` を実バージョンに変換するため）（source: OSS-SYNC-CHARTER.md:273-275）。
- **ダッシュボード表示バージョンをビルド時注入**（`APP_VERSION`/`APP_COMMIT_SHA`/`APP_BUILD_TIME`、path filter に root package.json を含め二重防御）（source: OSS-SYNC-CHARTER.md:277-283）。
- **本番デプロイは Mac Mini SSH 経由で wrangler.toml を一時書換→`git checkout` で復元**（本家の本番デプロイ機構。Rasenca の CF/GH Actions デプロイとは別物・dormant）（source: OSS-SYNC-CHARTER.md:293-303）。

**AI エージェント向け不変ルール（本家）**
- 送信系（send_message/broadcast）はユーザー確認なしに実行しない、OSS 同期ファイル/CLAUDE.md に secret を書かない、外部 PR マージ後は次作業前に Private 取込（source: OSS-SYNC-CHARTER.md:307-315）。→ 「送信前確認」の思想は Rasenca でも踏襲（ADR-0014）。

## Alternatives

- （本家の決定であり、Rasenca としての代替評価は行わない。参考記録に徹する。）

## Consequences

- 本 ADR は**参考記録**。Rasenca はこれらの手順（Private↔OSS 同期、sync-oss.sh、Mac Mini デプロイ、pnpm publish リリース等）を**実行しない**。Rasenca の正典は ADR-0002/0004/0005/0006 と conventions.md。
- 将来 Rasenca が独自リリース/デプロイ運用を持つ（ADR-0005 P5）場合、本家のこれらの設計（merge≠deploy、冪等マイグレ、版差 pre-push チェック等）を参考に、Rasenca 版の手順を別 ADR で定義する。
