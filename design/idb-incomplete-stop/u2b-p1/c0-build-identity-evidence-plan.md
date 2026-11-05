# C0実build同一性：証拠の所在とPASS条件

**BUILD_BINDING=UNKNOWN。WPE headlessは要求profile／探索候補に限る。実際に使用されたport・binary・生成物は未同定。**
Issue [#422](https://github.com/tetsujisugimori-coder/memo/issues/422)。[#421有限profile](c0-finite-build-profile.md)を継承し、重複するソース監査は増やさない。

## 今回直接照合した追加の一次ソース

以下は全てPlaywright commit `26a9e470a7b3c7822084b09fb7f13902c5f37b51`。GitHub contentsのbase64を復号しGit blobを再計算した。npm配布tarball・CI installed packageの同一性は別の未立証事項。

|固定path・Git blob|直接確認した関係|確定しないもの|
|---|---|---|
|[registry/index.ts](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/registry/index.ts#L105-L112)、`2b6e0141a7689ffd16c8dd4f7ba530cb3daeaa2a`|L105–112 Linux webkit executable候補はpw_run.sh。L356–373 platform別archive。L570–589 revisionOverride/defaultとcache directory。L1236–1265 revisionをURLへ展開、download host overrideあり|同revisionでもplatform/archive/hostを固定しなければ同bytesでない。registryの指定は実exec/loaded module記録ではない|
|[webkit.ts](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/webkit/webkit.ts#L101-L130)、`d4df20b828352c40b18b27a15ced91a869734a03`|defaultArgsはheadlessなら--headlessを追加。WSL等の分岐も別|実launch options、executablePath override、実hostがこの経路を使った証拠ではない|
|[pw_run.sh](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/pw_run.sh#L24-L72)、`f4f0f4ce940fc78c9f62c56e9edd4c57ed501e1f`|L32–35 WPE探索変数、非headlessはGTK。L41→43→48→50のfilesystem条件、L72で選択変数を呼ぶ。汎用MiniBrowser fallbackあり|WPE探索を設定しても、fallback実体の種別/版は不明。bundled MiniBrowser自身もwrapperであり得るため最終ELFまで追う必要|
|[UPSTREAM_CONFIG.sh](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/UPSTREAM_CONFIG.sh)、`949eaeae6398ad5daaec26271f606f178cc0225a`|BASE_REVISIONはWebKit `343e13bf22dca9d0ec227801419aab0f9001a32f`。保存bytesとも一致|patch適用後tree、builderが実際に使った入力の証明ではない|

`browser_patches/webkit/build.sh`と`browser_patches/prepare_checkout.sh`はこの固定refへのGETが404。別版の同名scriptで穴埋めしない。404はbuild procedure不在の証明ではなく、このpathでは取得できなかったという記録。

## 保存済み証拠の調査範囲

固定memo [#403 HEADのversion-map](https://github.com/tetsujisugimori-coder/memo/blob/b64906439094b9f2bdfcc195fe7ec50895b5d2b4/design/idb-webkit-evidence/version-map.md)、同treeの`inputs/pw-browsers.json`、`pw-UPSTREAM_CONFIG.sh`、`pw-pw_run.sh.txt`、`pw-bootstrap.diff.gz`、`source-index.json`、`saved-G-job.log.txt`を読んだ。ローカル保存先は`work/idb-webkit-evidence/design/idb-webkit-evidence/`。source索引は25上流ファイルのbytes/hashであり、binary/derived-source manifestではない。旧版対応表の「WPEを選ぶ」は#421の探索先/実体分離を優先する。

既存ログのG run [41316288566](https://github.com/tetsujisugimori-coder/memo/actions/runs/41316288566) L1373/L1385はUbuntu24.04向けv2336のdownload URLとcache保存を記録する。URLは`https://cdn.playwright.dev/dbazure/download/playwright/builds/webkit/2336/webkit-ubuntu-24.04.zip`。download成功は起動binaryのhashではない。

今回既存artifact [13087243261](https://github.com/tetsujisugimori-coder/memo/actions/runs/41316288566/artifacts/13087243261)のAPIとZIPを静的取得した（期限2026-12-01、取得時expired=false）。API digestとZIP SHA-256は共に`844d959103f22742dfd32140ff99a4bfdb3821cf0ec50d6db22c5ce5eb43157b`。entryは`changes-G.json`、`generated-D-suite.js`、`16060bc8-4b98-435c-a534-f276b70ae612-precleanup.json`、`generated-D-worker.js`、`generated-G-suite.js`、`generated-G-worker.js`、`github-history.json`、`results.json`、`trial-reservation.json`の9件。native binary/生成binding/build cacheは含まない。**このdigestは結果artifactのdigestでありWebKit archiveのdigestではない。** 保存cache manifest 372件/11件もsource-only。調査した保存先にないことから、外部builderに存在しないとは結論しない。

## 証拠連鎖・取得元・照合手順

各行のPASSはその行の限定命題だけ。CONFIRMEDは上記sourceの局所事実、CONDITIONALは照合前件つきの方法、UNKNOWNは対象実物の欠落。具体的に対象bytes不一致が確定したら、その組合せの同一性主張をFAILにする。欠落だけではFAILにしない。

|gate|現状と必要成果物|取得元・取得操作／制約|静的照合と期待される肯定証拠|
|---|---|---|---|
|B1 dependency→archive|metadataはCONFIRMED、実archive binding UNKNOWN。実installed npm/core、lock/SRI、hostPlatform/override、選択URL、元archiveが必要|旧CIの保存package/cache/artifactをGET。CDNから現在の同URLを取得するだけでは過去bytesを復元できない。今回はWebKit archiveを取得しない|tarball SRI・installed source hash・platform解決を照合し、download receiptにarchive SHA-256を結ぶ。同revisionのみは不可|
|B2 wrapper→最終実行物|分岐はCONFIRMED、実path/port UNKNOWN。起動時argv、実envの関連変数、filesystem条件、symlink/wrapper chain、ELF digestが必要|旧runnerの保存launch/exec記録とcache treeを読取り。新たにwrapper/browserを起動しない。一般MiniBrowser名からportを推測しない|実条件をwrapper順に評価、選択pathからwrapper/symlinkを最終ELFへ静的追跡、exec receiptとdigest一致。WPE/GTK/fallbackを別記|
|B3 upstream→patched tree|BASE_REVISIONはCONFIRMED、適用後tree UNKNOWN。全patch順序/hash、submodule/local変更、builderの入力tree attestationが必要|固定Playwright patch一覧と元builderのsource bundle/build provenance。sourceだけのpatch再適用は可能だが配布物由来を証明しないため今回行わない|順序付きpatch＋生成前入力tree digestをbuilder provenanceと照合。参照25pathに直接diffなしでは間接影響を除外できない|
|B4 configuration/toolchain|UNKNOWN。CMakeCache.txt、resolved ENABLE/USE/CPU/platform headers、compile_commands、link response、toolchain/sysroot、LTO等が必要|配布archive builderの保存build directory/CI artifact。runtime test結果artifactでは代替できない。custom build禁止|各翻訳単位の定義/include/最適化・link入力・有効featureとportを確定し、同一build IDへ結ぶ。CMakeCache単独では不足|
|B5 generated code|UNKNOWN。JSIDBDatabase/JSIDBTransaction等WebIDL生成header/cpp、IPC dispatch/serializer、LLInt/JIT/Wasm生成物、generator入力/版/出力manifestが必要|同じbuilderのDerivedSourcesと生成command/dependency記録。generator sourceは補助。生成・compile・実行は今回しない|全生成入力/output digest→翻訳単位→object/link manifestへjoin。生成bindingと実wrapper返却/native joinを読解。別build出力を混ぜない|
|B6 libraries/link closure|UNKNOWN。JSC/WebCore/WTFがどのELFへ静的/動的に組み込まれたか、WebProcess/NetworkProcess/injected bundle、port依存、loader/system libsが必要|元builderのlink map/SBOM、archive file manifest、旧実行時loaded-module記録。native ELFの静的読取りは可能。実行を伴う依存調査はしない|object/archive→最終ELFのlink対応、RPATH/RUNPATH/loader条件、関連lib digestを照合。ソースmodule名と同名soがあると仮定しない。必要なら静的readelf相当と保存mapsを併用|
|B7 content digests/provenance|UNKNOWN。WebKit配布archive、全wrapper/ELF/so/生成物のSHA-256、build IDsと改変有無が必要|元archive/cache、builder artifactと署名/receipt。source blobや今回の結果ZIP digestで代用不可|archive memberと展開treeの対応、全componentのdigestをprovenanceへ結ぶ。build ID単独・hashだけで入力sourceを証明しない|
|B8 actual Worker→build|UNKNOWN。元launch→browser/WebProcess→対象Worker/context/VMのprocess/thread/incarnation、ロードされた各ELF、C0到達の同世代joinが必要|既存保存exec/process/module/Worker identity記録を照会。現在のhostを調べても旧CI Workerに遡及不可。新規hook/Worker実験は禁止|digest付きprocess→Worker→VMと対象runの因果join。browser parent hashだけでchildやWorkerの使用buildを確定しない|

## PASSの範囲と取得不能時の扱い

BUILD_BINDING=PASSにはB1–B8の連続した対応が必要で、矛盾がなく、同じ旧実行・同じ配布物・同じbuilder世代に結び付くことを独立レビューする。B3–B7だけ揃えば「sourceと保存buildの対応」の限定PASS候補、B8がなければ**実WorkerへのBUILD_BINDINGはUNKNOWN**。binary digestだけ揃っても生成物や適用treeが不明なら同様。

現状取得可能と確認したのは固定ソース、既存ログ、上記結果artifactまで。builderの内部保存場所・アクセス権・保存期間は未確認。artifact GETでnative材料が得られなかったため、次の最小照会は配布archive作成者の**2336 / Ubuntu24.04-x64の元build provenance・DerivedSources・compile/link manifest・旧cache保存有無**。旧runnerのexec/module/Worker記録も別に必要。存在/取得権限を推定しない。

元artifactが消失していれば、その過去実行の同一性は静的ソースだけでは回復不能の可能性がある。代替は「上流固定sourceについての局所補題」と明示して監査を続けることに限る。新しい同revisionのdownloadや再buildで過去実体を認定せず、実験許可も発生しない。

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。

2026年11月5日 JST
