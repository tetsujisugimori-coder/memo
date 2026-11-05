# 旧WebKit生成証拠・Worker実行記録の保存状況

**総合PARTIAL。旧実行へのBUILD_BINDING=UNKNOWN。実binary→process→Worker→VM→IndexedDB transactionの結合は成立していない。**

Issue [#424](https://github.com/tetsujisugimori-coder/memo/issues/424)。これは過去環境の棚卸しであり、実験の開始許可ではない。

## 固定基準と先行研究

指定Issue [#407](https://github.com/tetsujisugimori-coder/memo/issues/407)、[#411](https://github.com/tetsujisugimori-coder/memo/issues/411)、[#418](https://github.com/tetsujisugimori-coder/memo/issues/418)、[#420](https://github.com/tetsujisugimori-coder/memo/issues/420)、[#422](https://github.com/tetsujisugimori-coder/memo/issues/422)とPR [#403](https://github.com/tetsujisugimori-coder/memo/pull/403)、[#417](https://github.com/tetsujisugimori-coder/memo/pull/417)、[#419](https://github.com/tetsujisugimori-coder/memo/pull/419)、[#421](https://github.com/tetsujisugimori-coder/memo/pull/421)、[#423](https://github.com/tetsujisugimori-coder/memo/pull/423)の本文、保存conversation、reviewを取得した。#422本文はAPIでも多数の`?`を含むため欠落した日本語を復元せず、#423の文書を優先する。

研究基準は#423 HEAD `592ccb63478d0a23312237d1f736a419c096f5f8`の次の3文書。先行文書はコピー・変更しない。

- [B1〜B8 build証拠計画](https://github.com/tetsujisugimori-coder/memo/blob/592ccb63478d0a23312237d1f736a419c096f5f8/design/idb-incomplete-stop/u2b-p1/c0-build-identity-evidence-plan.md)
- [研究統合](https://github.com/tetsujisugimori-coder/memo/blob/592ccb63478d0a23312237d1f736a419c096f5f8/design/idb-incomplete-stop/u2b-p1/c0-research-evidence-synthesis.md)
- [所有区間・非再入の証明条件](https://github.com/tetsujisugimori-coder/memo/blob/592ccb63478d0a23312237d1f736a419c096f5f8/design/idb-incomplete-stop/u2b-p1/c0-owner-nonreentrancy-proof-obligations.md)

WebKit上流は`343e13bf22dca9d0ec227801419aab0f9001a32f`、Playwright metadataは`26a9e470a7b3c7822084b09fb7f13902c5f37b51`、共通観測契約v1はblob `1a4b59272c13fb6b821a0c3853eed89e58a93967`。対象は旧Linux Ubuntu24.04 x64 / WebKit rev2336。T7のWindows履歴や別platformをこのbuildへ一括結合しない。

開始時mainは`438cf201abe83a53e8cb8e7ed160c4d6dbe147ba`、ローカル変更なし。#403/#417/#419はOpen/Draft、#421/#423はMerged。#419の開始時HEADは`5b34fcee1de4b2a8e97397ea3920baffa32046ef`で、#423本文内の過去HEADと異なる。今回はmainから`research/legacy-webkit-provenance-20261105`を作り、研究branchへ積まない。最新の提出固定値はPR本文・[提出記録](submission.md)で別記する。

## A. build証拠で新たに確認できた範囲

[所在・保存・欠落一覧](inventory.md)の各行に、探索先、操作、run/artifact、日時、hash、範囲、確認結果、不足と次候補、権限・期限を記載した。[取得台帳](acquisition-ledger.json)は取得bytesのreceiptで、保存元URL/固定ref・サイズ・SHA-256・取得時刻を保持する。hashは内容の識別であり、単独でbuilder由来を認証しない。

現在の[CDN archive](https://cdn.playwright.dev/dbazure/download/playwright/builds/webkit/2336/webkit-ubuntu-24.04.zip)を静的GETした。106,966,125 bytes、SHA-256 `357cd5d52f0770f01a86c1e0e2e193b5cfdb760452fc766e26eb5c8ee3951345`、65 entry。取得時HTTP 200、最終hostは`playwright.download.prss.microsoft.com`。ETag/Last-Modifiedはreceiptに保存したが、過去runのdownload receiptや署名付きbuilder attestationの代用にはならない。

ZIPを展開・実行せず、全memberを読んでhashし、ELF64のNOTE/INTERP/DYNAMICを解析した。[archive-inspection.json](archive-inspection.json)にGTK/WPE両方のpath、digest、GNU Build ID、DT_NEEDED、symlink targetを保存した。これは今回取得したarchive内の実在性に限る。実行時にロードされたsystem libraryのbytes・loader選択・旧cache改変有無はUNKNOWN。

同archiveの`minibrowser-wpe/README.txt`には、Platform=WPE、Configuration=Release、Builder OS=Ubuntu 24.04.4 LTS、Builder date=`2026-07-20T19:23:22.231583`、使用script名=`Tools/Scripts/generate-bundle`という**自己記載の部分メタデータ**がある。GTK側はPlatform=GTK、Builder date=`2026-07-20T19:22:48.103091`で、他の上記欄は同じ。この日付をcompile時刻やbuilder run IDとは認定しない。script名の参照はあるが、実際に使用したscript bytes/commit、CMake flags、適用tree、署名付きprovenance、旧実行への対応は未確認。生成条件が全く記録されていないという意味にはしない。

現在archiveについてのWPE候補経路は次のとおり。

1. 固定[registry/index.ts](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/registry/index.ts)はLinuxのexecutable候補を`pw_run.sh`にする。Ubuntu24.04-x64は2336のarchiveへ対応する。
2. 固定[webkit.ts](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/webkit/webkit.ts)のheadless引数から、[pw_run.sh](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/pw_run.sh)はWPE探索変数を選ぶ。今回ZIPの同wrapperは固定sourceとbyte一致した。
3. `minibrowser-wpe/`が存在するという**今回ZIPの構造を前提**に、`minibrowser-wpe/MiniBrowser`へ進む。このfileはshell wrapperで、WEBKIT_EXEC_PATH / WEBKIT_INJECTED_BUNDLE_PATH / WEBKIT_INSPECTOR_RESOURCES_PATH / LD_LIBRARY_PATHを設定して`bin/MiniBrowser`をexecする記述がある。実際には実行していない。
4. 最終候補ELF `minibrowser-wpe/bin/MiniBrowser`のSHA-256は`beba1f80ba86e4e06d7b6df0041b1034614b5b94a3e7235103cdc8a78118cef7`、Build IDは`d80d504d1314a3a6f3e5ab4ad681fa79f5aba063`。`WPEWebProcess`は`cae96ae2b8f2668d9afab2bce22ac23d9a54f25e846909ddbc86fbcebfb2e925`、Build ID `283a448ea54c3d7dfa3ee61e4d60e4bf44fc3fcc`。`libWPEWebKit-2.0.so.1.10.2`は`bceb94802c12e30220735ffcc5ce14977b9f333fb03913ee196d1619e6c56703`、Build ID `775f8be98a373450400132b921d85a4c62795f60`。

汎用fallbackは別条件である。bundled port directoryがなく、WK_CHECKOUT_PATH側build directoryもなく、`$SCRIPT_PATH/MiniBrowser`が存在するときに選ぶ。次のscript側build directory分岐とも別。今回ZIPにはbundled WPEがあり、汎用fallbackが当時使用された証拠もない。headlessという要求だけで当時のWPE実行を認定しない。

registryの`PLAYWRIGHT_BROWSERS_PATH`、revision override、`PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST`/`PLAYWRIGHT_DOWNLOAD_HOST`、BrowserTypeの`executablePath`、wrapperの`WK_CHECKOUT_PATH`、symlink、関連envを静的sourceで確認した。旧runnerのenv全体・filesystem条件・exec receiptは未取得。現在のhostのinstalled package/cacheを旧CIの代用品にはしない。

固定[roll_from_upstream.sh](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/roll_from_upstream.sh)は内部`playwright-browsers` checkoutから公開patch/wrapper/configをコピーする記述を持つ。これは元builder runの特定ではない。推定候補`microsoft/playwright-browsers`へのGETと固定版build.sh/prepare_checkout.shへのGETは404。repository名の相違・権限不足・不在を区別できず、builder保存場所・run・保持期間はUNKNOWN。

## B. Worker記録と結合できる範囲

旧G run [41316288566](https://github.com/tetsujisugimori-coder/memo/actions/runs/41316288566) / artifact 13087243261のZIP SHA-256は`844d959103f22742dfd32140ff99a4bfdb3821cf0ec50d6db22c5ce5eb43157b`。再取得bytes、API digest、`work/c0-evidence-materials/saved-result-artifact.zip`が一致した。9 entryは#423記録と一致し、JSON/生成JS等でnative build材料はない。[artifact-inspection.json](artifact-inspection.json)に全memberのdigestを保存した。**このhashをWebKit archiveのhashに使わない。**

|系列|Actions run / artifact|保存結果内のtrial runId|原資料で確認できる範囲|
|---|---|---|---|
|旧T7 4履歴|40851321011 / 12887605745、40851676069 / 12888020339、40852560234 / 12887263146、40866596832 / 12894311489|各member名のUUIDとgithubRunIdを別扱い|各1結果JSON。runner checkout/sourceHashesとJS timeline。trace/native lifecycleなし|
|T7 DB identity|41244959121 / 13058663151|0d4bd770-fdb2-431c-8444-73c3e55693c3|JSONとsuite-identity.patch。DB/JS側identityの追加診断で、native incarnation台帳ではない|
|D/E|41299732744 / 13081135264|D=eec76e89-5f10-45d0-8830-8dcb3ddf2110、E=e22b6648-7957-44f7-bb08-a902f835d763|結果JSON・precleanup・生成JS、17 entry|
|F|41303212794 / 13081834516|61b757bd-6b5f-4fdf-aab8-574c511aea93|同種8 entry。complete後停止の旧評価を維持|
|G|41316288566 / 13087243261|16060bc8-4b98-435c-a534-f276b70ae612|同種9 entry。固定1msの旧記録、再試行なし|

D/E/F/Gの`results.json`はGit保存gzipのraw bytesとも一致。sourceHashesは、T7のPR名目HEADと実checkout merge commitを区別して、**7結果JSONの66 source参照**を各記録の固定Git objectと照合し一致した。sourceHash一致はnative実体・実行経路の全証明ではない。T7の全過去runを内容取得したわけではなく、他の列挙済みartifactは次候補として残す。

保存sourceのobserverはJS objectにowner別connection/transactionカウンタを割り当てる。D/E/F/GはrunId/dbName/worker-N/iterationとsourceSeq・receiveSeqを保存しており、**同じJS記録系列のラベル**は追跡できる。ただしprocess incarnation、native Worker/context/VM/thread、native connection/resource ID、再利用世代との直接joinはない。script bytesのhashも、native VMが実際に評価したscript instanceのIDではない。

[worker-inspection.json](worker-inspection.json)は重複summaryではなく各trialの`value.events`を調べた結果。受信イベント数はD=152、E=334、F=346、G=346。各sourceの観測範囲内にsourceSeq欠番・重複はなく、overflow=false。最終producer high-water、flush ack、producer epoch、未受信tail、thread/process損失の独立記録はない。連番prefixの完全性からログ全体の完全性を導けない。

`worker_stop_requested` / `worker_terminate_called` / `worker_terminate_returned`はmain側の要求/戻りの直接JS記録である。Worker生成/ready/messageもJS側。全JS entry/exit、native停止確定、cleanup entry/exit、thread退出の直接記録には置換しない。`cleanup_start/end`は試験のJS cleanupであり、native shutdown cleanupではない。`connections.json`、worker/main抽出JSON、analysis/comparisonは保存された後処理資料として分離する。raw eventにあるtransaction_completeは公開event観測で、内部commit cutの独立witnessではない。

JS console/Actions logはrunnerの出力、結果JSONはJS observerとrunnerの保存結果、Playwright traceは操作/通信等の別種資料、native lifecycleは別の未取得証拠。今回の8 ZIPにtrace/report bundle/native lifecycleは未発見。traceがあってもnative ID・世代・recorder終端を含むかは別途検査が必要。

## C. 独立した同一性判定

|軸|限定して確認したもの|旧実行全体の判定|
|---|---|---|
|metadata一致|固定browsers.jsonの2336/26.5とUPSTREAM_CONFIGの上流commit、旧downloadログ|CONFIRMED（metadata限定）。installed npm/core全bytesはUNKNOWN|
|source一致|保存25上流sourceの索引hash/blob、372件+11件のsource-only manifest、結果66参照|CONFIRMED（そのsource/参照限定）。完全patched tree・build母集団はUNKNOWN|
|archive一致|現在CDN bytesのhash/65 member、旧ログの同URL|旧download bytesとの一致UNKNOWN|
|実ELF一致|現在ZIP内ELF path/digest/Build ID/DT_NEEDED|旧exec/loaded moduleとの一致UNKNOWN|
|実行identity一致|結果ZIP→Actions run/checkout、JS label系列|native process→Worker→VM→txの同世代join UNKNOWN|

元builderの生成条件も旧exec実体も証明できないため、BUILD_BINDING=UNKNOWN。source cacheは全buildの証明ではない。archive/ELFを今入手したことからB8を遡及して埋めない。

## D. B1〜B8再評価

評価単位は#423の**旧実Workerに届くgate全体**。局所CONFIRMED/CONDITIONALと混ぜない。欠落だけをFAILにしない。今回、実証拠同士の確定したdigest矛盾は検出していない。

|gate|再評価|増えた証拠・限定命題|未成立の対応|
|---|---|---|---|
|B1 dependency→archive|UNKNOWN|metadata CONFIRMED、現在archive実在/hash CONFIRMED|当時installed package・platform/override・archive digest receipt|
|B2 wrapper→最終実行物|UNKNOWN|現在ZIPではbundled WPE wrapper→ELFの静的経路CONDITIONAL（当該構造/引数を前提）|旧実argv/env/FS/exec receipt、fallback排除|
|B3 upstream→patched tree|UNKNOWN|固定上流と公開patch bytes/roll元記述CONFIRMED|builder入力commit、全patch順・適用後tree/改変、runとのattestation|
|B4 config/toolchain|UNKNOWN|現在ZIPのREADMEにRelease・builder OS/日時・bundle script名の自己記載あり（PRESENT_PARTIAL）。CMake/解決済み設定・compile/link材料は調査範囲で未発見|自己記載とbuilder runの認証結合、CMakeCache/resolved headers、compile_commands、link inputs、toolchain/sysroot|
|B5 generated code|UNKNOWN|生成JSは存在するがWebIDL/IPC/JIT生成物とは別|同build DerivedSources、generator版/command/input/output manifest|
|B6 libraries/link closure|UNKNOWN|現在ELFのDT_NEEDED・symlink・Build ID CONFIRMED|object→link closure、旧loader/system libs/loaded module digests|
|B7 digests/provenance|UNKNOWN|現在archive全65 member、旧結果8 ZIPのdigest CONFIRMED|旧archive/展開treeのreceiptと元builderへの認証結合|
|B8 Worker→build|UNKNOWN|Actions run→結果/checkoutとJSラベルの対応CONFIRMED|digest付きprocess/child→Worker/context/VM/thread/incarnationと同tx世代|

## E. 取得不能証拠と次の最小候補

1. 配布担当に2336 / Ubuntu24.04-x64の**既存**builder run URL、run attempt、入力source/patch tree、build artifact/manifestの保存先・権限・失効日時だけを照会する。今回は外部連絡していない。候補repositoryの404から「未生成」「失効」と推定しない。
2. 旧runner cacheの保存receipt/展開manifest・archive digest、exec argv/env、module map、process起動世代記録が別storageに保存されたかを照会する。現在一覧のnpm cache2件だけでは証明できない。
3. 同builderのCMakeCache、compile/link manifest、DerivedSourcesを既存保存物から取得。見つからなければUNKNOWNを維持する。新生成・再buildで置換しない。
4. `local-search.json`の旧T7診断ログと、全426 artifact metadata内の他T7系列をrun/checkout単位で追加照合する余地がある。今回の有限標本の外の内容はUNKNOWN。native identityを記録する別recorderの所在が判明してから、完全joinとhigh-water/flush/dropを検査する。

GitHub側ではartifact5ページ426件、cache2件、memo release0件、固定Playwright v1.62.1 release assets0件を確認。artifact名にnative/CMake/DerivedSources/build-manifest/SBOM等の候補は未発見だが、全426 ZIP内容は検査していない。`local-search.json`は指定した6研究worktreeの対象subtree 884 fileをhashし、ELF magic/native候補名0件。元builder全storage、OSの全cache、他のworktree、削除済みartifact、外部保存を網羅しない。NOT_FOUND_IN_SCOPEは不存在の主張ではない。

## F. 静的照合と反例

[static-check.py](static-check.py)は標準libraryのみ。network/subprocess/ZIP展開/取得file実行はしない。`receipts`は入力台帳と別fileの期待値を受け、Gの既知hash/run/artifactを#423から固定した[expectations.json](expectations.json)と照合する。他receiptの自己記載hash一致は独立したorigin認証ではない。

```powershell
$taskEvidence = Join-Path $env:TEMP 'memo-provenance-20261105'
python -B design/idb-provenance-inventory/static-check.py receipts design/idb-provenance-inventory/acquisition-ledger.json $taskEvidence design/idb-provenance-inventory/expectations.json
python -B design/idb-provenance-inventory/static-check.py controls design/idb-provenance-inventory/fixtures/subjects.json design/idb-provenance-inventory/expectations.json
python -B design/idb-provenance-inventory/static-check.py zip (Join-Path $taskEvidence 'current-webkit-2336-ubuntu24.04-x64.zip')
python -B design/idb-provenance-inventory/static-check.py saved-index (Join-Path $taskEvidence 'snapshots/592ccb63478d0a23312237d1f736a419c096f5f8/experiments/idb-time-delay-only/evidence/index.json')
```

期待値はfixture subjectから生成しない。`fixtures/payload.txt`の`abc`、固定のliteral SHA-256とsynthetic-run-Aを独立期待値にし、正常、file欠落、別run、digest矛盾、重複、壊したmanifest shape、取得不能、root外参照、receipt欠落の9対照を検査する。欠落/取得不能はUNKNOWN、明示矛盾はFAIL、正常はMATCH（実行証明PASSではない）。詳細と自己照合結果は[validation.md](validation.md)。

一時原bytesは`acquisition-ledger.json`のtemporaryRoot配下。取得fileのサイズ/hashを記録し、独立レビュー・追跡のため保持する。自動削除せず、受入後にこのtask directoryの絶対pathを確認して削除する方針。OS tempの保持保証はなく、Gitには研究資料とhashのみを保存する。旧work/証拠は上書き・削除しない。

## 判定の維持

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。

実browser/Worker/IndexedDB/1ms、再build/custom build/native hook/observer/追加lock/同期flushはNOT_RUN。製品・judge・schema・Collector・runner・workflow・旧証拠・契約・先行PRは変更しない。実メモ、OAuth、MCPサービス、Tunnel、8791/8792を操作しない。独立レビューは固定HEADの研究文書・静的検査の範囲に限り、結果をsubmission.mdへ記録する。Draft解除・merge・auto-mergeは行わない。

2026年11月5日 15:10 JST
