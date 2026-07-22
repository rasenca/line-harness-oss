# ADR-0016: CI/デプロイ/リリースのワークフロー設計（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0004, ADR-0005, ADR-0006
- source: .github/workflows/deploy-cloudflare-worker.yml, .github/workflows/deploy-cloudflare-admin.yml, .github/workflows/release.yml, .github/workflows/worker-ci.yml, .github/workflows/deploy-pages.yml
- scope: `.github/workflows/` のワークフロー設計意図

> **この ADR について:** 継承した GitHub Actions ワークフローの**設計意図**を記録。ワークフローは Rasenca フォーク上にも存在する（applies-to-rasenca）が、デプロイ系は変数未設定で **dormant**（ADR-0005）。個別ワークフローの運用方針は ADR-0004（main 保護）/0005（デプロイ）/0006（upstream 追従）が扱い、本 ADR は**ワークフロー内部の設計判断**に絞る。

## Context

CI/デプロイ/リリースの各ワークフローには、事故防止のための設計判断（二重ガード・冪等マイグレ・設定ドリフト対策・deploy とリリースの分離・最小権限）が埋め込まれている。これらを設計意図として記録する。

## Decision（記録する設計意図）

- **デプロイの二重ガード（本家除外 + オプトイン変数）**: `deploy-cloudflare-worker.yml`/`admin.yml` は `if: github.repository != 'Shudesu/line-harness-oss' && vars.LINE_HARNESS_CLOUDFLARE_DEPLOY == 'true'`。本家では動かさず、フォークでも変数を明示 opt-in しない限り発火しない安全既定。push→main（パス限定）+ dispatch トリガー（source: deploy-cloudflare-worker.yml:16-17, deploy-cloudflare-admin.yml:16-17）。→ Rasenca では未設定で dormant（ADR-0005）。
- **D1 マイグレは deploy 前に冪等適用**（独自 `_migrations` 追跡表で適用済みを判定し未適用のみ `--remote`）。再デプロイでの二重適用防止・additive-only との整合（source: deploy-cloudflare-worker.yml:32-58）。
- **admin CORS 変数を deploy 済み config に焼き込む（ダッシュボード変数ドリフト対策）**: `ADMIN_ORIGIN`/`ADMIN_ALLOW_CROSS_SITE`/`WORKER_URL` を deploy 時に `vars` へ注入。手動ダッシュボード変数は再デプロイで無言で落ちるが、config に焼けば毎回運ばれ落ちない（source: deploy-cloudflare-worker.yml:73-100）。
- **リリースは deploy と意図的に分離**（`release.yml` は tag `v*.*.*` push で発火・`GITHUB_TOKEN` のみで CF 資格情報を持たない）。Release 作成に deploy 権限を混ぜない分離設計（source: release.yml:31-42）。
- **リリース成果物のバージョン identity 設計**: マイグレ安全チェック（additive-only）→ test → build。Worker は `wrangler deploy --dry-run --outdir`（実 deploy と同一ビルド経路）で単一ファイル化しハッシュ算出、`worker_hash` を `_version.ts` に埋込。最終成果物の byte ハッシュは埋込後に自己ハッシュと一致し得ないため `worker_bundle_hash` として分離。`release-manifest.json` を過去 release とマージ、`min_from_version` で upgrade flow 制御、**draft Release で人間レビューをゲート**してから shipping 扱い、`required_secrets` を明記し `create-line-harness` と同期（source: release.yml:13-33,69-70,108-224,256-267）。
- **Worker CI は最小権限**（`worker-ci.yml`: PR/push→main（パス限定）/dispatch、`permissions: contents: read`、共有パッケージ build 後に worker の typecheck→test→build）。フォークの PR でも動く唯一の常時 CI（source: worker-ci.yml:3-49）。
- **Pages docs デプロイの並行性制御**（`deploy-pages.yml`: `gh-pages` push/dispatch、`concurrency: {group: pages, cancel-in-progress: true}`）。Rasenca は `gh-pages` 無しで dormant（source: deploy-pages.yml:3-15）。

## Alternatives

- リリースとデプロイを 1 ワークフローに統合 → 採らず（権限・トリガーを分離）。

## Consequences

- これらの設計意図は、将来 Rasenca が独自デプロイを有効化する（ADR-0005 P5）際にそのまま活きる。有効化時は本 ADR の設計を前提にリリース手順を docs に正典化する。
- **留保:** デプロイ系は dormant のため実発火の検証はしていない。有効化時に実際の挙動（冪等マイグレ・CORS 焼き込み・draft ゲート）を確認する。
