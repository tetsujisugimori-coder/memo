# Chart WebKit 第4工程：有限実験計画

状態：準備中。A・B とも NOT_TESTED。第3工程 PR #452 の固定 HEAD `ef2d6d00bad0fab5363254b4fe1274536067820f`、tree `7fa1588e630c427c6813056d5bfaaea4bd2800e0` を基点とする。Issue #453。元 Chart 不具合や PR #448 の因果は UNKNOWN。

## 開始条件と予算

- 診断コードの明示的な実装指示、実行環境、CI 予算、原票の安全な保存場所と公開範囲を確認する。非公開永続保管先は現時点で UNKNOWN。秘密を含む原票を公開しない。必要な安全な保管場所を確保できなければ BLOCKED。
- 合成 WebKit と専用 controller のみ。A 最大1回、B 最大1回、合計最大2回。自動再試行なし。各試行は起動から終了確認まで外側上限20秒、CI job 最大15分、原票100 MiBを停止基準とする。実施前にサイズ監視、停止と原票保全の手段を確認する。
- 対象外：全 Chart suite、製品処理や既存 assertion の変更、保存契約変更、本番 Worker、PR #450/#452 のマージ。

## 共通準備と観測

固定 HEAD と実験コードの commit/tree、Ubuntu・Node・Playwright・WebKit、空き容量、command、開始終了 UTC、実行予算、出力先を記録。第3工程同等 fixture と独立 child を使い、140 の後 Infinity を入力し、親が入力値を確認してから次へ進む。

controller と child 各自でイベント ID・process ID・その process 内の単調増加時刻・UTC・発生元を記録。異なる process の単調時計を直接比較しない。IPC メッセージ ID と送受信、同一 process の順序、signal 送信結果と exit 観測を因果の根拠とする。取得できない内部イベントは UNKNOWN。

対象は signal 送信要求・結果・受信、finish 開始、flush 開始、evaluate 開始・結果、page/context close、browser close 要求・native 呼出し・disconnected、ledger write callback、flush 終了、process exit、親による child exit 確認。イベント喪失と発生した失敗を区別する。書込み callback は fsync や永続化の保証ではない。

## 群と停止

- A：既存 SIGTERM 終了手順を変更せず最小限の観測記録を追加。Infinity 入力完了の親確認後に SIGTERM を1回送信。失敗でも原票を保全し再試行しない。
- B：独立 process・出力先を使用。親の Infinity 確認後に識別子付き preflush IPC を送り、子で snapshot、ledger write と callback を確認し、結果を親が受信・記録した後に SIGTERM を1回送る。失敗・timeout を成功としない。preflush 失敗・timeout 時は SIGTERM 比較を成立したものと扱わず、安全な有界 cleanup と失敗記録に移る。B の介入は通常終了の再現ではない。
- 外側上限、原票上限、保存領域不足、対象 process の識別不能、想定外の危険状態で停止し、その時点の証拠を保全する。識別済み child と子孫だけに作用し、子孫は PID と開始時刻を直前照合。未知・再親化前未捕捉の子孫は UNKNOWN。共有 tmp や他案件成果物は移動・削除しない。

## 判定と証拠

各群について Infinity 確認、flush 時の page 利用可能性、保存、callback、close と flush の順序、exit、識別済み子孫、最終 seq、未送信末尾と観測影響を PASS/PARTIAL/FAIL/UNKNOWN/NOT_TESTED で記録。欠測を0件としない。page closed error のみから終了主体を推定しない。群の終了順序が異なるので成功率を比較せず、B の回収を元の SIGTERM 競合の修正としない。

stdout/stderr、controller/child 原イベント、exit/signal、close、flush、ledger、欠落評価を元のまま保存。各原票と manifest の対応・SHA-256 を記録し、公開前に secrets・token・個人 profile 絶対パスを検査する。CI artifact は期限付き、非公開永続保存は確認できた場合のみ成立と記す。観測器によるタイミング変化は残存リスク。

別観点で A の手順維持、B の IPC 順序、時計、終了主体、callback と永続化、未送信末尾、合成と元不具合の区別、予算・原票保全、秘密情報、報告と Actions 原ログを照合する。追加試行には別の有限計画と独立した判断が必要。
