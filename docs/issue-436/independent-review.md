# Issue #436 独立証拠監査

独立担当 `/root/independent_review`。対象調査commitは `9c344ede39696b0ad0b9696005c6d1c82ca902a4`。
固定製品HEADは修正版 `478d8b3ea59b242e4ddd5cc82e12b44169223047`、旧版 `8f35ca25001ffa031abfd304dd2a5e9a3d9197dd`。
実装担当の結論を転記するだけでなく、ローカル原JSON・JSONL・manifest・ログ・終了コード・画像・展開ソースを読み、SHA256を再計算した。
追加ブラウザ実行、GitHub変更、製品コード変更は実施していない。

監査時点の総合判定は **PARTIAL、原因特定はUNKNOWN、Windows全受入未完了、マージ推奨NO**。
局所的な待機区間の特定と、製品・ブラウザ・環境・runnerをまたぐ根本原因の特定を区別する。
専用CI `42614097846` の原artifactはこの初回記録時点では未受領で、Linux/CI Windowsの結果をここで先取りしない。

## 実施した独立照合

- 有効な5診断runの `sourceHashes` 全ファイルを、`git cat-file --batch` で得た固定HEADのblobおよび展開済みファイルと再照合。修正版各319ファイル、旧版各307ファイルで不一致0。
- JSON・JSONLの構文、manifestのsource/runner HEAD・診断SHA・exit・expiredと、原結果・run.logの一致を確認。
- 完走5runの原evidenceを `evaluateSafety()` で再判定し、保存済みacceptanceとの完全一致を確認。修正版3runは方式B、旧版2runは編集消失を実測したRED。旧版のexit1を製品PASSに変更しない。
- PNG signature・寸法・SHA256を確認。timeout画面、passive競合画面、再開旧Chromium画面を実際に表示し、JSONとの意味上の整合を確認。画面だけから永続保存の成功を判定しない。
- 合成境界3件と計測契約4件を再実行し、7 PASS / 0 FAIL / 0 SKIP、exit0。実ブラウザ受入の件数には算入しない。

## ローカルrun別判定

すべて `e2e-artifacts/issue436/` 下。各runは1280px/ABの有限SMOKEであり、375/390pxや既存ガイド20件の今回の再受入ではない。

| run | 製品結果・exit | 独立確認した到達範囲 | 限定 |
|---|---|---|---|
| `original-webkit` | PASS / 0 | 無計測、方式B、reload・全タブclose/reopen・原稿書出し・再競合・明示解決完走 | 独立archive manifestはない。結果の固定HEADとrunner HEADは478d8b3。過去のtimeoutを無効化しない |
| `win32-fixed-webkit-passive` | PASS / 0 | 方式B、同上の完走、`execution.completed=true` | passiveも時間的に無干渉とは限らない |
| `win32-fixed-webkit-deep` | FAIL / 1 | 初期競合とreload後、全タブclose後page3のattached待機で10秒timeout | 回復・明示解決は未到達。原因UNKNOWN |
| `win32-fixed-chromium-deep` | PASS / 0 | 方式B、reload・close/reopen・書出し・再競合・明示解決完走 | 単一条件の成功 |
| `win32-old-webkit-deep` | FAIL / 1、旧RED成立 | `execution.completed=true`、`lossDemonstrated=true`、両reopened UI/全列挙永続領域から一方の編集が消失 | timeoutをREDと数えたのではない |
| `win32-old-chromium-deep-resumed` | FAIL / 1、旧RED成立 | 同上、`observedRollback=true`も原JSONから再確認 | 中断前の試行を置き換えない |
| `win32-old-chromium-deep` | NOT_TESTED / UNKNOWN | 有効manifest・原resultsなし | 下記の破損を確認。exitや完走を推測しない |
| `win32-transport-webkit` | 合成3条件COMPLETE / 製品NOT_TESTED | routeあり/なし、全元タブclose、sentinelありをそれぞれ完走 | アプリ・IDBなし。今回の低頻度遅延は再現せず、製品根本原因の証明ではない |

修正版完走runではreopened Aが保存済み本文、Bが競合原稿通知を表示し、両者のDB確定本文は一致する。Bの原稿は独立storeと拒否receiptで保全され、UI操作で書出した28byte原文のSHA256は全3runで `a864a1640f3bfdda75a676499c4aaa020f28db13787a48577a2b5e3aec7f8033`。
旧版完走runでは両reopened UIとDBがB本文だけとなり、方式A/Bとも不合格。原JSONの `lossDemonstrated=true` を独立再計算で確認した。

## timeout原資料から言えること

`win32-fixed-webkit-deep/timeline.jsonl` のpage3を再集計した。以下はbrowserのtimeOrigin基準の値で、Node受信順をイベントの発生順と同一視していない。

| 区間・イベント | navigation開始からの時刻 |
|---|---:|
| init開始 | 15,323 ms |
| `await openDb()`開始 | 15,343 ms |
| IndexedDB open呼出し | 15,344 ms |
| DOMContentLoaded | 15,368 ms（NavigationTiming開始は15,367 ms） |
| load | 15,369 ms |
| IndexedDB success / `await openDb()`終了 | 15,387 ms |

`await openDb()`の実測は44ms。reload後ではなく、全元タブ終了後に作られたpage3で、10秒の失敗箇所は `note-conflict-test-support.cjs:40` のguard **attached** 待機だった。
複数JS/CSSのrequest start→finish通知間には約14.7秒の間隔があり、アプリのinit自体が10秒観測窓後に始まっている。
このrunは「IDB openで10秒停止した」という仮説を支持しない。

timeoutをNode側が記録したのは `12:21:42.092 UTC`、snapshot受信は `12:21:46.701 UTC` で約4.609秒後。
snapshotの `readyState=complete / guard busy=true / currentId=null / notes=0 / request.readyState=done` は、この遅れを含む観測であり、timeout瞬間の状態ではない。
page3は初期化継続中に試験の後処理で閉じられ、guard解除・編集可能化・保存/回復の完了は確認されていない。永久停止やデータ消失をここから推測しない。

## 計測コードの独立レビュー

初回診断SHAは `3c3c4e0dec8cf5b846ef37d9c50ecfbf90495fd926e64991e15a2be0812192e0`。
この版ではdeepのblocked listenerがpending requestの `error` getterを読み得る問題を独立担当が指摘し、合成pending requestで `InvalidStateError` とT7 stamp欠落を再現した。
主担当が観測コードだけをsafe readへ修正。現行診断SHAは `a8995f1a26b219fff8c1587648c28e3178641c4631ca703a25a551a7e685a9b4`。

初回fixed WebKit deepおよびpassiveのmanifestは旧診断SHAを保持しており、後から現行SHAへ付け替えていない。
初回deepの原timelineは1,011行すべて解析可能で、`page:error` / `decode-error` は0。観測したopenはupgradeneeded/successで、blocked stampも記録されていない。
したがってこの特定runに計測例外の実発生証拠はないが、旧版listenerの制約は残る。旧版traceを一般的なblocked非発生の完全証明として扱わない。
passiveでは製品source注入をしないため、このdeep listenerの欠陥を実行しない。

現行4件の合成試験はpending blocked/upgradeでerror読取り0、元のcallback実行、success resolveとversionchange→close順を確認した。
`instrument(app.js)`から同期stampだけを除去すると元sourceへ完全一致し、追加await・保存関数/280msタイマー/BC/IDB writerの差替えはない。
ただしDOM MutationObserver・console・同期JSONL書込み・ready/error後snapshotはrunner/browserの処理時間を変え得る。無計測・passive・deepの成功率差は、現段階では因果関係ではなく相関である。
一般writer transactionの開始/complete/abortを網羅的にtraceしたわけではなく、接続が開けたこととアプリ利用可能化の完了を区別する。

## v6 revision欠落の追加境界

`resumeConflictDraft()`の `Math.max(stored.revision, ...)` はrevision欠落時に一時NaNを作るが、直後の `markLocalMemoDirty()` → `registerNoteSaveState()` で0へ正規化され、実foundationの `markChanged()` により1になる。
独立合成試験は実関数抽出＋実foundation/storeを用い、競合→fixture永続原稿→新VM reload→明示再編集→CAS保存を確認した。CAS基準はrawのrevision欠落を保持し、保存はrevision1、未知metadata保持、解決系列確定を確認。
再編集後の外部更新は再拒否・新系列保全となり、不正revision（null/文字列/負数/非整数/NaN/Infinity/unsafe）は再編集前に拒否される。
この境界で反例は成立せず、既知P2とはしない。製品修正なし。
合成DOM/IDB scheduleを使用しており、実ブラウザのv6競合回復経路完走とは区別する。

## 中断試行・文字コード・原資料の扱い

中断した `win32-old-chromium-deep` はmanifest 32,602byteが全NUL、results.json欠落、timeline 144,307byte中143,797byteがNUL。
terminal PNG両方も全NUL（120,969byte / 108,036byte）でPNG signatureがなく、画像証拠として成立しない。
一部JSONL行やtarの存在だけからsource照合成功・実行完走・終了コードを復元しない。中断原因や破損原因もUNKNOWN。
別ディレクトリのresumed runは有効な新試行であり、中断試行を成功へ読み替えない。

`original-webkit/run.log` はUTF-16LE BOM付きPowerShell出力。正しくdecodeすると固定HEAD・PASS・方式Bが原JSONと一致する。
このログ内のNUL byteはUTF-16LEの符号化によるもので、全NULのmanifest/PNG破損とは区別する。

## 再計算した主要SHA256

下表は監査時点のローカル原ファイル。原資料一式の保管・公開先・期限は主担当の最終evidence manifestへ併記する必要がある。
ローカルのignored領域には保存期限保証がない。専用CIの設定は14日だが、artifact ID/正確なexpiryはアップロード後の読戻しが必要。

| run | results.json | manifest.json |
|---|---|---|
| original-webkit | `3764e68e2305f7cc420e80ba7c0428c66b3a04c77153885d4bc3b7ab7180798b` | なし |
| fixed-webkit-passive | `7f1d83fc8a0339b4966584fe399701e9350b04d17eef266c15ae1e1538c220e6` | `ec6182a3b0043e1347b50d94a68329fbbca5f51fefb10a21c4785423022bd340` |
| fixed-webkit-deep | `acbdfe4ad35acec50227153e3abcd993eb2c9f26a321ae2b263cb029ba8fec71` | `d4ccb4a2c10eca7a306633f495c5e68dc885cc332720b4c015c89a24217a6fe0` |
| fixed-chromium-deep | `ef03ea47a3ba99d82ddfe94515f84517ddc8c455ba5e21a7c3b57fe462dbfb7d` | `bdc15404fc32098f143efe996e85aa692f10ba07738a41324d33abc7c1a330ef` |
| old-webkit-deep | `b0e75ebb65e9221548c70cc0a3e43d0ca6d9db39ea90d3834d975721f27e1cda` | `9869554547b96fcfc0d992a70fca669891aef6457d0be77068371b27fc4e1c91` |
| old-chromium-deep-resumed | `ad4e5391b8de75ea75f0d6c6a8d742824374f5c804fcbee56c992b910464771e` | `790e18510ceb39ba4f74a2c2ea3ce734790d12ad7f822b02214d5fe6e5bffa72` |
| old-chromium-deep 中断 | 欠落 | `8eb98367162b5b246b79c0c89e667507a898e2ef6a4b18b614aee8a43f3d5e73`（破損物の識別のみ） |
| transport-webkit 合成 | `85d98f450ffffceb0d984e5330d6d1a17e7607fc13180015785adde9b852a69b` | なし |

| run | timeline.jsonl | run.log |
|---|---|---|
| original-webkit | なし | `b9c030320e0e297e9151f1599b38f4adcce87bbf52f080a5a4c57ff7f2cde211` |
| fixed-webkit-passive | `870a57c5c643e34a6e2cffad5fdca294a3a48a18d9e7f02539baa1ddb5d2dec2` | `80dc4a64fbafc5962b673e4a2c95e00c48fcbadd6e763f7254391533d8af3bda` |
| fixed-webkit-deep | `aded2cd1e3a9eca2924a2a7075f78b429caea89fd945e288d9e942d6aeb17044` | `fa51a21031de57c251f929bcf7e6f0b63961b69eed9f467cb0231104cdb42efa` |
| fixed-chromium-deep | `74d0269b7379052c2be93edba31c69bbadc7a212170c6d1ab90e34d07e95d6d0` | `0a8af52d5b0dcd8d4a46b47f5f93ffbbfe77bd7fbd702d783f4d799b9d91cc0c` |
| old-webkit-deep | `c64d26fdae9b3892f5c91edf3947e2b643be451f6aac155dc102af9e82e47c50` | `75e4685bec1f629ed4956d74321e7baef678b9dec97fff30966e405e44e1fee7` |
| old-chromium-deep-resumed | `ac93457d99a0840ef046b8a06720fb90348e2b38051bb18380b552815b4e38e3` | `63916b66cbc67e41ba78e038a2f8f4d2fc3e948fdbb0d0fa850d26a6d72873e7` |
| old-chromium-deep 中断 | `c9efd737ac01960007b3fe7e873711735e184c1a6e7b6b9745d3d8789037ea8b`（破損） | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`（空） |

表示確認したPNG:

- deep timeout-3.png / 同run failure.png（同一bytes）: `85e3473d37f9dbee4ceacbe48938a41aaba958500deda4411991494840def156`
- passive WebKit AB-1-terminal.png: `5f11b164eb568d5951acb46e2466b9ea6dddbd57d893e75317ac3cbd97274afb`
- resumed旧Chromium AB-0-terminal.png: `fa9b3d4a057fb2f42f51b1656b78e0cff5be566833902269594f6f934952aee6`

## 未解決と再受入

単一の既存未完了条件が今回は無計測/passiveで完走したことは確認できるが、安定化の因果介入や製品修正は成立していない。
Windows全条件、ガイドの過去timeout、v6経路の実ブラウザ連続完走を今回すべて再受入したとは扱わない。
A 製品、B ブラウザ/Playwright、C Windows資源/プロセス、D runner/観測の帰属はUNKNOWN。今回のpage3についてIDB開始前の遅延へ局在化できたことまでが確認範囲。
メモリ空きと失敗の相関だけでCを根本原因としない。transport合成3条件COMPLETEだけでB/Dを棄却しない。

J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLDを維持。
実利用者データ・実MCP/OAuth・Worker停止/復旧・本番切替を実施していない。マージ・公開は推奨しない。

2026-11-09 21:08:55 JST（ローカル原資料の独立監査）

## 専用CI原artifactの追補独立監査

[run 42614097846](https://github.com/tetsujisugimori-coder/memo/actions/runs/42614097846)、
HEAD `9c344ede39696b0ad0b9696005c6d1c82ca902a4` のLinux/Windows両job原資料を受領後に独立照合した。
初回記録のCI未受領は、この追補の確認範囲について解消した。

| OS・原artifact | artifact ID | 原ZIP SHA256 | API保存期限（UTC） |
|---|---:|---|---|
| [Ubuntu 24.04](https://github.com/tetsujisugimori-coder/memo/actions/runs/42614097846/artifacts/13671523018) | 13671523018 | `142e638cd0ac6362b4876ba007f1206ac475ed3f519b479b95c5a7fc580461d8` | 2026-11-23 12:07:11 |
| [Windows latest](https://github.com/tetsujisugimori-coder/memo/actions/runs/42614097846/artifacts/13671273677) | 13671273677 | `2894bf34593063ffbdf7148faa1a7cb3b46fc23ccb075b1681a03b86191bd596` | 2026-11-23 12:10:38 |

両ZIPのSHA256を独立再計算し、保存済みAPI応答のdigestに一致。APIのworkflow run HEADも対象commitに一致し、expired=false。
各ZIP32ファイルをすべて展開先とbyte照合して不一致0、ZIP CRC検査も問題なし。
原資料場所は `e2e-artifacts/issue436/ci-linux-artifact.zip` / `ci-windows-artifact.zip`、展開先はそれぞれ `ci-linux/` / `ci-windows/`。

8診断runのmanifestはsource HEADを正しく新旧に分け、runner HEADはすべて対象commit。sourceHashesの全319/307件を固定Git blobと再計算し、不一致0。
CI artifactにはsourceディレクトリとtarを含めない設定のため、ローカル監査のような展開ソース全bytesの再照合は実施不能。
ここで独立確認したのは、runnerが記録した全source hashの固定blobとの一致と、実際の注入配信対象2ファイルのsource/served hashである。
全runの `app.js` / `indexeddb-lifecycle.js` 配信hashを固定blobと現行 `instrument()` から再計算し、一致を確認した。

診断runnerの原bytesはOSごとの改行差を保持する。

- LinuxおよびGit blobのLF版: `a8995f1a26b219fff8c1587648c28e3178641c4631ca703a25a551a7e685a9b4`
- Windows CIのCRLF版: `631f63813a8461c970736e3220b27364506cc719c9783ebd06f480bd9242ba0d`

Git blobのLFをCRLFへ変換して後者を独立再現した。このhash差を不明な実装変更や原資料破損と扱わず、同一hashへ書換えもしない。

| OS | 固定修正版2engine | 旧版2engine | 合成・transport |
|---|---|---|---|
| Linux | 各exit0、方式B PASS、completed=true、再競合/明示解決PASS | 各exit1、completed=true、lossDemonstrated=true、製品FAIL | 原job logで合成7/7 PASS、transport3条件COMPLETE、製品受入NOT_TESTED |
| Windows CI | 各exit0、方式B PASS、completed=true、再競合/明示解決PASS | 各exit1、completed=true、lossDemonstrated=true、製品FAIL | 同上 |

各原JSONのevidenceを `evaluateSafety()` で再判定し、全8件とも保存acceptanceに完全一致。
新4件ではreload/reopen後の永続原稿・実UI書出し・明示解決・再競合の原assertが完走し、旧4件は編集消失を実測したRED。
各manifestのexit・expired=false、supervisor比較結果、原job logの各childExitが一致し、timeout/中断をREDへ数えたrunはない。
各timeline全行が解析可能で、page:errorは全8runで0。PNG16枚のsignatureが有効で、全ZIP原bytesと一致。
CI Windows修正WebKit・旧WebKit、CI Linux修正Chromium・旧Chromiumの4枚を実表示し、原稿保全/保存本文・旧版上書き状態と原JSONの意味が一致することを確認した。

原results.json SHA256:

| OS | variant / engine | SHA256 |
|---|---|---|
| Linux | fixed / webkit | `1a57919b9abc3bb8c26e38305f57f260f33dbf8628378d356125506ed6a33512` |
| Linux | fixed / chromium | `33691e361cc4b495c334a98d2ac82ead9469a30f30d4a92ebff345ff6de2260c` |
| Linux | old / webkit | `82cd30e96fd4d43d6bee8e23a7a95fcf6e14896a9bd1715eadee15e8bc3519a1` |
| Linux | old / chromium | `31ebbeac65120eb7ca55c08e30bed3f27ab3d5907213359bb5e786cab8894343` |
| Windows CI | fixed / webkit | `090ac440f96f5f546360662cdb67978474f307b3ec40eead4987916e6d6b4789` |
| Windows CI | fixed / chromium | `63a48481157781700c2327eae4a379a1cc4d6f5605feff8b5a91a67d9365785e` |
| Windows CI | old / webkit | `b19b0afbaf7617868b7fe6f3b96183a010e98784dd779f197c21f82aa6f760ad` |
| Windows CI | old / chromium | `3997b66960fb7d447671df5cdb0ab18a6e05bd549f62c5dc79a0aed39502178b` |

原job log/API応答のSHA256:

- `ci-linux-job.log`: `2f51029c2e9375a4cfb7a7389cf2711b89c07d382fd2d06ab7b4c25fc6a61926`
- `ci-windows-job.log`: `ab14c72c3224b726cf077130db83bb8c39e2fdf23d5695d173a7c140136cbb9e`
- `ci-artifacts-api.json`: `a7bbd927aaed30aa93a4a0c47190892ead8759ed0070f2d7e4d795b963b763c4`

`report.md`全体も独立確認した。原因UNKNOWNと局在化を区別し、今回のCI単一条件完走をWindows全10件/既存guide20件の再受入へ一般化していないため、過大主張の指摘はない。
CIの有限比較は確認範囲で完了したが、ローカルの失敗runは撤回しない。安定化の因果介入、根本原因の帰属、一般Windowsでの発生率はUNKNOWNのまま。
**総合PARTIAL、原因特定未達、製品修正未実施、Windows全受入未完了、マージ推奨NO**を維持する。

2026-11-09 21:13:40 JST（CI原artifact追補監査）
