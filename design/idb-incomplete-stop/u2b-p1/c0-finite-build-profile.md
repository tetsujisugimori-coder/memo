# C0の有限対象プロファイル：WPE headless候補

**判定：SOURCE_PROFILE=PARTIAL、EXECUTED_BINARY_BINDING=UNKNOWN、FEATURE/GENERATED_CLOSURE=UNKNOWN。これは実証済みbuildではない。**
Issue [#420](https://github.com/tetsujisugimori-coder/memo/issues/420) / 先行 [PR #419](https://github.com/tetsujisugimori-coder/memo/pull/419) / 2026-11-05 JST。

## 1. 調査対象を一意に指定する

|軸|今回の固定した参照値|確定の限界|
|---|---|---|
|memo base|#419 HEAD `64861de4f35615f7f0351941314689c3588cfb02`|親ブランチを変更しない|
|Playwright参照commit|`26a9e470a7b3c7822084b09fb7f13902c5f37b51`|保存済みmetadataの固定参照。実実行プロセスのattestationではない|
|テスト参照環境|Ubuntu 24.04 x64 / WebKit revision 2336 / browserVersion 26.5|保存された版対応表の記録であり実binary hash未取得|
|source tree|WebKit `343e13bf22dca9d0ec227801419aab0f9001a32f`|PlaywrightのUPSTREAM_CONFIGのBASE_REVISION。適用後treeとは区別|
|port探索候補|Linux `pw_run.sh`の`--headless`分岐はWPE用探索先を設定（GTKは非headless側）|汎用MiniBrowser fallbackがあり、探索先の設定は実行binaryのWPE同定ではない。実exec path/digestと版同一性はUNKNOWN|
|機能構成|WPE headlessを**調査対象の要求profile**に限定|CMake定義、ENABLE/USE、CPU JIT/LLInt/Wasm、WebIDL/IPC生成物の解決済み値はUNKNOWN|
|C0|通常dedicated `WorkerDedicatedRunLoop::run()` の `WorkerRunLoop.cpp` L244/245間|同じsourceに到達する実buildかはUNKNOWN|
|契約|共通観測契約v1 blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`|判定器や既存資料の変更なし|

参照：[既存version-map.md](https://github.com/tetsujisugimori-coder/memo/blob/b64906439094b9f2bdfcc195fe7ec50895b5d2b4/design/idb-webkit-evidence/version-map.md)、[browsers.json保存bytes](https://github.com/tetsujisugimori-coder/memo/blob/b64906439094b9f2bdfcc195fe7ec50895b5d2b4/design/idb-webkit-evidence/inputs/pw-browsers.json)、[UPSTREAM_CONFIG保存bytes](https://github.com/tetsujisugimori-coder/memo/blob/b64906439094b9f2bdfcc195fe7ec50895b5d2b4/design/idb-webkit-evidence/inputs/pw-UPSTREAM_CONFIG.sh)、[pw_run.sh保存bytes](https://github.com/tetsujisugimori-coder/memo/blob/b64906439094b9f2bdfcc195fe7ec50895b5d2b4/design/idb-webkit-evidence/inputs/pw-pw_run.sh.txt)。
- 固定Playwright `26a9e470a7b3c7822084b09fb7f13902c5f37b51`の[runLinux L24–58](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/pw_run.sh#L24-L58)は、`--headless`ならL32–35でWPE用の探索変数を設定する。次に実directory/file条件をL41→43→48→50の順で判定し、L48–49には`$SCRIPT_PATH/MiniBrowser`という汎用fallbackがある。実際に呼ぶのはL72の`$MINIBROWSER`。保存bytesのblob `f4f0f4ce940fc78c9f62c56e9edd4c57ed501e1f`はこの固定Playwrightソースと一致した（読取り照合のみ、wrapperは実行しない）。
- **探索候補WPE、実際のbinary、版同一性は別命題。** directory条件、解決されたexec path、対象binary/ライブラリのdigestと起動記録がないため、headlessという入力だけでは実行物をWPEと確定しない。汎用fallbackのbinary種別も名前から決めない。本書はWPEを要求profileとして残すが、実行物はUNKNOWN。非headlessのGTK探索設定を今回の要求profileへ一般化しない。
- 保存版対応表ではPlaywright patch `bootstrap.diff`が353 pathに変更を持ち、採取した一部の上流参照ファイルに直接diffがないことまで確認済み。**間接変更、生成コード、Feature、ビルド成果物への影響がないという意味ではない。**
- 今回の研究では固定ソースで候補を追うだけで、archive・binary・patchの再取得、ビルドや実行は行わない。

## 2. 母集団の閉じ方と不足資料

|閉包単位|「PASS」とするには必要な証拠|現在|
|---|---|---|
|実際に使った実行物|fallbackを含む実exec path・起動引数・binary種別、WebKit/JSC/WebCore動的ライブラリ、実行ファイルdigest、archive digestの対応。WPEだったという前提を置かない|UNKNOWN|
|正確な入力tree|WebKit fixed commit + Playwright全patch（順序・適用結果）+ local変更なしのtree digest|UNKNOWN|
|build構成|Ubuntu24.04-x64 WPE専用設定、CMake cache、compiler/linker options、target/feature設定、platform macroと使用ライブラリ|UNKNOWN|
|生成ソース|対象buildのWebIDL generated bindings（`JSIDBTransaction`等）・IPC generator outputs・JIT/LLInt/assembly選択・generated task callbacksのmanifestとdigest|UNKNOWN|
|全入口・全writer|compile_commands又は対象buildの翻訳単位集合から、callers/callees/field writesと`CleanupTask` producerの完全列挙|UNKNOWN|
|同一incarnation|Worker/context/VM/JS/native tx・process/channel generationの生成/破棄と結合|UNKNOWN|

**重要：この6行は収集済みの証拠ではなく、次の入力契約である。** `BASE_REVISION`とWPE用探索変数の固定はsource候補の絞り込みに限られ、実binaryの選択・種別・版同一性や生成物の列挙を証明しない。build証拠を得ないままENTRY/WRITER_COVERAGEをPASSにしてはならない。インストールや実験が禁止の本工程では欠けた資料を推定で埋めず、`EXECUTED_BINARY_BINDING=UNKNOWN / BUILD_BINDING=UNKNOWN`とする。

## 3. 継承する制約
- E（最外退出）、F（同VMの禁止+全入口coverage）、T（正確なClient5状態）、I（完全ID/世代）、W（過去W1なし・C0より後の指定W1）、S（borrow～release区間の安全性）は**それぞれ別命題**。
- 既存の [入口・writer監査](c0-entry-writer-ownership-audit.md) のENT22群/WRT20群は候補集合であり、WPE全buildの閉包を証明しない。
- 後段cleanupでしか読めない値や別Workerに属する値をC0へ遡及しない。
- J2=UNKNOWN、U-C=UNKNOWN、conditionU=NOT_RUN、realExperiment=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLD。
