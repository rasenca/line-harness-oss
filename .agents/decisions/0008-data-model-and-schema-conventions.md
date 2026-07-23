# ADR-0008: データモデル・時刻/スキーマ規約・外部キー方針（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0007, ADR-0009
- source: docs/wiki/Architecture.md, docs/wiki/Friends.md, docs/wiki/Tags.md, docs/wiki/13-Scoring.md, docs/wiki/10-Tracked-Links.md, docs/wiki/11-Forms-and-LIFF.md, docs/wiki/Configuration.md, docs/wiki/22-Operations.md
- scope: D1 スキーマ全体に共通するデータ設計の決めごと

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針・出典は docs・未検証は留保）。

## Context

D1（SQLite）上のスキーマに一貫した設計原則が敷かれている。個別テーブルの詳細は各ドメイン ADR に譲り、ここでは**全テーブルに共通する横断的なデータ設計の決めごと**を記録する。

## Decision（記録する設計意図）

- **内部 UUID を主キーとし、LINE `userId` から分離する。** `friends.id` 等は内部 UUID。別テーブル `users`（内部 UUID + email/phone/external_id）を中間に置き `friends.user_id` で結ぶ。**同一人物が複数公式アカウントで別 `userId` になる問題を内部 UUID で吸収**し、クロスアカウント名寄せと BAN 復旧を可能にする（source: Architecture.md:271-292, Friends.md:243-256,279-284）。名寄せは email→phone の順（source: 18-Multi-Account-and-BAN.md:122-171）。
- **全タイムスタンプを JST（UTC+9）固定文字列 `YYYY-MM-DDTHH:mm:ss.sss+09:00` に統一**（`jstNow()`/`toJstString()`）。理由: 利用者がほぼ日本国内、Cron スケジューリングの UTC 変換バグ回避、D1/SQLite にタイムゾーン型が無いためアプリ層で統一（source: Configuration.md:205-236, Architecture.md:331-341）。
- **DB は snake_case 列、API/SDK 層で camelCase に変換**して返す（source: Friends.md:20-45, Tags.md:16,28-37）。
- **冪等なスキーマ適用**。`schema.sql` は `CREATE TABLE IF NOT EXISTS` で再実行可能。ホットパス（webhook 友だち検索/ステップ配信スケジューリング/メッセージログ/アフィリ集計）向けインデックスを schema.sql に定義（source: 21-Deployment.md:242, 22-Operations.md:294-298）。
- **キャッシュ列を許容し整合性はアプリ層責務とする。** `friends.score`（履歴 `friend_scores` の合計キャッシュ）、`*.submit_count`/`click_count` 等の集計キャッシュを持つ（読み取り高速化と引き換えに二重管理）（source: 13-Scoring.md:9-21, 11-Forms-and-LIFF.md:13-42, 10-Tracked-Links.md:62）。
- **外部キー方針の型: 子データは CASCADE、履歴・参照は SET NULL で残す。** 例: `friend_scores.friend_id` は友だち削除で CASCADE だが `scoring_rule_id` はルール削除で SET NULL（履歴保全）。`link_clicks.friend_id`/`form_submissions.friend_id` は SET NULL（匿名化して集計に残す）。フォームの `on_submit_tag_id`/`on_submit_scenario_id` は SET NULL（参照先が消えてもフォームは残す）（source: 13-Scoring.md:44-45, 10-Tracked-Links.md:67-76, 11-Forms-and-LIFF.md:13-42）。
- **`metadata` はスキーマレス JSON、更新は shallow merge**（既存キー上書き・新規追加、深い階層は上書き）。セグメント配信条件やステップ分岐キーに使える前提（source: Friends.md:177-195,361-366）。
- **ログテーブルの保持ポリシー（推奨）**: `messages_log` >90d / `friend_scores` >180d / `account_health_logs` >30d / `automation_logs` >60d を定期パージし D1 容量内に収める（強制ではなく運用推奨）（source: 22-Operations.md:143-161）。
- **バックアップは Cloudflare マネージド D1 に依存**（アプリ層の自動バックアップは持たず、`wrangler d1 execute --json` の手動エクスポートを補助手段とする）（source: 22-Operations.md:86-125）。

## Alternatives

- ドキュメントに明示的な却下案の記載はほぼ無い（JST 統一は UTC 保存の代替として明示的に採用理由を述べている）。

## Consequences

- クロスアカウント名寄せ（ADR-0010 マルチアカウント/BAN）、帰属（ADR-0012）、認証（ADR-0009）はこのデータモデルに依存する。
- **留保（要コード裏取り）:** テーブル総数の記載揺れ・パッケージ名混在は [Q-008](../open-questions.md)。キャッシュ列の整合性を保つ更新経路は要コード確認。

## Update (2026-07-23) — Q-008(テーブル数 / パッケージ名) のコード裏取り

P7 で `packages/db` / 各 `package.json` を確認。

**テーブル総数 = 55（docs の 42/45 は両方 stale）。**
- `grep -cE '^CREATE TABLE' packages/db/schema.sql` = **55**。docs（Home.md「45」/ Architecture.md「42」）はいずれも過小＝スキーマが成長済み。以降テーブル数を引用する際は schema.sql を典拠とする。

**パッケージ名は実際に混在（doc 誤記ではなく現行の実態）。**
- `@line-crm/*`（コア）= `db` / `line-sdk` / `shared`。`@line-harness/*`（ツール系）= `mcp-server` / `sdk` / `update-engine` / `plugin-*`。無スコープ = `web` / `worker` / `liff` / `create-line-harness`。
- → 「`@line-harness/*` と `@line-crm/*` の混在」は**史実として正**（コアは旧 `@line-crm`、後発ツールは `@line-harness`）。ADR/docs で参照する際はパッケージごとの実スコープに従う（例: deploy workflow の `pnpm --filter @line-crm/shared`）。

→ [Q-008](../open-questions.md) のテーブル数・パッケージ名は ANSWERED。ADR-0007 の同一留保も本 Update で解消（相互参照）。
