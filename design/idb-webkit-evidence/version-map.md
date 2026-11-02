# 対象版・参照ソース対応表

判定 **PARTIAL**。保存済み依存・download記録と固定metadataの対応は確認した。
配布バイナリ全体、パッチ適用後の全ソース、実行時挙動との同一性は **UNKNOWN**。
「WebKit 26.5」だけを同一性の根拠にしない。

## 固定識別情報

|対象|直接確認した事実・固定識別情報|根拠（保存file／行・節）|一致範囲／未確認範囲|
|---|---|---|---|
|D/E|実行commit `53445474028601131136e2bc540ee48aee83cd7a`、CI `41299732744`、Ubuntu24.04、download v2336|継承 `experiments/idb-upgrade-lifecycle/evidence/index.json`、`job.log.gz` 展開L17,1382,1394|記録上の取得対象。実行ファイルhash・起動時実体は未取得|
|F|実行commit `6b25f7ecf1d3b290958556708fee9899f188c5f2`、CI `41303212794`、同download|継承 `experiments/idb-transaction-complete-only/evidence/index.json`、log L17,1378,1390|完了後停止の記録。Uの証拠ではない|
|G|実行commit `b08c0f8b73ec4184478669fb4ac5907be83dbb52`、CI `41316288566`、同download|継承 `experiments/idb-time-delay-only/evidence/index.json`、log L17,1373,1385。展開bytesを `inputs/saved-G-job.log.txt` 保存|固定1ms・全件complete後という旧評価を維持。download成功はバイナリ同一性証明でない|
|lock|Playwright / core **1.62.1**、npm解決URLとSRI|固定baseの [package-lock.json L888–917](https://github.com/tetsujisugimori-coder/memo/blob/a72e0657d07632926d2ace9bcd7836cfbc41ac13/package-lock.json#L888)、無変換copy `inputs/memo-package-lock.json`|依存宣言・integrity文字列を確認。今回npm tarball検証・npm ciは実施しない|
|依存ソース|tag v1.62.1をcommit **`26a9e470a7b3c7822084b09fb7f13902c5f37b51`**に解決|`records/playwright-tag.json.gz`。以下はすべてこのcommit固定|tag解決と取得bytesの保存。配布npm全体とrepo treeの一致は未検証|
|browser metadata|webkit revision **2336**、browserVersion **26.5**。mac14=2251、Ubuntu20.04=2092 overrideあり|[browsers.json L45–58](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/packages/playwright-core/browsers.json#L45)、`inputs/pw-browsers.json`|Ubuntu24.04ではdefault 2336。別platformを同revisionに丸めない|
|上流設定|WebKit repo、BASE_BRANCH main、BASE_REVISION **`343e13bf22dca9d0ec227801419aab0f9001a32f`**|[UPSTREAM_CONFIG.sh L1–3](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/UPSTREAM_CONFIG.sh)、`inputs/pw-UPSTREAM_CONFIG.sh`|ビルド用参照上流を特定。v2336 archiveをこの全構成で作ったというattestationは未取得|
|パッチ|固定依存commitのbootstrap.diff、353 pathを変更|[bootstrap.diff](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/patches/bootstrap.diff)、`inputs/pw-bootstrap.diff.gz`|取得した25参照ソースpathへの直接diffは0。embedder・JSC・Inspector等は変更される。間接影響と全build構成は未確認|
|Linux起動wrapper|headlessならWPE、それ以外GTKを選ぶ記述|[pw_run.sh runLinux節](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/pw_run.sh#L31)、`inputs/pw-pw_run.sh.txt`|wrapperの分岐という事実のみ。対象archiveの実体・compile flags・動的ライブラリはUNKNOWN。起動なし|
|新参照ソース|上流 `343e13b…` のWebCore IDB/Worker等25ファイル|`inputs/source-index.json` に固定URL・commit・Git blob・SHA-256、各 `wk-*.txt`|静的読解対象として固定。C++をビルド・実行しない。配布物の全実装対応とはしない|
|#401旧参考実装|上流 `dddaa9bb93f1061268dc42f5f5bdd01dcc34e065`|継承 `design/idb-incomplete-stop/sources.md` 実装節・`records/inspection.json`|今回metadata由来revisionとは異なる。旧取得hashはBOM/host改行変換付きで、新bytesと直接同一判定しない。旧資料は不変更|

保存済み各実行commitのpackage-lockはbaseのlockとGit blob一致を別途記録する
（`records/version-audit.json`）。CIのnpm ci記録・取得先・結果表示版を合わせた推論として、
このmetadataの指す2336が調査対象として適切と判断する。ただし起動バイナリの選択実体まで
固定されたとは言わない。元PoCやWindowsの同表示版まで今回の対応を拡張しない。

download URLは `https://cdn.playwright.dev/dbazure/download/playwright/builds/webkit/2336/webkit-ubuntu-24.04.zip`。
archiveや実行バイナリのhashは保存証拠から得られずUNKNOWN。今回downloadしない。

## 有限取得と限界

固定版GitHub contents APIのbase64を直接復号して保存した。`source-index.json` の
初回404二件は同じcommitの `shared/` で解決し、取得失敗履歴を削除していない。
PlaywrightのREADME/BUILD_NUMBER/prepare_checkout想定pathは404で、別版で代用せず終了。
取得日時と欠落は `records/acquisition.json`。GitHubコネクタ利用不能後、ghのGETで取得した。
必要一次資料は取得できたが、build attestation・対象バイナリ・全IPC構成は欠落のまま。
ソースの一致pathやSHAは意味上の証明・U成立・実験承認ではない。
