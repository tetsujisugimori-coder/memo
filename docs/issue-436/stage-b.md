# Stage #436-B：起動遅延の発生区間切り分け（診断専用）

## 対象
Issue #436 / Draft PR #437（HEAD b7270b85011c26f7667b275f62b380e2cc1e2d83）を親にした診断専用ブランチ。製品比較の固定修正版478d8b3ea59b242e4ddd5cc82e12b44169223047、旧対照8f35ca25001ffa031abfd304dd2a5e9a3d9197ddは変更しない。依存#435→#437→本工程。

## 対象と計測面
- HTTP：Node単調時計内でhttp:received→http:finishを同一requestキーで結合。長時間でもサーバー原因と即断しない。
- Playwright route：同じNode時計でroute:start→route:endをrouteキーで結合。route callbackの完了であってブラウザ受信完了ではない。ラップそのものは干渉候補。
- browser：NavigationTimingとResourceTimingをopen/ready/error後にreadonly snapshotする。ブラウザtimeOrigin基準の値をNodeのperformance.nowと直接引き算しない。snapshotはtimeout瞬間ではない。
- Node/Windows資源：500ms間隔でNode RSS・CPU・event loop lag・OS空きメモリ。Windowsだけ8秒間隔でPowerShell/CIMのpaging・CPU・disk指標を非同期best effort取得。失敗・欠測はUNKNOWN。追加測定自体のオーバーヘッドも考慮する。

## 有限のABBA比較
Windows/Linux CIで同じ固定修正版・WebKit・1280px/AB SMOKEを、既存passive→追加trace→追加trace→既存passiveの4条件（ABBA）で検証する。node --test issue436b-telemetry.test.cjs、node issue436b-comparison.cjs webkit。各試行は新しい証拠ディレクトリを使う。元の10秒locator期限、90秒case watchdog、150秒child cleanup、全assert、保存関数・280msタイマー・BC・IDB writerを変更しない。

出力は各runの原results/manifest/exit、StageBで追加したstage436b-telemetry.json、ABBA summary.json。product FAILと診断原資料COMPLETEは別判定。旧REDはStageA資料に残し、StageBの成功数へ加算しない。診断ファイル書き込みは原則子プロセス終了時に一括で、強制終了時には欠測として扱う。

## 判定・残件
CIのdiagnosticStatus=COMPLETEは有効な原資料が揃ったことだけを意味する。allProductPASS、rootCause=UNKNOWN、Windows実PC全10条件/guide20条件の再受入、Chromium既往timeout、iPhone Safari/PWAなどの課題を分離。Windows hosted runnerでの完走はローカル実PCの安定化を意味しない。HTTP・route・browser・hostがまだ相互排他的に識別できなければ根本原因UNKNOWNを維持する。次の反証は遅延した同一requestのHTTP/route/ResourceTimingと同時刻のページングの時系列の独立照合。

## 安全
実利用者データ・実MCP/OAuth・製品Worker停止復旧・本番切替を禁止。#435/#437/mainは変更しない。
J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLDを維持する。

2026-11-10 JST
