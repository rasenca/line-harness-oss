# ADR-0013: 外部連携サーフェス — LINE Login/Webhook・送受信Webhook・通知・Stripe・フォーム(LIFF)・リッチメニュー（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0007, ADR-0009, ADR-0012
- source: docs/wiki/Getting-Started.md, docs/wiki/15-Webhooks-and-Notifications.md, docs/wiki/11-Forms-and-LIFF.md, docs/wiki/09-Rich-Menus.md, docs/wiki/17-CV-Tracking-and-Affiliates.md, docs/wiki/Architecture.md, docs/wiki/Configuration.md
- scope: LINE Platform・外部サービスとの入出力サーフェス

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針）。

## Context

LINE Platform・外部サービス（Stripe 等）・LIFF UI という「外部と接する境界」の設計判断を集約する。各境界は独自の信頼機構を持つ（ADR-0009 の公開エンドポイント一覧と対応）。

## Decision（記録する設計意図）

**LINE Login / Webhook**
- **LINE Login チャネルを必須にする（Messaging API だけでなく）**。友だち追加を `/auth/line?ref=xxx` に通すことが UUID 自動取得・流入/ref トラッキング・広告 click-id 捕捉・クロスアカウント名寄せを可能にする「プロダクトの核」（source: Getting-Started.md:28-67,163-164）。
- **PC 経由友だち追加には LINE Login Callback URL（`{worker}/auth/callback`）登録が必須**。未登録だと PC 追加が "Invalid redirect_uri" で無言失敗（モバイル/LIFF は内部認証で callback を通らないため誤設定が見えにくい）（source: Getting-Started.md:45-58,322-323）。
- **LINE コンソールの「応答メッセージ」「あいさつメッセージ」は OFF がポリシー**（応答は auto_replies、あいさつは scenarios でハーネスが制御するため）（source: Getting-Started.md:203-204）。
- **Webhook は署名検証（HMAC-SHA256, `X-Line-Signature`）で認証し、無効署名でも常に 200 を返す**（LINE Platform 要件）（source: 15-Webhooks-and-Notifications.md:20-28）。
- **`follow` は登録/更新+プロフィール取得+friend_add シナリオ登録+delay=0 即時配信+イベント発火、`unfollow` は `is_following=false` の論理削除**（source: 15-Webhooks-and-Notifications.md:30-40）。

**送受信 Webhook・通知**
- **送信 Webhook は購読イベントを JSON 配列で宣言（`["*"]` で全件）、`secret` 設定時は HMAC-SHA256 を `X-Webhook-Signature` に付与**。ペイロードは `{event, timestamp, data}` 統一（source: 15-Webhooks-and-Notifications.md:202-245）。
- **受信 Webhook は公開エンドポイント（認証不要）**。Webhook ID で検索し非アクティブは 404、受信後 `incoming_webhook.{source_type}` イベントを発火して自動化/スコアリング/通知に連動（source: 15-Webhooks-and-Notifications.md:70-82）。
- **通知チャネルは dashboard/webhook を先行実装、email は将来対応**と段階化（`notifications.status`=pending/sent/failed）（source: 15-Webhooks-and-Notifications.md:350-373）。

**Stripe 連携**
- **`stripe_events.stripe_event_id` UNIQUE で冪等性担保**。`STRIPE_WEBHOOK_SECRET` 設定時は `Stripe-Signature` を HMAC-SHA256 検証、**未設定時はバイパス（開発向けの明示的トレードオフ）**。友だち紐付けは `metadata.line_friend_id`。`payment_intent.succeeded` でスコア加算+`purchased_{productId}` タグ+`cv_fire` 発火、`customer.subscription.deleted` で `subscription_cancelled` タグ（source: 17:320-362）。

**フォーム (LIFF)**
- **送信の副作用（メタデータ保存・タグ付与・シナリオ登録）は best-effort。失敗しても送信自体は成功扱い**（回答の取りこぼし=CV 計上漏れを副作用の完全性より優先）（source: 11-Forms-and-LIFF.md:129-133）。
- **`POST /api/forms/:id/submit` は認証不要の公開エンドポイント**（LIFF から直叩き）。友だち特定は body の `lineUserId` or `friendId`、匿名回答は `friend_id=NULL` で許容（source: 11-Forms-and-LIFF.md:32-38,117-133）。

**リッチメニュー**
- **D1 に持たず LINE Platform を正とするプロキシ設計**（`richmenu-*` エンドポイントのラッパーに徹し、ローカルにキャッシュしない）（source: 09-Rich-Menus.md:5,15,19）。
- **適用優先順位はユーザー別 > デフォルト > 非表示**。`tag_change` に `switch_rich_menu` を結線しタグ起点の自動切替（source: 09-Rich-Menus.md:88-112）。
- **サイズは LINE Platform 制約でフル(2500x1686)/ハーフ(2500x843)の 2 種のみ、画像 1MB 以下**（source: 09-Rich-Menus.md:34-40,114-143）。

## Alternatives

- 通知の email チャネル → 将来実装として保留（dashboard/webhook 先行。15-Webhooks-and-Notifications.md:367-373）。
- リッチメニューのローカル DB 保持 → 採らず（LINE Platform を単一の真実とするプロキシ設計。09-Rich-Menus.md:5）。

## Consequences

- 各公開エンドポイントの信頼機構は ADR-0009 の allowlist と一致させる。フォーム/クリックの副作用は best-effort（体感速度・CV 計上優先）。
- **留保（要コード裏取り）:** 受信 Webhook の `secret` カラムでの署名検証が実処理で行われているか（スキーマ上は存在）、無認証フォーム送信のスパム/改ざん対策の有無は doc に記述なし → 要コード確認。Stripe 署名未設定バイパスは本番で無効化されるべき（要確認）。
