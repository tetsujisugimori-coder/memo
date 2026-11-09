# Issue #436 調査報告

## A. 判定と範囲

**総合PARTIAL、根本原因UNKNOWN、マージ推奨NO。**

指定した有限の調査を実施し、Windowsの再起動timeoutでIDB openより前の
ページ/script到達遅延を観測した。これを全既存timeoutの共通原因と断定しない。
製品への影響は「この実行で利用可能状態へ期限内に到達しなかった」範囲で確認。
一般利用の停止頻度、恒久停止、既存保存メモの破損との因果はUNKNOWN。

| 区別する判断 | 判定 |
|---|---|
| 有限調査・証拠提出 | 本報告の範囲。未検証条件と次の反証実験を明記 |
| 根本原因特定 | 未達／UNKNOWN |
| 製品修正完了 | 未実施。原因不明のため製品を変更しない |
| Windows再受入完了 | 未達。単発完走やLinux成功で置換しない |

## B. 原因候補別の証拠

| 系統・仮説 | 支持する観測 | 反証実験と実測 | 確信度・未確認 |
|---|---|---|---|
| A 製品: DB upgrade/openまたは初期化Promiseが停止 | 以前の原報告と今回の遅延snapshotはguard busy | 今回の失敗navigationはinit開始15,323ms、openは15,344→15,387ms（43〜44ms）、success後にcollections/notes読込みが進行。blocked/errorなし。IDBの10秒停止という説明には反する | 今回runの主待機がopen前だったことは強い。全事象の製品原因を排除する証拠ではない。製品の依存script量、mirror、バックエンド状態などは未分離 |
| B ブラウザ/Playwright: WebKit再起動時のscript/通信またはprotocol処理が遅延 | WebKit再起動page3で多数のCSS/JSのrequest完了が約14.5〜14.9秒遅延。locatorはguard attached待ちでtimeoutし、browserのguard観測とは到達がずれる | 製品/IDBなし64 inert scriptsをroute有無・sentinel有無で有限3条件比較し全完走。単純なroute使用/全page closeのみでは再現せず。旧版WebKitも今回REDまで完走 | 有力候補だがUNKNOWN。HTTPサーバ、route.continue、browserネットワーク、protocol配送のどこが遅れたか未分離。ブラウザバグとは断定しない |
| C Windows環境/プロセス/資源 | Windows 11 Home build26300、16.87GB RAM。初回環境読取り時の空き約0.76GB、失敗run開始時1.46GB。既存Node/Chrome等の複数プロセスあり | 同ホストの無計測・passiveは完走。旧Chromium再実行は空き約0.59GBでもREDまで完走。低い空きメモリだけを十分原因とする説明は成立しない | 相関のみ。paging/CPU/IO/AV/プロセスごとの資源原因は未実測。既存プロセスやWorkerを停止していない。OS全体の失敗としない |
| D runner/観測: 待機・イベント配送または診断自体の干渉 | 初回deepは失敗、無計測/passiveは完走。JSONL同期書込みやconsole/MutationObserver、snapshotが処理時間へ影響し得る。Node受信順にload→DCLがある | 原10秒/全assertを維持。browser NavigationTimingとpage時刻をNode受信時刻と分離。静的probeはメモリ内記録で3/3完走。診断pending error getterの問題は独立検査で修正、7合成試験PASS | UNKNOWN。deep/passive差は異なる試行・資源状態で因果証明にならない。初回deepは旧診断SHAを保持し限定する |

guardがbusyだからIDBが原因、IDB successだから利用可能、Linux成功だからWindows成功、のいずれも採用しない。

## C. 時系列（ローカルWindows・初回deep失敗）

原資料 `win32-fixed-webkit-deep/timeline.jsonl`。browser時刻はnavigationの
`timeOrigin=1794140491326`を基準とする。Nodeの受信時刻と混合して差を計算しない。

| 区間 | 開始→終了・経過 | 結果／最後の観測 |
|---|---|---|
| T0 browser launch | Node elapsed389.112→453.602ms、64.491ms | WebKit26.5起動 |
| T1 context | 454.387→1014.816ms、560.429ms | 一時context1個 |
| T2 再起動page作成 | 6839.423→7291.415ms、451.993ms | 原2page close後page数0、同context維持、新page3 |
| T2 navigation | Node goto7642.045→commit9298.554ms、1656.509ms | waitUntil=commit。DOM/初期化完了とは別 |
| T3 DOMContentLoaded | browser +15368ms（event開始15367ms） | 10秒窓内に到達した証拠なし |
| T4 load | browser +15369ms | 同上。Node受信は約24217ms |
| T5 init開始 | browser +15323ms | timeout判定の後に実行開始 |
| T6 IDB open | browser +15344ms、pending | version7指定。これが10秒停止していた記録ではない |
| T7 success | browser +15387ms、openから43〜44ms | notes/conflicts等7store。reopen時upgrade/blocked/errorなし |
| T8 data初期化 | collections15387→15441ms、54ms。初期collections15441→15445ms、4ms。notes15445→15465ms、20ms | migrate/再読取り/mirror処理へ進行。最後はmirror後のgetAllNotes開始15515msを観測、その後context破棄 |
| T9 guard解除 | 未到達 | T9 stampなし |
| T10 編集可能 | 未到達 | 遅延snapshot: guard hidden=false/busy=true、editor空、currentId=null |
| T11 保存・回復 | 当該再起動以降NOT_TESTED | 再起動前の保存・競合保全・reload結果は原JSONに保持。後続回復/再競合/明示解決は未実施 |

`openApp:error`はNode elapsed19612.839ms、attached locatorの**10,000ms**超過。
snapshot受信は24221.721msで、約4608.882ms後。snapshotをtimeout瞬間の状態とは呼ばない。
その時readyState complete/request doneでも、dbのアプリ変数への採用・初期化完了は別。
失敗PNGは起動guardの表示を確認した。永久停止やメモ破損の証拠ではない。

## D/E. 固定ソース比較と最小条件

固定sourceは修正版`478d8b3ea59b242e4ddd5cc82e12b44169223047`と
旧版`8f35ca25001ffa031abfd304dd2a5e9a3d9197dd`。診断実行ではarchiveの
JS/CJS/HTML/CSSをgit blobと全件照合。deepで実際に配信した2ファイルのhashも別記録。

| 環境／観測 | 修正WebKit | 修正Chromium | 旧WebKit | 旧Chromium |
|---|---|---|---|---|
| ローカルWindows、今回1280 AB | 無計測1回PASS、passive1回PASS、初回deep1回FAIL | deep1回PASS | deep完走・編集消失RED、exit1 | 中断試行証拠不成立→別ディレクトリ再実行で完走・RED、exit1 |
| Linux専用CI、同固定ソースdeep各1回 | 完走 | 完走 | RED成立 | RED成立 |
| Windows専用CI、同固定ソースdeep各1回 | 完走／exit0 | 完走／exit0 | RED成立／exit1 | RED成立／exit1 |
| 既存LinuxCI（歴史的記録） | 専用10/10、guide20/20、unit65/65、14成功/任意1SKIP | 両engineを含む | 両engine RED | 両engine RED |
| 既存Windows（歴史的記録） | 親/独立とも9/10のうち再起動未完了 | 独立guideのreload load timeoutを含む | 独立旧対照は未成立 | 独立旧RED成立 |

今回の失敗が成立した最小の**観測済み条件**は、Windowsローカル＋修正版＋WebKit＋
1280px AB、同contextの2タブで実UI入力・自然280ms保存/競合保全→双方reload→
全page close→直後にnewPage/goto、初回deep診断あり。これ以上縮小した原因再現器は未成立。
無計測対照は既存と同じ`MEMO_SAVE_BROWSERS=webkit MEMO_SAVE_SMOKE=1`。
コマンド詳細と有限上限は[protocol.md](protocol.md)。375/390pxの追加反復は今回は実施しない。

専用CI [42614097846](https://github.com/tetsujisugimori-coder/memo/actions/runs/42614097846)
はrunner commit `9c344ede39696b0ad0b9696005c6d1c82ca902a4`、Windows/Linux両job成功。
各OSで修正版2条件完走、旧版2条件RED、合成7試験成功、static probe3条件完走。
Windows hosted runnerの単発成功は、ローカル環境の安定化や全受入を意味しない。
Hosted Windowsのreleaseは10.0.26100、ローカルは10.0.26300であり、同一環境ではない。
全条件の開始/終了/経過と未観測区間は[startup-intervals.json](startup-intervals.json)および
原JSONLに保存。T11の保存/回復actionごとの開始終了stampは追加しておらず、原結果の到達判定と区別する。

## F/G. 根本原因・反証・変更

原因はUNKNOWN。再起動失敗runの主要遅延区間をopenより前へ絞れたが、
送信側/ブラウザ/route/protocol/ホスト資源を分離する介入証拠はない。
単純static probeの全完走は原因排除ではなく、再現を縮小できなかった結果である。

製品コード変更なし。追加は診断runner、4比較runner、静的通信probe、独立合成/計測試験、
専用workflow、証拠文書。`.gitignore`は診断の一時出力を除外する1対象だけ。
独立レビューで診断listenerがpending request.errorを読む問題を発見し、readyStateで保護。
これは計測コードの修正であり、製品timeoutの原因修正ではない。
初回診断SHA `3c3c4e0…`と修正後`a8995f1…`の両実装を保管し、初回実測のpageerrorは0件。
Windows CIの診断SHAはcheckout時のCRLFにより`631f638…`となる。
Linux/ローカルLFからの改行変換で独立再現した差であり、各manifestの値は付け替えない。

次の反証実験は、同じ失敗条件でHTTP受信/finish・route開始/完了・browser resource timing・
Node event-loop・OS pagingを同時採取し、同期ログなしの対照と有限比較すること。
未計測の資源安定化を成立済みとは扱わない。

## H. 旧RED／新GREENと保存境界

旧対照は完成した原JSONを変更なしのevaluateSafetyで再判定し、lossDemonstrated=true、
product FAIL、child exit1を要件とする。timeoutや中断をRED成功に数えない。
修正版の完走試行は方式Bの保存メモ維持、古いrevision拒否、原稿保全、reload/reopen回復、
実UI書出し、明示再編集/保存、再競合保護を元assertのまま確認。失敗runの後続はNOT_TESTED。

追加v6境界は独立合成3/3、診断4/4の合計7/7、exit0、SKIP0。
実resumeConflictDraft→registerNoteSaveState→実foundation→実putNote/競合storeを抽出して検査。
revision欠落は再編集時の一時NaN後に0へ正規化され、markChangedが1へ進め、CAS保存成功。
unknown fields保持、解決系列、再競合拒否、不正revision拒否も確認。P2の反例は成立せず製品修正なし。
fixture DOM/IDBによる合成で、実ブラウザの同境界やquota/長期耐性の証明とはしない。

原因修正/環境安定化は成立していないため、Windows全10条件・guide20条件の再受入を
完了扱いしない。既存guide結果は履歴として保存。診断による全製品回帰の保証はしない。

## I/J. 独立確認・残存UNKNOWN

[independent-review.md](independent-review.md)に別Codex子エージェントの独立照合を記録。
同アカウントの代行記録であり自己APPROVEではない。原JSON、終了コード、画像、sourceと
diagnostic SHA256を照合。合成/ローカル/CIを混同しない。

残存: 既存Chromium load timeoutとの同一原因、一般Windowsでの発生頻度、IDBバックエンド接続の
tab破棄後close完了、通常writer全transactionのtrace、実v6回復境界、実quota、Safari/PWA/長期保持。
初回deepは計測干渉の可能性、旧Chromium中断資料にはNUL/欠落があり証拠不成立。
この欠落の発生原因もUNKNOWNで、製品障害へ転記しない。UTF16LEのPowerShell logは正常な別encoding。

## K/L. 提出と保護境界

Issue [#436](https://github.com/tetsujisugimori-coder/memo/issues/436)、依存Draft
[#437](https://github.com/tetsujisugimori-coder/memo/pull/437)、baseは#435の作業branch。
最初の診断commit `9c344ede39696b0ad0b9696005c6d1c82ca902a4`。
最終提出HEADはPR/GitHub読戻し台帳で特定（自身のcommit SHAを本文へ埋め込む循環を避ける）。
原資料・保存期限・全SHA256は[evidence-index.json](evidence-index.json)と保管ZIPを参照。
新旧固定source HEADと診断runner HEADは区別する。

| 原artifact（run42614097846） | SHA256 | GitHub保存期限（UTC） |
|---|---|---|
| Linux / 13671523018 | `142e638cd0ac6362b4876ba007f1206ac475ed3f519b479b95c5a7fc580461d8` | 2026-11-23 12:07:11 |
| Windows / 13671273677 | `2894bf34593063ffbdf7148faa1a7cb3b46fc23ccb075b1681a03b86191bd596` | 2026-11-23 12:10:38 |

同じZIPを[ci-linux-evidence.zip](ci-linux-evidence.zip)と[ci-windows-evidence.zip](ci-windows-evidence.zip)へ保存。
ローカルの成功/失敗/不成立試行、歴史的Windows原JSON、ログ、画像、各診断実装は
[windows-local-evidence.zip](windows-local-evidence.zip)に保存。リポジトリ版は自動期限なし
（削除されるまで保持）。各ZIP内/台帳に全ファイルのSHA256を記録。local一時領域の保持は保証しない。

**マージ推奨NO。** 原因未確定かつWindows未完了条件の安定した独立再受入がない。
Draftを維持し、Issueは閉じない。main/#435/研究PRは保護refs台帳と最終読戻しで不変を確認。

J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、
startCondition=BLOCKED、productionWorker=HOLDを維持。実データ・実MCP/OAuth・
Worker停止復旧・本番切替なし。マージ・公開なし。

2026-11-09 JST
