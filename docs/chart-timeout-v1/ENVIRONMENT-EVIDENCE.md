# 環境適格化の証拠調査 A–D と独立事前レビューの入力

2026-11-15 JST / Issue #457 / Draft PR #458。総合PARTIAL、移行NO、マージNO。
これは実ブラウザ実行の指示・許可ではない。固定4枠は全0回/NOT_TESTED、executionAuthorized=false、原因UNKNOWN。

## 固定点・実測環境

開始HEAD `252593951aee1dc76e1b86522082f7d1a2fc9258` / tree `7e05c14dd5b956afac0713ec9dd42fa8f0113f01` がGitHub/ローカルで一致。追跡ファイルclean、旧証拠は未追跡のまま保全。
AGENTS、PR/Issue、前回レビュー5910596244、preflight実装・PREFLIGHT/PREFLIGHT-RESULTSを読取確認。
固定対象 `87a5ac2f2dbbb940e8f4b4dd6269e5c349e75fc1` / tree `b28b20bfe6a5b21da39b2c010e0ea4be42437932`。
現在の実測はWindows_NT 10.0.26300、win32 x64、Node v24.20.0、配置済みPlaywright/core 1.62.1。
候補依存領域は共有親のnode_modulesで、既存診断器が要求するroot/node_modulesとは異なる。隔離側には依存を配置していない。
検査器のraw SHA/サイズ、候補realpath/SHA、環境変数は名前と存在だけを非公開原票に記録。旧環境レビューの流用ではない。

正式差分は追加の`compareLocks`、`parsePE`、`inspectPEGraph`、新規単体、本文/索引、専用CI一覧だけ。
既存preflightの判定、診断器/observer/P3、製品、元E2E、lock、30秒timeout・操作・assertionは変更しない。

## A. lockのraw比較と隔離

|項目|固定Git blob|作業版|
|---|---|---|
|bytes|44319|45582|
|SHA256|284777a48f5a357a603bd6916f5d86c2fa1e7cd43537442c0fcb62f478b85edb|0cb203dba6139b7a627d69ae494f3a5b2b6cc6fbd8e8b0ddd9a5b5053a5b33cd|
|UTF-8 BOM|なし|なし|
|LFのみ|1263|0|
|CRLF|0|1263|

メモリ内の比較によって、raw差分がこの1263個の改行差だけであると実証した。推定ではない。
JSON構造、lockfileVersion=3、package version、integrity、resolvedの差は0。lock内99 entriesにはroot/optionalも含まれ、前工程の配置metadata97件とは母集団が異なる。
raw判定は依然FAILであり、比較のための正規化を既存ファイルへ書き戻していない。

生成/配置経路：Git system configのcore.autocrlf=true、属性overrideなし、`git ls-files --eol`はindex LF/worktree CRLFを示す。
この現在の設定・raw差・配置方法の整合は確認したが、過去の全生成操作を遡及証明するものではない。
通常の`git archive`出力を別領域へ展開すると619ファイルでGit blobと不一致になった。最初の一致assert失敗をFAILとして保持し、検査を緩めて成功にしていない。
続いてさらに別領域を新設し、`ls-tree`で固定treeを列挙、`cat-file blob`のraw bytesを各新規ファイルへ直接保存した。934 regular blobの内容と宣言Git modeを照合成功。Windows実行権限の一致を意味しない。
隔離lockは44319 bytes・固定SHAに一致、固定chart source SHAも指定値に一致。原作業lockは保存前後で不変。

一致条件は「固定commit/treeをverifyし、Git blobを無変換で新規隔離領域へ取得し、全raw blob/lockを照合する」こと。
この新しい隔離コピーのPASSを、元worktreeのFAIL解除へ流用しない。既存run()のarchive経路を今回書き換えたわけでもない。
隔離依存は未配置でBLOCKED。将来は、このraw tree/lockに対応する依存の配置・全byte帰属を別途固定して再検査する必要がある。
npm install/ci、既存lock修正、既存ファイルの改行変換、symlinkによる依存配置は0。

## B. 公式取得経路・期待digest

Playwright公式tag v1.62.1はcommit `26a9e470a7b3c7822084b09fb7f13902c5f37b51` に解決した。
[browsers.json](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/browsers.json)と[registry](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/registry/index.ts)等の一次sourceを保存し、5ファイルのGit blob一致を確認。
ローカルbrowsers.jsonのraw SHA `f306eed529599b1eaf2f8a85db9de2b23e1a3fe36c2b66434b7c9434fb627a99` は公式sourceと一致。これはmetadataの一致であり、配置package全byteやbrowserの真正性を認定しない。
一次情報取得は2026-11-15 12:55 UTC台。URL、HTTP状態、日時、body size/SHAを原票に保存。後取得sourceを旧CI実行時捕捉に格上げしない。

Windows x64の公式対応を個別に確認した（archive本体は読まず、HEADのみ）。

|対象|宣言revision/build|経路と応答|Content-Length / 型|期待SHA256|
|---|---|---|---|---|
|Chromium通常|1234 / 151.0.7922.34|cdn.playwright.dev/builds/cft/.../win64/chrome-win64.zip →307→ storage.googleapis.com/chrome-for-testing-public/... →200|201068834 / application/x-zip-compressed|UNKNOWN|
|headless-shell|1234 / 151.0.7922.34|同CFT経路のchrome-headless-shell-win64.zip、307→200|120106945 / application/x-zip-compressed|UNKNOWN|
|WebKit|2336 / 26.5|cdn.playwright.dev/dbazure/download/playwright/builds/webkit/2336/webkit-win64.zip →307→ playwright.download.prss.microsoft.com/dbazure/download/playwright/builds/webkit/2336/webkit-win64.zip →200|62478226 / application/octet-stream|UNKNOWN|

[Chrome for Testingのversion metadata](https://googlechromelabs.github.io/chrome-for-testing/151.0.7922.34.json)でも通常/シェル/OSごとのURLは別である。
GoogleのHEADは通常MD5 `hiZffifu4qIqffQE7WlSAQ==`、shell MD5 `/BiaqS/vFlhkgTISwTFIhw==` を返した。これは独立したserver metadataとして記録するが、弱いMD5を信頼できるSHA256や署名に読み替えない。
WebKitの長いETagはopaque validatorであり、64桁に見えてもSHA256と解釈しない。
headerのsize/型は配布metadataで、取得archiveの実サイズ・構造・CRC検査ではない。archiveBodyBytesRead=0、browser新規download/install/展開配置は0。
調査したsource/CFT metadata/HEAD内で、browser archive用の信頼できるSHA256・署名・attestationを確立できなかった。存在しないと一般断定せずUNKNOWNを維持する。
[npm metadata](https://registry.npmjs.org/playwright-core/1.62.1)のintegrity/signatures/attestationsはnpm packageが対象であり、browser archiveの期待値へ転用しない。今回署名検証もしていない。

OS overrideはmac14/mac14-arm64=2251、ubuntu20.04-x64/arm64=2092。registryのoverride/special-prefix処理を確認。Win64の2336を旧Ubuntuへ代用しない。
現在調べた標準経路が、過去のローカル取得経路そのものであったとは証明できない。過去の取得原票・archive原物は引き続き不足。

## C. 実行物とOS依存

[Chromiumの選択条件](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/src/server/chromium/chromium.ts)はchannel指定優先、指定なしでheadlessの場合はheadless-shell。
固定runnerはheadless=true、channel/executablePath指定なしで、既存診断generatorが1194 fallbackを除去する条件を維持。
Windows候補は`chromium-1234/chrome-win64/chrome.exe`、`chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe`、`webkit-2336/Playwright.exe`を別々に検査した。
size/SHA/realpathとPE architectureは原票に固定。期待hashとの対応が未確立なので、実起動物の同一性はUNKNOWN。

|候補|root直接import|root delay-load|推移候補node|候補edge|上限到達|
|---|---:|---:|---:|---:|---|
|Chromium通常|4|12|243|9880|なし|
|headless-shell|7|46|256|10482|あり|
|WebKit|21|0|256|9420|あり|

新検査器はPE bytesだけを読み、delay directory、direct import、関数名の静的候補、architecture、certificate tableの有無を分離する。certificate有無は署名検証ではない。
直接/推移的DLL候補を再帰収集するが、同名複数候補を1つに決めない。API-setや動的LoadLibrary、SxS、KnownDLL、loaded module、package graph、PATH/current directory、AddDllDirectoryの効果はUNKNOWN。
「検査したディレクトリにない」は全OSでの不存在や実loader失敗とはしない。graph全体はUNKNOWNのまま。上限は256 node/12階層/総読取2GiBで、不完備な閉包をPASSにしない。
[MicrosoftのDLL探索資料](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order)にある探索条件との対応・未検証箇所を記録した。Windows ACLはSDDL hash/規則数だけを読取り、実効token/deny/AppLocker等の実行可否はUNKNOWN。

[WebKit wrapper](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/pw_run.sh)はLinux headless時にWPE系候補へ分岐し、配置/開発treeによってMiniBrowserの候補が異なる。
関連環境変数名はWK_CHECKOUT_PATH、HOME、LD_LIBRARY_PATH、GIO_EXTRA_MODULES、WEBKIT_INJECTED_BUNDLE_PATH、WEBKIT_FORCE_COMPLEX_TEXT等。macOS分岐はDYLD_FRAMEWORK_PATH/DYLD_LIBRARY_PATHを使う。
Windowsはshell wrapperではなくnative Playwright.exe候補で、[WinMain source](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/embedder/Playwright/win/WinMain.cpp)を保存した。source対応が実binaryのbuild帰属を証明するものではない。
Linux実環境/対象ELFは今回未提供でUNKNOWN。interpreter、NEEDED、RPATH/RUNPATH、cache、推移依存は実測していない。
[ld.so資料](https://man7.org/linux/man-pages/man8/ld.so.8.html)と既存のreader mock対照は確認したが、Windowsの結果をLinuxへ流用しない。最小の次工程は、既存browserを持つ対象Linux環境の読取専用識別とELF/header/cache調査である。
browser、wrapper、loader、ldd、winldd、`--version`の実行は0。

## D. 原artifact15件の選別監査

[機械可読索引](environment-artifact-index.json)でrun/job/artifact ID、作成時刻、対象HEAD、取得状態、優先順位と理由を固定。
対象run43712199551 / HEAD2525939…、分類A=0/B=2/C=2/D=11。job紐付けは未取得分はworkflow upload step/name対応に限り、raw upload logで検証済みとはしない。
専用preflight CI原artifactは0件。15件の中にbrowser配布archiveやpreflight実行物identity原票があるとはしていない。

|取得した原ZIP|分類/目的|bytes / SHA256|照合|
|---|---|---|---|
|14160723895 received-recovery-windows|C、Windows CI補助結果|1691905 / f0e9e3e166c69a054f6989cdf3d897f9313abcb38cc48cce5b1511b29e3f7dff|公式digest一致、35 entries全CRC成功|
|14160937293 report-fixed-webkit|B、実行時results.jsonのrepo SHA/node/platform帰属|23636099 / 81a6a4a8db33a87509088c829241ae7c04c38bddc0723d241d6088e25d43c3ca|公式digest一致、全CRC成功|

原ZIPは再圧縮せず新規保存。両jobの公式upload logでIDとdigestが一致。内包manifestは両方NOT_OBTAINEDで、後作成manifestを原manifestにしない。
WebKit原results.jsonはLinux/Node v22.23.4/repo SHA d01d29398c5b740a779c9eb37b558546d4716c82を記録。このmerge treeは基準2525939と同じ7e05c14…だが、固定87a5ac2の実行証拠やELF/ブラウザ実体hashではない。
Chromium側の大きいB資料は重複補助として未取得、Cの採番画像も今回の環境判断には不要として未取得。計13件はNOT_ACQUIRED_UNAUDITEDのまま。
外部保存先は本人承認済みの指定が未確認。外部保存後の実再取得ができるまでexternalReacquisition=NOT_VERIFIED、preservationComplete=false。
既存資料の移動/削除/上書きはしていない。一次source、原Actions ZIP、decoded log、後取得Git source、後作成補足を分離する。

## 検証・反例・レビューへの引継ぎ

新14＋既存preflight55＋既存診断38＋Chart utils217＝324件成功、skip0。構文とgit diff --check成功。
delay-only PEを既存direct-only parserが列挙しないREDを固定し、同じbytesで追加parserがdelayを列挙するGREENを確認。既存parserはdirect-onlyと明記済みであり、旧製品障害の反例とはしない。
実測headless-shellのbthprops.cplをDLL専用suffix判定が拒否したため、DRV/CPLの正常対照とpath拒否を新設。RED13成功/1失敗→GREEN14成功を保存した。
正常/故障JSON、旧失敗graph/通常archive不一致、各版の検査器SHAを保持し、期待値を緩めたりskip化していない。
工程A–D固定後の独立レビュー、提出HEAD/tree/CI最終状態はPR追補で記録する。事前レビューPASSでも実行許可ではない。

現在も元worktreeのraw lock FAIL、依存未配置BLOCKED、公式archive強い期待digest/過去取得経路/実launch chain/推移依存/実行ACL UNKNOWN。
固定4枠はChromium legacy/WebKit legacy/Chromium narrow/WebKit narrow全てexecutions=0、status=NOT_TESTED。
解除には証拠を満たした環境の独立事前レビューと本人の別途明示指示が必要。マージNO、Draft維持。
