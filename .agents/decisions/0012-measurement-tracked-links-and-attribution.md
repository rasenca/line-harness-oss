# ADR-0012: 流入計測・トラッキングリンク・広告CV返送・アフィリエイト成果帰属（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0008, ADR-0009, ADR-0013, ADR-0015
- source: docs/wiki/10-Tracked-Links.md, docs/wiki/17-CV-Tracking-and-Affiliates.md, docs/wiki/27-Affiliate-ASP.md, docs/ad-conversion-spec.md, docs/wiki/Friends.md, docs/wiki/Getting-Started.md
- scope: 流入計測・成果帰属ドメイン（tracked link / CV / アフィリ / 広告返送）

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針）。**このドメインは設計が最も濃く、かつ未検証・要注意点が多い**（`ad-conversion-spec.md` は本家向け提案仕様で実装未確認、重複検出方式の記述揺れ、帰属ロジック 2 系統併存）。Consequences の留保を必ず参照。

## Context

「クリック → 友だち追加 → LINE 内アクション → CV → 広告媒体返送」を一気通貫で計測し ROAS を出すことがプロダクトの核。計測の前提となる流入捕捉から、成果帰属・不正対策までを記録する。

## Decision（記録する設計意図）

**流入捕捉の大前提**
- **友だち追加は必ず `/auth/line?ref=xxx`（LINE Login OAuth, `bot_prompt=aggressive`）経由とする運用ポリシー**。QR 直スキャン/検索追加では Webhook `follow` のみで `user_id=NULL` になり UUID を取れない。`/auth/line` 経由なら**友だち追加と同時に UUID 取得 + `ref` 流入経路 + UTM + 広告クリック ID（gclid/fbclid）を記録**できる。これがクロスアカウント名寄せ・広告返送の土台（source: Friends.md:247-269, Getting-Started.md:28-67）。LINE Login チャネル必須・PC 用 QR も LIFF URL（詳細は ADR-0013）。

**トラッキングリンク**
- **`/t` クリックは即 302 リダイレクトし、記録・タグ付与・シナリオ登録は `waitUntil` で非同期**（体感速度優先）（source: 10-Tracked-Links.md:13-35,78-102）。
- **ユーザー特定は UA 分岐**: LINE アプリ=LIFF で `lineUserId`→`friendId` 特定、PC ブラウザ=ログイン不要で直リダイレクト・`friend_id=NULL` の匿名クリック計数のみ（source: 10-Tracked-Links.md:13-35,104-109）。
- **配信本文中 URL を自動でトラッキングリンク化し、テキストはボタン付き Flex に変換して長 URL を隠す（v0.4.0）**（source: 10-Tracked-Links.md:33-35）。
- **ショートコードは 7 文字 base62（UNIQUE + 衝突リトライ）、旧 UUID URL は後方互換で有効維持（v0.18.0）**（source: 10-Tracked-Links.md:62,82-89,156-158）。
- **`/t` 用短縮ドメイン（`account_settings.tracked_link_base_url`, `__global__`）はアフィリ用 `link_base_url` と別設定**。アフィリ用は全パスを `/r/` に転送するため同居させると `/t` が壊れる → 設定分離、同居時は Cloudflare Redirect Rules で順序制御（source: 10-Tracked-Links.md:111-158）。
- **キャンペーン単位で intro/reward テンプレを分離**（`tracked_links.intro_template_id`/`reward_template_id`）。壊れた Flex/欠落時は安全側デフォルト Flex にフォールバック。**reward 解決優先度: `body.trackedLinkId` → first-touch(`friends.first_tracked_link_id`) → フォーム既定**（他キャンペーンに漏らさない。純粋関数 `reward-resolver.ts` に集約、v0.10.1 で漏れバグ是正）（source: 10-Tracked-Links.md:376-416）。

**広告 CV 返送（ad-conversion-spec）**
- **目的: click→友だち追加→MCV→広告媒体へオフライン CV 返送で ROAS 一気通貫**。対応 Meta(CAPI)/X/Google Ads/TikTok（source: ad-conversion-spec.md:3-16）。
- **流入時に click-id（fbclid/gclid/twclid/ttclid）+ UTM + UA + IP(`CF-Connecting-IP`) を保存**（IP/UA は Meta CAPI マッチング精度向上のため必須方針）（source: ad-conversion-spec.md:23-36,472-503）。
- **返送は全アクティブ媒体をループし、媒体固有の click-id が ref に存在する時だけ送信**（無ければ「広告経由でない」とスキップ）。**click-id 帰属は窓なしの最新 click-id 1 件（`ORDER BY created_at DESC LIMIT 1`）**。失敗は `ad_conversion_logs` に記録（source: ad-conversion-spec.md:103-117,184-234）。
- **PII（email/phone）は SHA256 ハッシュ必須、fbclid→fbc 変換、通貨 JPY 固定、`test_event_code` は開発時のみ**（source: ad-conversion-spec.md:244-288,636-657）。
- **event-bus への統合点は 1 箇所のみ**（`fireEvent` に `sendAdConversions` を追加、`friendId && conversionEventName` 揃った時のみ発火。既存処理は不変）（source: ad-conversion-spec.md:440-467）。

**アフィリエイト成果帰属（ASP）**
- **セルフサーブ設計**（アフィリエイター自身が LIFF `?page=affiliate` から登録・リンク発行・実績確認まで完結。認証は `lineAccessToken` をサーバー側で LINE OAuth 検証）（source: 27:27-46）。
- **帰属モデルは last-touch / 90 日窓**（友だち追加日時から遡って 90 日以内の最新タッチのリンク所有者に帰属。窓外・未解決タッチは対象外）（source: 27:84-96）。**← 広告返送の「窓なし最新 click-id」とは別ロジック（2 系統併存）**。
- **自己クリック除外**（`affiliates.friend_id == ref_tracking.friend_id` を除外）＝自己水増し防止（source: 27:98-104）。
- **CV 時スナップショット**（`conversion_events` に `affiliate_id`/`attributed_ref_code`/CV 時点 `value` を書き込み、後からレート変更しても過去レポート不変）（source: 27:106-116）。
- **重複検知**: `identity_key`（LINE UID/電話/メール複合キー）が同一の帰属友だちが 2 人以上なら `duplicateFlags`（水増しサイン）。ステータスフィルタ外で全帰属 CV 対象に計算（source: 27:142-155,324-336）。
- **成果承認フロー**: 帰属 CV は `pending` 起票 → 承認/却下の二択（pending 差し戻し不可）。非帰属 CV は承認フロー対象外。**確定報酬 = 承認済み件数 × 案件固定額**（Phase2）／Phase1 は率（source: 27:286-346）。
- **ソース解決優先度: entry_route > tracked_link > affiliate_offer**、リンク上限 20 本/人、ref_code は 6〜8 文字 base62（source: 27:56,245,267-282）。
- **CV 計測は 3 本柱**: conversion_points（定義）/ conversion_events（記録）/ affiliates（`code` UNIQUE, `commission_rate`）+ entry_routes/ref_tracking（流入計測）（source: 17:22-98）。
- **Stripe 連携**（詳細は ADR-0013）は `payment_intent.succeeded` で `cv_fire` を発火し帰属に接続（source: 17:320-362）。

## Alternatives

- **first-touch pin（v0.10.0）→ v0.10.1 で意図的に緩和**。`body.trackedLinkId` を信用するため URL 改ざんで別キャンペーン reward を取得し得るが、**真のアンチフラウドは上流のエンゲージメントゲートが担う前提**でリプレイ防止層（`reward_claimed_at` 等）を**意図的に未実装**（受容リスク）（source: 10-Tracked-Links.md:418-424）。
- 帰属の窓/last-touch vs first-touch: 実装は last-touch（90 日窓）だが、マニュアルの運用指南は first-touch を推奨（ADR-0015 参照）。設計と運用指南で立場が異なる点に留意。

## Consequences

- 帰属デバッグ用に友だちジャーニー可視化 `GET /api/friends/:id/journey`（touch/friend_add/form/conversion の時系列）を提供（source: 27:137-165）。
- **留保（要コード裏取り・重要）:**
  1. **`docs/ad-conversion-spec.md` は本家向けの *提案仕様書*（`ALTER TABLE`/新規ファイル前提）。Rasenca フォークのコードで実装済みか未確認** → [Q-005](../open-questions.md)。
  2. **友だち重複検出の方式が不一致**: README は「picture_url トークン照合」を謳うが、docs の重複検知は一貫して `identity_key`（UID/電話/メール複合）ベース。どちらが実装か → [Q-006](../open-questions.md)。
  3. **帰属ロジックが 2 系統併存**（アフィリ=90 日窓 last-touch / 広告返送=窓なし最新 click-id）。意図的な別物か、統一漏れか要確認。
  4. v0.10.1 の first-touch pin 緩和が前提とする「上流エンゲージメントゲート」が Rasenca 運用で成立するか要検討。

## Update (2026-07-23) — Q-005 / Q-006 のコード裏取り（留保 1・2 を解消）

P7（転記 ADR とコードの突合）で `apps/worker` を grep 確認。留保 1・2 を解消する。

**留保 1（Q-005）解消: 広告 CV 返送は「提案仕様」ではなく実装済み＝現行の正。**
- `sendAdConversions` が実在（`apps/worker/src/services/ad-conversion.ts:16`）。Meta CAPI = `https://graph.facebook.com/v21.0/${pixel_id}/events`（同:89）、Google Ads = `https://googleads.googleapis.com/v17/customers/${customer_id}:uploadClickConversions`（同:167）を実送信。
- テーブル `ad_platforms` / `ad_conversion_logs` は本番スキーマに存在（`packages/db/schema.sql:665,678`、`packages/db/migrations/010_ad_conversions.sql`）＝ `ad-conversion-spec.md` の `ALTER TABLE`/新規前提は既に取り込み済み。
- event-bus 統合も実装（`apps/worker/src/services/event-bus.ts:58` で `fireEvent` → `sendAdConversions`）。テスト送信 API も存在（`apps/worker/src/routes/ad-platforms.ts:145`）。
- → 本 ADR「広告 CV 返送」節は Rasenca フォークで**実装済み（現行の正）**。source を `ad-conversion-spec.md`（提案）から上記コードへ格上げして読むこと。

**留保 2（Q-006）解消: 「picture_url トークン」と「identity_key」は矛盾せず、同じ picture_url トークンが土台。ただし本 ADR の identity_key 説明が不正確。**
- 現行の `identity_key` は **`COALESCE(URL_TOKEN_SQL, 'uid:'||friends.user_id, 'solo:'||friends.id)`**（`apps/worker/src/lib/identity-key.ts:10-15`）。primary の `URL_TOKEN_SQL` は **`picture_url` の SUBSTR で抽出したトークン**（`apps/worker/src/lib/url-token.ts`）。→ **本 ADR 41 行目・留保 2 の「identity_key = LINE UID/電話/メール複合キー」は誤り**。実体は「picture_url 由来トークン > user_id > friend_id」の COALESCE で、電話/メールは含まない（email→phone 名寄せは別機構＝`users` テーブル / ADR-0008・0010）。
- 2 つの重複機構は目的別に併存: (a) `apps/worker/src/services/duplicate-detect.ts` = クロスアカウント友だち重複を picture_url トークンで自動タグ付け。**ただし cron 実行は無効化済み**（`apps/worker/src/index.ts:953-960`、`account_settings.duplicate_tag_mapping` 空でも無効）。(b) `identity_key`（上記 COALESCE）= アフィリ成果の水増し検知（`packages/db/src/affiliate-report.ts:283-311`）と event_booking の重複判定に使用。
- → README の「picture_url トークン照合」も docs の「identity_key」も**どちらも実在**し、後者の primary が前者。留保 2 は「二者択一」ではなく「同一トークンの別用途 2 系統」で決着。

**留保 3（帰属 2 系統併存）: 確認済み・意図的。** アフィリ=90 日窓 last-touch（`affiliate-report.ts`）と 広告返送=窓なし最新 click-id（`ad-conversion.ts`）は別ロジックとして両方実装されており、統一漏れではなく仕様。

→ [Q-005](../open-questions.md) / [Q-006](../open-questions.md) は ANSWERED。関連: ADR-0008（identity_key の土台 = データモデル）、ADR-0010（マルチアカウント名寄せ）。
