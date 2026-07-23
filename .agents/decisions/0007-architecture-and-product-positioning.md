# ADR-0007: システムアーキテクチャ・実行基盤・プロダクト位置づけ（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0001, ADR-0008
- source: docs/wiki/Architecture.md, docs/wiki/Home.md, docs/wiki/Configuration.md, docs/wiki/21-Deployment.md, docs/manual/01-intro.md, README.md
- scope: プロダクト全体の実行基盤と設計思想

> **この ADR について:** upstream（`Shudesu/line-harness-oss`）由来ドキュメントに記された**設計意図を Rasenca の正典として記録**する（我々が運用するコードの設計判断）。出典は docs。**コードでの裏取りは要所のみで、未検証箇所は Consequences に留保**。表記の食い違い（テーブル数等）は open-questions で追跡。

## Context

LINE 公式アカウント CRM を、外部 SaaS（"L社/U社"）の代替として、サーバー代ほぼ 0 円・全機能 API 公開・AI から操作可能な形で実現するというプロダクト。実行基盤とアーキテクチャの骨格が複数ドキュメントに散在していたため、設計意図を 1 枚に集約する。

## Decision（記録する設計意図）

**プロダクト位置づけ・思想**
- 「単なる Lstep クローン」ではなく **「AI が LINE を安全に操作するための基盤」**。AI 暴走を防ぐトラッキング・確認フロー・BAN 対策を運用層に組み込むことを差別化の核とする（source: docs/manual/01-intro.md:37,46, README.md:168）。
- 解決課題 = SaaS の 3 つの壁: **コスト増・ベンダーロックイン・AI 連携不可**（source: docs/manual/01-intro.md:26）。0 円（Cloudflare 無料枠）・MIT・全機能 API 公開・MCP server 同梱を看板に据える（source: README.md:9-16,31-32）。
- **API-first / 管理 UI は読み取り・確認専用**。全機能を REST API で公開し、AI（Claude Code 等）が API 経由で操作、人間が監督、管理画面は状態可視化に徹する（source: docs/wiki/Home.md:7-8,46）。

**実行基盤（スタック）**
- エッジ実行: **Cloudflare Workers + Hono**。DB: **Cloudflare D1（SQLite）**。定期実行: **Workers Cron（5 分間隔）**。管理画面: Next.js 15 App Router + Tailwind（CF Pages）。LIFF: Vite + vanilla TS。LINE API は自作の型付き SDK（`@line-crm/line-sdk`）経由。近ゼロコストで動かすため（source: docs/wiki/Home.md:37-46, Architecture.md:5-33）。
- **pnpm monorepo**（apps/{worker,web,liff} + packages/{db,line-sdk,sdk,shared}）、Node/pnpm はピン留め（source: docs/wiki/21-Deployment.md:9-24）。

**中核の設計判断**
- **Webhook は無条件 200 を返す + 重処理は `waitUntil` で非同期化**。LINE が約 1 秒以内の応答を要求するため、署名失敗でも 200 を返し重処理を遅延実行（source: docs/wiki/Architecture.md:132,137-138,264）。
- **Cron ファンアウト + 失敗分離**。5 分 Cron が 4 ジョブ（ステップ配信/予約ブロードキャスト/リマインダー/ヘルスチェック）を `Promise.allSettled` で実行し、1 ジョブの失敗が他を止めない。ステップ配信は失敗した `friend_scenario` のみスキップして継続（source: Configuration.md:150-162, Architecture.md:169-197）。
- **中央イベントバス `fireEvent`**。単一パイプラインがイベントを 送信 Webhook / スコアリング / IF-THEN 自動化 / 通知ルール へファンアウトし、副作用を発火元ハンドラから分離（source: Architecture.md:199-225）。
- **LIFF は Worker からビルド・配信**（`@cloudflare/vite-plugin` で `wrangler deploy` 時に同梱）。旧構成（別途 CF Pages に LIFF デプロイ）は非推奨（source: 21-Deployment.md:202-206,360-388）。
- **1 デプロイ = 1 LINE アカウント（環境分離）**。各 LINE アカウントが独立 Worker デプロイを持つ（ステルス姿勢の一部でもある）。D1 リージョンは APAC/KIX（source: Architecture.md:352, Configuration.md:26-36）。

## Alternatives

- LIFF を別デプロイ（旧 CF Pages 構成）→ 非推奨化（Worker 同梱に統一）。それ以外の代替はドキュメントに明示なし。

## Consequences

- 以降の各ドメイン ADR（データモデル ADR-0008、認証 ADR-0009、配信 ADR-0010 …）は本 ADR の基盤の上に立つ。
- **留保（要コード裏取り）:** ドキュメント間でテーブル数の記載が食い違う（Home.md:41「45」 vs Architecture.md:26,268「42」）。実体は `packages/db/schema.sql` で確認する（→ [open-questions Q-008](../open-questions.md)）。パッケージ名も docs 内で `@line-harness/*` と `@line-crm/*` が混在（同 Q-008）。
- プロダクト位置づけのうち料金比較・OSS マーケティング表現は本家の GTM 由来（shudesu-only-reference）だが、プロダクトを運用する以上「AI ネイティブ安全運用基盤」という思想は Rasenca でも踏襲する。

## Update (2026-07-23) — 留保（テーブル数・パッケージ名）を ADR-0008 で解消

本 ADR Consequences の留保（テーブル数 42/45 の食い違い・`@line-harness/*` と `@line-crm/*` の混在）を P7 でコード裏取りし、[ADR-0008 の Update (2026-07-23)](0008-data-model-and-schema-conventions.md) に確定記録した。要点: **テーブル総数 = 55（schema.sql 実測）**、パッケージ名混在は**史実として正**（コア = `@line-crm/*`、後発ツール = `@line-harness/*`）。詳細と file:line は ADR-0008 を参照。
