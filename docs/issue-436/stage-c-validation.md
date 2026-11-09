# Issue #436-C Windows実PC向け隔離ランチャー 検証結果

## 総合判定
**実行キットのWindows hosted CI受入PASS。実際のユーザーWindows実PCでの遅延測定はNOT_TESTED。根本原因UNKNOWN、マージ推奨NO。**

- ランチャー最終検証HEAD：0167c60e27adf65415b1b1f99cf7eeb2b3742dc0（結果文書追加前）。
- [GitHub Actions run #42682688209](https://github.com/tetsujisugimori-coder/memo/actions/runs/42682688209)の2ジョブともSUCCESS。
- safety-preflight-only: 初期preflightはclone/ブラウザ起動せずPASS、無効SHAではBLOCKED・exit2を保存しつつ独立試験がPASS。
- hosted-kit-integration: 固定HEADをGitHubからclone、別ブラウザ領域、WebKit 1280/AB synthetic ABBA 4ケースをすべて原exit0、製品PASS、資料COMPLETEで完了。実データ・実PC接続を伴わない。
- hostedでの追加trace2試行（単一request/リソース最大値の範囲）：HTTP 61.8～63.5ms、route 91.8～112.1ms、resource 114～120ms、DOMContentLoaded 533～540ms。過去の15.3秒遅延は再現せず、製品・browser・runner・OSへの原因帰属はUNKNOWN。
- Windows CIMはサンプル1件/2件が得られたが、欠測イベントも1件あり。これだけでpagingが原因でないとは言えない。
- 原hosted artifact：[13702948062](https://github.com/tetsujisugimori-coder/memo/actions/runs/42682688209/artifacts/13702948062)、1,257,315 bytes、SHA256 3289ab369ffcd679bfb360f2d09832c6e3944259355c347f7ddf0a947a512830、GitHub上の期限2026-11-23T19:24:31Z。
- 最初のpreflight CIでは「意図的に失敗した子実行の終了コード」がCI終了コードに残るテストハーネス不備、統合CIではPowerShell自動変数Argsをhelper引数に用いた不備があった。それぞれ修正済み。現在のSUCCESSは上記修正後HEADによる。

## 未実施
ユーザーのWindows実PCに対するリモートコマンド/シェル接続手段がこの会話のツールにはないため、**当該実PCで実測していない**。未検証をHosted CIの成功で置換しない。実PCでの実行後は新しいZIPのoriginal exit、trace、失敗時snapshotとbrowser/Node時計、Windows resources、欠測を独立照合する必要がある。実PCの空きメモリが1,536MB未満なら自動ブロックするため、継続する場合は人間が資源安全を判断して明示的AllowLowMemoryを指定する。

## 安全
#435/#437/#438/main不変。実ユーザーメモ、実MCP/OAuth、Worker停止・本番切替なし。J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLD維持。Issue #436 open、Draft PR #439はマージせず独立再レビュー待ち。

2026-11-10 JST
