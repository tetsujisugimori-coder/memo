# P3-04：独立contextの有限診断

## 対象と事前計画

Issue #389／Draft PR #390。開始基準は `34f9d01bb8c591b80d6e2a640c2d6ae9c3f86b37`。本番採用HOLD、T7根本原因UNKNOWN、PR #388のP2未解決を維持する。本番コード・実メモ・実認証・外部配送は扱わない。

各エンジンにつき1実行。primary、従来の対照A、従来の対照B、回帰注入、追加6条件の順で、計10個の独立browser contextを順次生成する。同じbrowserインスタンスを使い、process分離は実施しない。各contextは別の架空DBを生成する。primaryと従来対照の意味・T1〜T12の判定は変えない。cleanupのUNKNOWNを後続条件の結果で置換しない。

追加条件の順序は A-detailed → B-detailed → C-detailed → A-minimal → B-minimal → C-minimal。各1回、成功後・失敗後とも追加再試行しない。Linux WebKitを主対象、Chromiumは同じ6条件各1回の比較とする。Windowsでの開発確認各1回はLinux実測とは別証拠である。

| 条件 | 停止要求前に必要な観測 | 明示close | その後の操作 |
|---|---|---|---|
| A | readonly request成功、2行、transaction complete | complete後に呼出し | terminate呼出し→version 1→2 upgrade |
| B | readonly request成功、2行。completeは未観測 | なし | requestコールバック内のテストゲートで保持→terminate→upgrade |
| C | readonly request成功、2行、transaction complete | なし | terminate→upgrade |

BのゲートはWorker内の同期ループで、request成功コールバックを返さず保持する。主スレッドは境界message受信後にterminateする。この人工条件によりcomplete前の停止を制御できるが、通常の未解決Promise待機とは実行負荷・イベント境界が異なる。Bの成功を既存T7の再現・原因反証とは扱わない。ゲートを本番へ移植しない。A/Cのcompleteを観測できない場合は成立したと判定しない。

## 計測方式と判定

架空fixtureは2ストア（notes／metadata）、メモ2件の固定内容。version 1を作り、WorkerはnotesをreadonlyでgetAllする。fixture準備だけreadwriteを使用する。詳細／最小で操作、データ、version、停止境界、期限、期待行数は同一。

詳細計測はWorker内イベントごとにmessageを送る。最小計測は同じローカルイベント配列を保持し、条件成立に必要な事実と配列を境界message1件で返す。完全な無計測ではなく、message回数を減らした対照である。順序固定・各1回のため、差があっても計測の因果効果や成功率は推定できない。

条件成立、upgrade、cleanupを別フィールドに保存する。条件不成立はCONDITION_NOT_MET、upgrade timeoutはUNKNOWN、upgrade errorはFAIL。条件成立＋upgrade成功でもcleanup非成功はHOLDであり、全て成功したときのみ条件内PASS。primary T7の期限失敗は従来どおりFAILで、追加条件の成功で相殺しない。未到達条件はNOT_RUN。

## 有限上限と後始末

- open／条件同期：8秒。削除：独立2秒（既存cleanup.jsを再利用）。延長なし。
- primary contextの処理上限180秒、他のcontextは各30秒。context生成8秒、部分snapshot0.5秒、close待機2秒。
- runnerの実行予算480秒。残予算をcontextの処理待機へ適用し、予算切れ以降はNOT_RUN。生成・close等の有限後処理を含めると480秒を超え得る。browser起動30秒、終了2秒、fixture server終了2秒も独立上限を持つ。CI全体は従来の10分上限。
- context生成は最大10回、browser生成は1回。生成・処理・終了要求・戻りを記録。close timeoutをUNKNOWNのまま保持して次の独立contextへ進む。無制限の追加Worker・context・再試行は行わない。
- context終了要求が戻ってもWorkerや接続やOS資源の実解放完了はUNKNOWN。contextを新しくしても、同じbrowser process内部の共有状態まで独立とは保証しない。未完了の削除DBを削除済みとは報告しない。

## 証拠と時計

`results-<engine>-isolated-<run>-<attempt>-<UUID>.json` を `flag: wx` で新規保存する。上書きしない。実checkout、Git tree、実行ソース11件のSHA-256、環境、計画、各contextの開始／終了／pageerror、primary・対照・追加条件・削除結果を含む。予定条件は初期状態NOT_RUNとし、例外時も出力する。context外側のtimeoutでは可能な範囲で部分診断も保存する。

contextEventsのnodeMsはrunner内の観測時計。mainMsは各context、workerMsは各Worker内の別時計である。collectionSeqは収集順であり異なる時計の内部順序を証明しない。最小計測のWorkerローカルイベントは境界時にまとめて受信した履歴であり、各イベントのmain受信時刻は取得していない。未観測を不発生と断定しない。

旧同一context経路は `WORKER_POC_CONTEXT_MODE=shared` で残す。過去の成功／失敗JSONと索引は無変更。旧34f9d01の同一context Linux結果は[CI #40866596832](https://github.com/tetsujisugimori-coder/memo/actions/runs/40866596832)に対応し、今回の独立contextの証拠とは別版として扱う。

## 開発確認と最終CI

Windowsの開発確認（実行時HEADは34f9d01＋未コミットソース、ソースhashをJSONに記録）では、両エンジン各1回の6条件すべてが成立しupgrade／削除successを観測した。primaryはT7 PARTIAL、T9／T11 PARTIAL、T12 HOLDを維持し、T6・13 stageプローブ・T6実注入も通過した。これはLinuxの成功証拠ではない。

- Chromium：`results-chromium-isolated-local-1-db098ce9-c85e-46e5-b5bf-649b0f4860b5.json`
- WebKit：`results-webkit-isolated-local-1-0dd1c01e-ae61-43c7-b7ca-7905423c0eb1.json`
- 単体21件（既存削除7・証拠6、新規条件／context8）が成功。未成立・timeout・削除UNKNOWNの非PASS判定、先行cleanup UNKNOWN、処理timeout、context close UNKNOWNからの独立継続を検査した。

最終コミットのLinux結果はDraft PR #390／Issue #389へrun・job・artifact・実checkout・tree・hash照合とともに追記する。中間版・Windowsの成功を最終HEADの成功へ流用しない。結果の全体判定はprimary失敗も保持するため、独立診断が全条件成功してもPoC CIが失敗することがある。

## 次の判断

今回で確定できるのは指定した境界の成立可否と有限なupgrade／cleanup観測まで。transaction残存、接続、内部ロック、計測影響は原因候補であり、直接証拠なしに確定・除外しない。次の候補は今回の失敗位置に合わせたprocess分離／messageをさらに減らした非計測対照の事前計画1件。別process条件は今回追加していない。iPhone Safari実機、実OS背景制限、実サービス、実認可、本番資源上限は未検証。

2026-10-29 日本時間
