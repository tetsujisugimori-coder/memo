# IndexedDB upgrade停止：独立原因切り分け計画

基準：#393 `f2168f194b326b0ce9ffb722e81aa47e42ce0d03`。#395は関連研究であり依存コードを取り込まない。原版suite/worker/cleanup、前工程の証拠、既存worktreeは維持する。

H1 未終了接続、H2 Worker/transaction終了の不完全性、H3 確認可能な終了条件以降のIDB内部/通知停滞、H4 その他/複合/観測不足を比較する。H3はWebKitバグ確定を意味しない。

成功条件：公開APIと有限比較で原因を絞る、または区別不能な範囲を証拠で示す。全結果を独立レビューへ提出し、本番Worker HOLD・マージ推奨NOを維持する。

## 静的接続対応表（実行前）

|接続/所有者|生成|保持/最後の利用|close呼出し|transaction終端|閉鎖/物理解放|
|---|---|---|---|---|---|
|main fixture|suite.open(version1,true)|局所db、notes/metadata初期put|fixture tx complete後|complete/abort/errorをawait|UNKNOWN|
|main snapshot|suite.snapshot→open(version省略)|局所db、各store getAll|全request成功後finally|listenerあり、完了awaitなし|UNKNOWN|
|main upgrade|suite.upgrade→open(++version)|局所db、schema変更なし|open success後即close|upgrade tx completeは原版未計測|UNKNOWN|
|main late open|suite.openの期限超過後success|request callback内のresult|expiredならclose|要求自体は取消不能、後着可能|UNKNOWN|
|Worker T7|worker.js open(version省略)|onmessage局所dbとreadonly tx、getAll成功→unresolved await|通常経路には到達せず。versionchange handler/例外catchはclose|request成功とcompleteは別。mainはunresolved受信後terminate|UNKNOWN、terminate戻りは完了通知ではない|
|Worker通常/close mode|同open|結果生成またはtransactionDone待ち|通常結果後、close modeではcomplete後|close modeだけ明示await|UNKNOWN|
|Worker失敗|同open|db取得後に失敗|catch内close。open未解決中はdb未代入|abort/errorは通知し得る|UNKNOWN|
|cleanup|deleteDatabaseObserved|削除request、接続を新規生成しない|該当なし|2000ms上限、successのみPASS|UNKNOWNをPASSへ変更しない|

primary経路のopenはsuite.jsの1実装（fixture/snapshot/upgrade/late共通）とworker.jsの1実装。controls.js、diagnostic.js/diagnostic-worker.js、shared-ledger、shutdown等の他入口も検索確認したが今回A〜Eでは呼ばない。全open箇所の検索結果は証拠に保存する。

T7はstart→unresolved受信→stop→terminate戻り→upgradeを12回まで反復。stopは管理Mapを削除しlistenerを外すが、内部停止や接続終了をawaitしない。worker messageは停止前に生成されても配送前に失われ得る。mainのPromise.raceのtimeoutはopen要求を取り消さず、成功しても元timerが残り得る。cleanup期限もdelete要求を取り消さない。静的に競合の可能性を説明できるが実際のtimeout因果は未確定。

## 事前登録：7試行（全体上限8、8番目は未使用）

順序：WebKit A→B→C→D→E→Chromium A→B。各条件1回、新規browser/contextと架空DB、最大12反復、open8000ms・cleanup2000ms・context180000ms・close5000ms。自動retryなし。WebKit26.5/Node22は既存と同じ依存lockを使用し、実際の版を記録する。

- A：Workerなし、version1をclose要求して同じDBをversion2へupgrade。
- B：version1接続を意図的に保持。version2要求のversionchangeとblockedを観測した後、保持接続をcloseし、**同じopen要求**の進行を観測する。300ms観測窓までにblockedが来なければcloseして有限終了するが、陽性対照不成立としてFAIL。8000ms期限を再始動しない。
- C：Workerなし、fixture初期化と元snapshotを維持し、readonly getAll/close→upgradeを最大12回。Worker停止以外の相違（main realmでの読取・close）を残す。
- D：元T7単独の順序を維持し、接続/transaction/イベント記録だけ追加。
- E：Dと同じmain側順序。生成WorkerだけがT7のunresolved通知前にtransactionDone completeを待ち、closeを呼び、協調状態を通知する。その通知は物理解放の証拠ではない。

予期しない例外、pageerror、trace overflow、証拠保存失敗、context/browser close UNKNOWN、対照不成立では後続をNOT_RUNにして停止。D/Eの既知のupgrade timeout/cleanup UNKNOWNは研究対象の観測結果として保持し、証拠保存・context/browser close成立時のみ次の独立試行を許可する。原版の削除を含め、失敗時の証拠をNodeへ保存してから既存cleanupを1回だけ行う。追加open/delete/強制回復なし。

## 計測と判定

runId/dbName/owner/connectionId/requestId/iteration/version/source/単調時計/event/outcomeを記録。addEventListenerで既存handlerを保持。normal close完了はUNKNOWN。close_called、close_returned、transaction_complete、upgrade成功、物理解放を分離する。NOT_OBSERVEDは有効観測窓の受信なし、UNKNOWNは未観測領域やWorker停止による配送消失など。各時計領域を跨ぐ減算は禁止。

A〜Gは要求発行/versionchange/close要求/blocked/upgradeneeded/upgrade tx終端/open終端として分類。同じmain時計で100ms heartbeatをbounded記録し、Workerからの受信も記録する。heartbeatはタイミングを変え得る。イベントループ進行はIDB内部正常の証明ではない。

H1の直接支持はBで既知接続をcloseした後に同一要求が進行すること。ただしBの因果をT7へ一般化しない。H2はD/E比較とtransaction/close観測の相関、H3は観測可能な条件成立後の停滞候補に限定。単一成功、blocked不在、terminate/close戻り、cleanup成功から原因を断定しない。独立レビュー前の原因確定は禁止。

仕様参照：[IndexedDB](https://www.w3.org/TR/IndexedDB/)、[HTML terminate worker](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker)。通常closeに独立完了通知はなく、close eventは異常閉鎖用。Workerの未配送taskが破棄され得る。

既存CIの起動対策：新規branchのpushかつ新規研究コード/workflow変更にだけ専用workflowを起動。新規PRは#393ブランチ宛とし、差分を研究folderに限定。証拠追記は[skip ci]、専用workflowのpathから証拠/報告を除外。意図せぬ大規模CIは即時cancelし記録する。

事前登録日時：2026-11-01 19:52 JST。
