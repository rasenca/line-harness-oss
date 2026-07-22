# ADR-0011: CRM — 友だち・タグ・スコアリング・IF-THEN自動化・チャット/自動応答（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0007, ADR-0008, ADR-0010
- source: docs/wiki/Friends.md, docs/wiki/Tags.md, docs/wiki/13-Scoring.md, docs/wiki/14-Automation.md, docs/wiki/16-Chat-and-AutoReply.md
- scope: CRM ドメイン（友だち/タグ/スコア/自動化/チャット）

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針）。

## Context

CRM 系は「イベントバス（ADR-0007 の `fireEvent`）を起点に副作用を集約する」設計で一貫している。L社（LINE マーケティングツール大手）相当機能の汎用化として設計されている。

## Decision（記録する設計意図）

**友だち**
- **`follow` で自動 upsert 登録、`unfollow` は物理削除せず `is_following=0`（論理削除）**。友だち追加時に `friend_add` シナリオ自動登録とイベントバス発火も連動。再フォロー時のデータ保持が狙い（source: Friends.md:47-61, 15-Webhooks-and-Notifications.md:30-40）。

**タグ**
- **友だちセグメンテーションの基本単位。`friend_tags` は `(friend_id, tag_id)` 複合 PK の多対多、付与は `INSERT OR IGNORE` で冪等**（source: Tags.md:5,18-26）。
- **タグ付与/削除は `tag_change` イベントを起点に副作用を集約**（スコアリング/IF-THEN/通知/送信 Webhook を一括駆動、`tag_added` シナリオ自動登録も）（source: Tags.md:219-227）。
- **自動タグ付与元は 4 経路に限定**（フォーム `onSubmitTagId` / tracked link `tagId` / IF-THEN `add_tag` / スコア閾値）（source: Tags.md:303-312）。

**スコアリング**
- **イベント駆動で自動加減算、`friends.score` は履歴 `friend_scores` の合計キャッシュ列**（負数可）。`processScoring()` がイベントバスから `event_type` 一致ルールを引き履歴 INSERT + キャッシュ更新（source: 13-Scoring.md:9-21,55-62,111-123）。
- **`event_type` はイベントバスの発火種別と一対一対応させる契約**（friend_add/message_received/url_click/form_submit/tag_change/cv_fire/purchase/calendar_booked/score_threshold/incoming_webhook.* 等）。推奨スコア値はガイドライン（強制でない）（source: 13-Scoring.md:64-82）。

**IF-THEN 自動化**
- **L社の「アクション管理/条件分岐」をイベント駆動の汎用ルールエンジンとして再設計**。7 種イベント × 8 種アクション（add_tag/remove_tag/start_scenario/send_message/send_webhook/switch_rich_menu/remove_rich_menu/set_metadata）（source: 14-Automation.md:1-8,62-86）。
- **実行順は `priority` 降順、条件は現状 AND 結合、空条件 `{}` は当該イベント全件マッチ**（将来 OR 対応の含み）（source: 14-Automation.md:91-136）。
- **チェーニング（アクションが新イベントを発火し別ルールを連鎖起動）を許容。無限ループ防止はコードガードでなく運用ルール**（循環参照する条件を作らない）（source: 14-Automation.md:387-396）。
- **実行結果は三値（success/partial/failed）でログ化**し部分成功を明示（`automation_logs.actions_result` JSON）（source: 14-Automation.md:138-158）。

**チャット / 自動応答**
- **自動応答は `replyMessage`（無料・通数非カウント、replyToken 約1分・単回）、オペレーター手動送信は `pushMessage`（課金）に固定**。LINE 課金通数を抑える意図（source: 16-Chat-and-AutoReply.md:127-144）。
- **自動応答は `created_at ASC` で評価し最初のマッチで返信・以降評価しない（先勝ち）**。送信も `messages_log` に `outgoing` 記録（source: 16-Chat-and-AutoReply.md:162-168）。
- **チャットは受信時に自動再オープン**（`resolved` は `unread` に戻す、無ければ `unread` 新規、マッチしない受信はオペレーター対応のため `unread`）。履歴取得は最大 200 件・`created_at ASC`（source: 16-Chat-and-AutoReply.md:116-125,416-427）。

## Alternatives

- 自動化条件の OR 結合 → 現状 AND のみ（将来対応の含み。14-Automation.md:91-124）。
- ループ検出のコードガード → 採らず運用ルールに委譲（14-Automation.md:387-396）。

## Consequences

- CRM の副作用は全て `fireEvent`（ADR-0007）に集約されるため、新規イベント/アクション追加はこのバス契約に沿う。
- **留保（要コード裏取り）:** 自動化アクション種別数に doc 内齟齬（概要「6 種」vs 表「8 種」）→ [Q-008](../open-questions.md)。無限ループ検出のコード実装有無は要確認。
