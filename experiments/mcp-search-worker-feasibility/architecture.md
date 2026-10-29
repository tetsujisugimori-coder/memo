# 現行経路とWorker隔離案

調査対象のPR #388 HEADは `4fe3ea824b476d2ad6ef3c37fc14b6617be249ee`、このPoCブランチの基点mainは `0fb770aa529a95b5f7cab7cefccbfea538bc424e`。PR #388の製品差分はこのブランチに取り込んでいない。

## 現行経路

外部AIのMCP呼出しはOAuth主体とscopeを検証後、brokerがセッション、範囲、予算を検査してpendingを作る。ブラウザの `memo-search-ui.js` はcapabilityとOriginを用いてpollし、requestIdと条件を受け取る。`window.MemoNexusSavedSearch` は `app.js` の `db` と `dbConnectionClosedForUpgrade`、`getStoredNotes()`、`getStoredNoteSnapshots()`、`getAllCollections()` に依存する。検索は保存済みメモをreadonlyで読み、タグやフラグを正規化し、`memo-search.js` が結果を生成する。全文読取はreadonlyの保存済みスナップショットを取得し、同モジュールの `read()` が範囲とサイズを検査する。WorkerはDOMやwindowのグローバルに直接アクセスできないため、既存のラッパーをそのまま移せない。

UIは結果をセッション・世代と照合してbrokerへ送り、brokerはrequestId、Origin、capability、許可、範囲、サイズを検証する。取消時はUIが世代を進め、brokerがpendingを失効させる。期限と配送直前の検査はbroker側にもある。PR #388では旧pollのPromiseを同一セッションの新pollが待つため、保存読取が未解決ならbrokerの6秒終了だけでは復帰しない。

## 隔離案と信頼境界

メインは既存認証・許可、scope、allowRead、取消意思、世代、期限、予算、配送判断を保持する。Workerには、検証済みの必要最小限の検索条件、作業ID、対象DBだけを渡す。OAuthトークン、browser専用token、capability、配送先、許可変更権限は渡さない。Workerのmessageは信頼できない入力としてworkerId・generation・requestId・セッション・許可・期限・結果の形と範囲を再検証し、既存brokerでも再検証する。PoCに外部ネットワーク送信はなく、実認証・実配送も模していない。

Worker内IndexedDB読取と純粋な結果生成は候補となるが、本番移行にはDBのversionchange、接続終了、タグ正規化、collection存在確認、ゴミ箱、既存スナップショット、本文サイズ、readonly、scopeと結果照合を既存実装と一致させる必要がある。PoCの検索は架空の2件に対する単純な文字列比較であり、既存 `memo-search.js` を本番相当として移植・比較したものではない。

仕様上、[HTML StandardのWorker](https://html.spec.whatwg.org/multipage/workers.html#dom-worker-terminate) と [IndexedDB 3.0の接続・トランザクション](https://www.w3.org/TR/IndexedDB-3/) を参照。Worker内のIndexedDB露出と終了APIは利用可能だが、終了メソッドは完了通知やメモリ解放の証明を返さない。WebKit自動試験はiPhone Safari実機の証拠ではない。
