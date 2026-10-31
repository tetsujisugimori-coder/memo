# #392 第2段階：限定調査（PARTIAL、本番採用HOLD）

対象HEAD `597c1d4985724e3dd77660a3562020d7004b6d86`。mainは後に `438cf201abe83a53e8cb8e7ed160c4d6dbe147ba`（#394の独立PoCを追加）へ進んだ。#393は引き続き同じHEADのDraft。実検索・認可・保存・本番Worker統合は変更しない。#394も本番統合を実証していない。

## poll診断

Windows WebKit 26.5、架空issuer・分離context、基準HEADのE2Eを前回1回実行しpageerrorで失敗。今回、同HEADの試験に時系列観測のみ追加した1回も同様に失敗。製品と試験の通信動作は基準と同じで、共有台帳PoCは検索E2Eに接続されていない。従ってこの現象はPoC固有ではなく基準試験でも観測された。診断結果は `evidence/webkit-poll-route-diagnostic-20261031.json`（試験ID、環境、基準commit、採取時刻付き）。時刻はプロセス内単調時計msであり、別runとの絶対比較はできない。トークン、Cookie、本文は記録していない。

観測例：poll 30は58313.57msに開始。試験の保持routeはephemeral receiverから58327.43msにHTTP 200を取得。取消は58427msに開始し、試験が応答を意図的にabort、58440msに `Blocked by Web Inspector`。狭い新session開始後、59035msに保持routeを解放し、59036msに `route.fulfill` が失敗。60473.31msにpoll access-control pageerror、60473.37msにpoll 30の `Could not connect to server` が発生。page close開始は76694ms、context closeは76814ms、その後browser close、試験serverの順。pageerrorは操作中であり終了時に初めて発生したわけではない。保持pollに対するブラウザ側HTTP応答は観測されていない。

これは失敗した保持routeと同一pollのrequestfailedを特定できる時系列であり、pageerrorと同じrequestの因果関係は推定に留まる。`route.fulfill` の失敗詳細、WebKit内部の拒否理由はUNKNOWN。Originは架空127.0.0.1:5500から論理8791へのcross-originで、Playwrightがephemeral fixtureにrouteする。製品fetchはcors、credentials omit、8秒AbortSignal.timeout。今回の保持は8秒未満だが各signalの実発火は未観測。実8791・8792、Auth0、実メモは使用しない。

原因分類：A 本来のアクセス制御拒否 UNKNOWN、B Origin/CORS不一致 UNKNOWN、C 認可・期限不一致 UNKNOWN（fixture HTTP 200は実認可の証明ではない）、D 中断・取消との因果 UNKNOWN、E WebKit固有 UNKNOWN（Chromiumとの同条件直接比較は未完了）、F 保持routeのfulfill失敗は観測、根本原因はUNKNOWN、G その他 UNKNOWN。したがって動作修正と修正後PASSは主張しない。前回並列診断ではWebKitが途中の検索件数assert、Chromiumが許可操作timeoutで別途失敗。原因は不明で終了時事象と混同しない。

## 台帳状態と境界

| 台帳状態 | 意味 | 枠の扱い |
|---|---|---|
| reserved | 原子的に予約、Worker生成前 | 所有者とIDが一致する場合だけ明示release可 |
| running | 生成前に遷移、生成済みとは限らない | release不可、所有者消失時も保持 |
| invalidated | 結果を無効化 | 保持 |
| stop_requested | 停止要求 | 保持 |
| unknown | 生成失敗・停止未確認 | 保持、時間では回収しない |
| absent | 生成前予約を明示release済み | 論理予約を再取得可能 |

予約・Worker生成・所有権release・Worker終了/物理解放は別事象。`start`は予約後にrunningをコミットしてからfactoryを呼ぶ。releaseとrunning遷移はIDB readwrite transactionにより直列化される。生成失敗も枠を保持する。`releaseReserved`の反復はalready_absent、古いIDは新予約を解放しない。実行中の正常終了枠は現PoCでは解放できず、正常後の再取得は未成立。これは本番の継続利用方式ではない。Worker.terminate、タイムアウト、lease期限、tab閉鎖を物理解放の証拠としない。

同一origin・同一IDB partition・協調参加者・一貫した容量設定の範囲。サイトデータ消去、別プロファイル、別端末、非協調コードやOS全体を制御できない。読み書きできない／不正な台帳では開始しない。所有者消失や停止未確認で上限に達すればHOLD。外部の検証可能な隔離環境と終了証拠なしに自動再開しない。実UIでの停止表示や物理解放を確認する主体は未実装。

## 今回の試験

- Windows Chromium 151.0.7922.34 / WebKit 26.5 各1回：容量1の同時取得で生成1、敗者reloadと所有タブ閉鎖後も上限維持。存在しない／不正な台帳では生成0。架空DBの1値は一致。
- 両エンジン各1回：生成前予約のreleaseと再取得、再release、別所有者拒否、古いIDで新予約を維持、runningのrelease拒否、factory失敗後unknownと再生成拒否。Worker作成試行と成功を混同しない。
- 合成モデル6/6、既存broker 17/17成功。合成旧handler注入は物理的に遅れたWorkerメッセージの観測ではない。
- 所有tab自身のreload、全tab閉鎖後の再起動、通信途絶中の台帳更新失敗、異常なbrowser終了、正常Worker終了後の再取得は未試験または未実装。物理解放UNKNOWN。

次工程はroute.fulfill失敗理由を秘密情報を出さず識別できる最小比較、正常終了を示す協調protocolと永続的生成予算の両立を設計し、複数タブで再取得時の安全性を検証する。#388の未解決Promise、実broker要求の重複配送防止、配送直前の取消・期限・認可は別途統合試験が必要。T7、既存PoC cleanup、Chart WebKitの既知失敗は別事象として維持する。
