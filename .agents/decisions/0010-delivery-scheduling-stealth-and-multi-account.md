# ADR-0010: メッセージ配信・スケジューリング・ステルス/BAN対策・マルチアカウント（本家由来の設計意図を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0007, ADR-0011
- source: docs/wiki/Broadcasts.md, docs/wiki/Scenarios.md, docs/wiki/12-Reminders.md, docs/wiki/18-Multi-Account-and-BAN.md, docs/wiki/Architecture.md, docs/wiki/22-Operations.md, README.md
- scope: 配信系（ブロードキャスト/シナリオ/リマインダー）と BAN 対策・マルチアカウント

> **この ADR について:** 本家由来ドキュメントの設計意図を記録（ADR-0007 冒頭注記と同じ方針・出典 docs・未検証は留保）。

## Context

配信は LINE の規約・スパム検知・BAN リスクと隣り合わせのため、タイミング制御と「自然な送信パターン」の作り込みが設計の中心にある。配信系 3 機能と、それを支える BAN 対策・マルチアカウント設計を集約する。

## Decision（記録する設計意図）

**スケジューリング**
- **全配信は Workers Cron 5 分間隔に統一**（`processScheduledBroadcasts`/`processStepDeliveries`/`processReminderDeliveries`）。結果として予約時刻から最大 5 分の遅延を許容。cadence `*/5 * * * *` は既定で、変えると `next_delivery_at` 精度が落ちる（source: Broadcasts.md:379-386, Scenarios.md:73-94, 12-Reminders.md:116-127, Configuration.md:167-178）。
- **例外: `delay_minutes=0` の初回ステップだけ Cron を待たず即時 push**。友だち追加直後の無反応時間を避けるため（source: Scenarios.md:60-71）。
- **時間ゲートを全廃し、配信タイミングは運用側ハンドルに寄せた（v0.13.2）**。`delay_minutes` と `scheduled_at` で完全制御（source: README.md:102）。

**ブロードキャスト**
- **対象タイプで LINE API と件数把握を使い分け**: `all`=LINE `broadcast` API（最速・最シンプルだが正確な送信数取得不可で `total_count=0`）、`tag`=`multicast` を 500 件バッチ（`MULTICAST_BATCH_SIZE=500`, LINE 上限準拠）（source: Broadcasts.md:76-111）。
- **部分失敗許容 + 再試行**: multicast バッチ失敗はスキップして次バッチ継続、全体失敗は `draft` にリセットして再試行可、`is_following=0` はタグ配信時に自動除外（source: Broadcasts.md:70-72,453-461）。
- **配信中/完了の不変性**: `sending`/`sent` は編集・削除不可（400）、`draft`/`scheduled` のみ変更可（二重送信・改ざん防止）（source: Broadcasts.md:63-72,307-323）。

**シナリオ / リマインダー**
- **シナリオは「登録時点からの経過時間」、リマインダーは「ターゲット日時からのオフセット（`offset_minutes`）」という別モデル**として実装。リマインダー判定式 `target_date + offset_minutes <= now`（source: 12-Reminders.md:5-9,82-87）。
- **リマインダー各ステップのべき等性を DB 制約で担保**（`UNIQUE(friend_reminder_id, reminder_step_id)`）（source: 12-Reminders.md:60-67）。
- **シナリオ条件分岐のフォールスルー規則**: 不一致時 `next_step_on_false` があればそこへ、null なら次順、無ければ完了（source: Scenarios.md:108-113）。

**ステルス配信（BAN 回避ポリシー）**
- LINE 規約内に留まるための意図的な 5 対策: (1) ステップ配信 `next_delivery_at` に **±5 分ジッター** + 友だち間ランダム遅延、(2) ブロードキャストを **500 件バッチ + バッチ間スタッガー遅延**（~100 件=100〜600ms、~1,000 件=約2分分散+2sジッター、1,000 件超=約5分+5sジッター）、(3) テキストのみ配信で **ゼロ幅文字（U+200B/200C/200D/FEFF）** を挿入し各バッチを微差化、(4) **自主レート制限 1,000 通/分**（LINE 上限 100,000/分に対する安全マージン, `StealthRateLimiter`）、(5) **1 デプロイ=1 アカウント**分離（source: Architecture.md:343-352, 18-Multi-Account-and-BAN.md:304-357, Broadcasts.md:99-132, Scenarios.md:128-149）。

**マルチアカウント / BAN 検知**
- **BAN 検知は 5 分 Cron で `/v2/bot/info` を叩き HTTP ステータスでリスク判定**（200=normal / 403=danger / 429=warning / 直近1h 5000通超=warning / エラー=error）。`account_health_logs` に保存、danger はコンソールエラー出力（source: 18-Multi-Account-and-BAN.md:176-238）。
- **アカウント移行は「受動的 UUID 再マッチ」設計**。BAN 検出時 `account_migrations` に起票するが、実際の移行はユーザーが新アカウントを友だち追加した時に `users.id` で自動マッチされる方式（能動的な送信元ローテではない）（source: 18-Multi-Account-and-BAN.md:242-300）。
- **認証情報の露出制御**: 追加アカウントは DB 格納・動的読込、メインのみ env（`wrangler secret`）。一覧 API は secret 省略・詳細 API のみ含む（source: 18-Multi-Account-and-BAN.md:47,71-78,373-381）。

## Alternatives

- Cron 間隔の変更 → `next_delivery_at` 精度低下のため 5 分固定を推奨（Configuration.md:167-178）。

## Consequences

- ステルス/BAN 対策はキャンペーン運用思想（ADR-0015）と表裏（配信速度 vs 安全のトレードオフを数値で規定）。
- **留保（要コード裏取り・重要）:**
  - `README.md` は「BAN 検知 & **自動アカウント切替**」「トラフィックプールで自動振り分け」を謳い、MCP に `manage_traffic_pools` があるが、**doc（18章）に記述される移行は「受動 UUID 再マッチ」のみで、能動的なプールローテの設計は docs に見当たらない** → 実装の有無・方式をコード確認（→ [Q-007](../open-questions.md)）。
  - danger 検出時の**自動アクション（自動移行/通知）**は doc 上ベストプラクティス止まりで自動実行の有無が不明（同 Q-007）。
  - リマインダー `offset_minutes` の符号（負=前 か）に doc 内齟齬（マイグレコメント vs 本文）→ コード確認（[Q-008](../open-questions.md)）。
