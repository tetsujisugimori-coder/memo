# Issue #436-C：Windows実PC・隔離計測の実行手順

## 現状と目的
Stage #436-B のHTTP／Playwright route／ResourceTiming／Node・Windows資源の計測を、2026-11-09にtimeoutが観測された**実際のWindows実PC**で使用するための実行キット。独立リポジトリ複製・WebKit専用ブラウザファイル・Playwright一時contextと架空データだけを使う。実ユーザーのMemo-Nexus保存データ、OAuth、MCP、本番Worker、実運用ブラウザのプロファイルは使わない。

**GitHub hosted Windows runnerでは実PCの遅延を証明できない。** 本キットを追加・CIで安全予行演習しても、当該実PCで実行されない限り「LOCAL_WINDOWS_NOT_RUN」のままとする。

## 実施までの手順
1. Windows実PCのPowerShell 7（またはWindows PowerShell 5.1）で、まずGitHubのcodex/issue-436c-local-windows-isolation-20261110ブランチを新規フォルダーへcloneする（既存作業ツリーをcheckout/merge/rebaseしない）。Gitの既存ブランチ、main、他の作業ツリーは変更しない。
2. tools/issue436c-local-windows.ps1 を引数なしで実行するとPreflightのみになる。実際のブラウザ試験・clone・npm installは行わない。
3. OS、git/node/npm/npx/tarの存在、メモリ空き、ディスク空き、および成果物の場所をpreflight.jsonで読む。実試験時は同スクリプトを -Execute -ExpectedKitHead <40桁の固定SHA> で呼ぶ。与えたSHAとclone後HEADが異なれば試験開始前に停止する。
4. 1,536MB未満の空きメモリは原則BLOCKED。実測低メモリ状態で実行する必要がある場合のみ、危険を理解したうえで -AllowLowMemory を明示的に付ける。他のプロセスを終了しない。2,048MB未満のディスク空き、未取得のディスク値、OS不一致、工具不足もBLOCKED。
5. 計測は固定製品HEAD 478d8b3ea59b242e4ddd5cc82e12b44169223047をGit archiveで復元・byte検証し、Windows上のWebKitのみ1280px/ABで、既存passive→StageB trace→StageB trace→既存passiveの計4ケース（ABBA）。製品操作は通常の架空メモ入力／保存だけ。元の10秒locator timeout、90秒case watchdog、150秒child cleanupは変更しない。エラーや期限切れは製品PASSへ変換しない。
6. 出力は既定でTEMP配下の新規「memo-issue436c-...」フォルダー。preflight.json、outcome.json、原evidence/summary.json、ログ、画像、stage436b-telemetry.json、レビュー用のissue436c-evidence.zipとarchive-sha256.jsonを残す。アップロード・メール送信は自動では行わない。
7. 実行したらevidence/summary.json内のdiagnosticStatus、allProductPASS、各ケース originalExit / originalProductAcceptance / traceSummary / droppedEvents を区別して確認する。失敗試行では、HTTP/route/browser/Windows countersの欠測と時計出自を保持する。ZIPのWindowsユーザー名・一時パスなどを確認してから人間の判断で共有する。

## コピーできるWindows実行例
※ <固定SHA> は対象PRの最終40桁HEADに置換。既存フォルダーを上書きしない。

    $kit = Join-Path $env:TEMP ('memo436c-kit-' + [guid]::NewGuid().ToString('N'))
    git clone --single-branch --branch codex/issue-436c-local-windows-isolation-20261110 https://github.com/tetsujisugimori-coder/memo.git $kit
    & (Join-Path $kit 'tools/issue436c-local-windows.ps1') -Execute -ExpectedKitHead '<固定SHA>'

## 安全・判定
許可は上記の架空データを使う有限試験だけ。依存PR #435/#437/#438/mainは変更せず、#436はopen。J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLDを維持。これは製品Workerの停止・復旧研究、実MCP認可、実IndexedDB移行を許可するものではない。メモ保存に危険が出るなら実ユーザーデータから切り離したまま止める。

## 未完了の条件
実PCでのexecution、ZIPの人手監査、失敗時の区間因果判定、独立レビュー、Windows全10/guide20の受入は、本キットとGitHub CIだけでは未達。制約や欠測をそのまま報告し、無限反復・timeout延長・成功条件緩和はしない。

2026-11-10 JST
