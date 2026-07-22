# ADR-0015: キャンペーン設計・運用思想（測れない配信は打たない）（本家由来の運用思想を記録）

- status: ACCEPTED
- date: 2026-07-22
- relates: ADR-0010, ADR-0011, ADR-0012, ADR-0014
- source: docs/manual/04-campaign-design.md, docs/manual/05-operations.md, docs/manual/06-mcp-claude-code.md, docs/manual/07-troubleshooting.md
- scope: 運用者向けの設計・運用の型（機能ではなく「使い方の思想」）

> **この ADR について:** これは機能設計ではなく、本家マニュアルが説く**運用思想・キャンペーン設計の型**の記録。有料章由来の GTM 価格情報は対象外（shudesu-only-reference）。運用思想は Rasenca が本プロダクトを運用する上で踏襲する。

## Context

マニュアル 4〜6 章は「機能をどう組めば獲得につながるか（How/Why）」を説く。ここには**計測・帰属・タグ設計・配信タイミングに関する運用上の決めごと**が凝縮されており、機能 ADR（0010〜0012）を運用に翻訳する層として記録価値が高い。

## Decision（記録する運用思想・型）

- **最上位原則「測れない配信は打たない」**。破綻原因は「計測点を決めずに配信する」こと。設計→計測→改善の閉ループを**設計上の前提**として組み込む（source: 04-campaign-design.md:27-35,429）。
- **3 派生ルール**: (1) LP/カレンダー/フォーム/決済/外部 SNS まで直リンク禁止、必ず `create_tracked_link` を通す、(2) **1 キャンペーン = 1 ref_code = 1 tracked_link = 1 シナリオ = 1 タグ**、(3) CV は最初に 1 つ決めて運用中に変えない（source: 04-campaign-design.md:39-43,276-278,334-345）。
- **URL 自動ラップは「設計の代替でなく保険」**（自動ラップは name が機械生成・tag/scenario が NULL。設計したいなら手動発行）（source: 04-campaign-design.md:45,102）。
- **トラッキングリンクは毎キャンペーン専用発行・流用禁止・古いリンクは無効化しない**。命名は「日付-流入元-施策」で grep 可能に。古いリンクを `is_active=false`/404 にすると SNS/QR/過去メッセージの流通先で事故る（**消さずに残す**思想）（source: 04-campaign-design.md:65,90,99）。
- **A/B テストは「リンクを分けるだけ」**（別 tracked_link + 別 tag、追加コード不要で clicks/CVR 差が出る）（source: 04-campaign-design.md:104-106,376-401）。
- **運用指南としての帰属は first-touch を推奨**（友だち追加〜購入は数週間・複数リンクを踏むため、last-touch だと初回流入価値がゼロ評価になる。`friends.first_tracked_link_id` に初回を焼き上書きしない）。**※実装の既定帰属は last-touch/90 日窓（ADR-0012）で立場が異なる点に留意**（source: 04-campaign-design.md:131-156）。
- **CV の metadata に first-touch の trackedLinkId を毎回焼き込み「CV 1 件で自己完結」させる**（CV テーブル単体でキャンペーン復元でき、毎回 JOIN 不要）（source: 04-campaign-design.md:363-374）。
- **タグ命名規則を排他/包含で最初に固定**（`src:`=流入元・排他/first-touch、`int:`=興味・包含、`stage:`=ステージ・排他/最新1つ、`status:`=ライフサイクル・排他）。排他タグは新値付与時に旧値を剥がすオートメーションを必ず 1 本書く（source: 04-campaign-design.md:224-235）。
- **「出し分ける軸はタグ、差し込み/分析の属性はメタデータ」**。月商など範囲検索が要る数値はメタデータ + 閾値超えでタグ自動付与の二段構え（source: 04-campaign-design.md:237-246）。
- **セグメントは保存せず配信時にその場で組む**（保存すると定義が腐る。時間フィルタ未対応なら期間専用タグを cron で付与/剥がす）（source: 04-campaign-design.md:248-268）。
- **`friend_add` トリガーは 1 アカウント 1 本（汎用ウェルカムのみ）**。キャンペーン別出し分けはタグ付与→`tag_added` シナリオの二段構え（source: 04-campaign-design.md:280-288）。
- **ステップ配信の delay は疎密で組む**（毎日連投はブロックされる。「1→1→2→3→5 日」等）（source: 04-campaign-design.md:318-328）。
- **Harness は「配信ツール」でなく「測定基盤」**。マネージド集計に頼らず週次/月次で自分で D1 に SQL を書く（source: 04-campaign-design.md:403-411）。
- **キャンペーンは開始前に「紙 1 枚で書ききる」**（リンク本数/ref 受け渡し/診断項目とタグ・メタデータ/トリガーと delay/CV とレポートの 5 判断を確定。書ききれないものは走らせない）（source: 04-campaign-design.md:421-429）。
- **運用ガバナンス（05/06 章の宣言）**: 送信は必ず事前確認、`.env.production` に触らない、週次 A/B・BAN 対策・権限確認・配信前後チェック・ロールバックを型として持つ。AI 委譲は「生成→人間レビュー→送信」に限定（source: 05-operations.md:12-36, 06-mcp-claude-code.md:8-31）。

## Alternatives

- last-touch 帰属（実装既定）→ 運用指南では first-touch を推奨。設計と運用で立場が異なる（ADR-0012 参照）。
- マネージド集計画面への依存 → 「数字が再現できない事故」を理由に自前 SQL を推奨（04-campaign-design.md:403-411）。

## Consequences

- この運用思想は機能 ADR（0010〜0012）を「どう使うか」に翻訳したもの。Rasenca が本プロダクトを運用する際の型として踏襲する。
- **留保:** 05/06 章は placeholder（章目的の宣言のみで本文未執筆）。有料章の価格・対象読者は本家 GTM（shudesu-only-reference）。
