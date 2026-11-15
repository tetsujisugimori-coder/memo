# ブラウザ環境の非実行preflight

Issue #457 / Draft PR #458。これは固定診断4枠の実行許可ではない。
製品、既存E2E、既存診断器、observer、P3分類、依存lockは変更しない。
固定4枠は各1試行の計画だけを検査し、実行回数0 / NOT_TESTED、原因UNKNOWN、マージNOを維持する。

## 固定入力

- 診断器基準HEAD `a4115eab8d4b5c26ab0177c84b6d92f10534647a` / tree `17b35016ee9efcbe5620be998c4795ea5ceda42b`。
- 診断対象HEAD `87a5ac2f2dbbb940e8f4b4dd6269e5c349e75fc1` / tree `b28b20bfe6a5b21da39b2c010e0ea4be42437932`。
- `chart-block.e2e.js` raw SHA-256 `240e906757c2514864cf1f2150cf4dfb5423abb8ba2030673ca80c49ad3a4722`。
- 固定lock raw SHA-256 `284777a48f5a357a603bd6916f5d86c2fa1e7cd43537442c0fcb62f478b85edb`（44,319 bytes）。作業treeのlockと実バイト比較し、改行変換も不一致として停止する。自動修復しない。
- 診断器Git blob `3287599bd10f9e24aa85d22c443d4c17a0338f9d`、observer Git blob `2ca7d3198013a805d0dda411cbef5f58edbf2338`。
- 固定lockはPlaywright / playwright-core `1.62.1`を要求する。要求revisionの整合性対照はChromium / headless-shell `1234`、WebKit `2336`。この対照は配布物の真正性証明ではない。

## 実施方法（ブラウザ操作なし）

親ディレクトリを用意し、未使用の保存先を明示する。

```text
node scripts/chart-timeout-v1-preflight.cjs --output e2e-artifacts/NEW_CASE
```

オプションは `--root`、`--dependencies`、`--browser-cache`、`--chromium-archive`、`--webkit-archive` のパスのみ。
`--dependencies` は読取検査する候補領域の指定であり、既存診断器のroot/node_modulesから異なる場合はBLOCKED。配置を変更しない。
アーカイブ指定は手元に既にある取得物だけに使う。ダウンロード、インストール、解凍による配置は行わない。
`--execute`、`--install`、`--retry`、任意facts/信頼宣言の入力は受け付けない。
合格しない場合の終了値は1。UNKNOWN/BLOCKED/FAILは期待した停止結果になり得る。

## 判定項目

| 区分 | 静的に照合する証拠 | 証拠の不足・限界 |
|---|---|---|
| A 取得物 | archiveサイズ/SHA、ZIP central/local header、全検査対象entryのCRC・サイズ、descriptor、重複/重なり、独立配布期待値・取得経路との対応 | archive未保存、公式期待digest/取得経路なしはUNKNOWN。破損はFAIL。公式URLという文字列やローカルhashだけでは真正性PASSにしない |
| B 実行物 | 候補実体の存在・読取り・SHA・サイズ・全パスcomponentのsymlinkとrealpath・実行アクセス、headless-shellと通常Chromium候補の区別、wrapper/launcher chainの独立根拠 | 候補pathは実起動先と同一と推定しない。実起動chainは根拠がなければUNKNOWN。Windowsの実行ACLはUNKNOWN |
| C 依存 | 固定lock raw bytes、Playwright/core版、配置領域、installed lockのversion/resolved/integrityと各配置package版、各package metadata SHA、browsers.json SHA/revision、launcher source SHA | JSONとlock SRIの一致だけでは配置package全byteの真正性を証明しない。未検証package authenticityはUNKNOWN |
| D OS/runtime | OS、architecture、Node、PE直接import名とDLL候補、ELF interpreter/NEEDED・RPATH/RUNPATH・system loader cache | 遅延import、推移的依存、実loader解決、起動成功はUNKNOWN。直接依存/loaderの明確な欠落はBLOCKED |
| E 固定source/診断器 | commit/tree、raw source/lock SHA、両Git blob、作業版、生成runner SHA・完全call ID/hash/一意性・fallback除去 | 固定Git履歴取得不可はUNKNOWN。診断器版検査前にworktree moduleをimportしない |
| F 計画/証拠 | 新規保存先、symlink親/範囲/書込み、空き16GiB、4枠/各1回/retry0/実行0、既存30秒/180秒/16MiB/300MiB契約、実行前独立review | 上書き・容量不足・領域不正はBLOCKED。P3 reviewやpreflight実装reviewを、環境付き4枠の実行前review受領に読み替えない |

PASSは要求証拠との一致、FAILは明確な不一致、BLOCKEDは必要物・権限・環境不足、UNKNOWNは根拠不足。
NOT_TESTEDは診断4枠の状態だけに使い、観測の欠測や破損をNOT_TESTEDへ読み替えない。
総合の優先順位はFAIL > BLOCKED > UNKNOWN > PASS。全groupとengine別適格性を別記し、engine適格性には共通source/lock/依存/証拠/reviewゲートも含める。
仮に静的preflightがPASSでも `executionAuthorized:false`、実起動成功UNKNOWN、4枠NOT_TESTEDを維持する。

## 信頼境界と未対応範囲

実CLIの承認済み配布物/起動chain/配置package全byte/reviewアンカー集合は空。
本人の依頼に信頼できるarchive期待digestや取得経路原票が含まれていないため、今回のローカルファイルからアンカーを自作しない。
`assess()`の第2引数を使う正常対照は、明示的なsynthetic独立期待値による検査器試験であり、実環境の適格性ではない。
CLIにはこれを渡す経路を設けていない。実環境をPASSへ進めるには、別工程で独立に取得・確認した配布情報、取得経路、期待値とlaunch-chain/環境reviewを固定して再レビューする必要がある。

Playwrightは版ごとに固有のbrowserを要求し、通常Chromiumとheadless-shellは別である（[公式browser文書](https://playwright.dev/docs/browsers#chromium-headless-shell)）。
本collectorはPlaywright resolverを実行しない。固定win/linux x64候補を列挙し、`revisionOverrides`も記録するが、全OSのresolverを再実装していない。
requested cache revisionの一致は、OS別実起動revisionの証明ではない。macOS/arm64・旧Ubuntu別revisionは未検証として保持する。
browser/package module、ブラウザbinary、wrapper、winldd、ldd、loaderの実行や `--version` 呼出しは行わない。
Linuxでは固定パスのsystem readelfで対象をデータとして解析し、system ldconfigの`-p`だけでcacheを読む。対象binaryをloaderへ渡さない。
WindowsではPE bytesを自前で読む。機密環境変数値は採取しない。Linux overrideは有無だけを記録する。
独立にpin確認したGit診断器blobからgenerateだけを評価し、既存run()は呼ばない。

ZIP検査上限は512MiB/10,000 entries、展開検査はentry64MiB・合計512MiB。ZIP64/暗号化/未対応method/上限超過はUNKNOWNであり、破損を成功扱いにしない。
取得物のhashと構造検査で2回読むbytesの一致も照合する。保存先はexclusive mkdir/writeで既存物を拒否する。
敵対者による継続的なfilesystem差替えや、将来実行時までの不変性は保証しない。実行前に別途固定・再検査が必要。

## 証拠と試験

`preflight.json` は全判定・理由・根拠・環境・版/hash・コマンド/終了結果・plan・欠測を保存する。
`manifest.json` は保存後の実ファイル再読取りによるSHA/サイズを記録する。元JSONは上書きしない。
いずれも後作成ローカル証拠であり、GitHub Actions原artifactではない。
ローカルreadbackと、外部保存後の実再取得を分離する。後者ができなければNOT_VERIFIED・preservationComplete falseを維持する。
公開資料には秘密値、絶対個人パス、本人限定Libraryリンク/ID/アクセストークンを記載しない。

```text
node --test chart-timeout-v1-preflight.test.cjs chart-timeout-v1.test.cjs chart-block-utils.test.js
```

正常/故障対照を別JSONへ保存する場合だけ、未使用ディレクトリを `CHART_PREFLIGHT_CONTROLS` に指定する。
単体・専用契約CIはブラウザを使用しない。通常CIが自動実行するbrowser回帰は別集計であり、固定4枠に加算しない。
新HEADの全workflow最終状態と独立レビューはPR追補で固定し、旧HEAD成功を流用しない。
