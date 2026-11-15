# preflight実装・静的実測結果

2026-11-15 JST。Issue #457 / Draft PR #458。実装の限定検証と実環境適格性を分離する。
総合の作業判定はPARTIAL。検査器の非ブラウザ試験は成功したが、今回環境の事前適格性はFAIL・実行阻害あり。
固定4枠は全て0回 / NOT_TESTED、原因UNKNOWN、移行推奨NO、マージNO。

## 開始固定点

remoteとローカルのHEAD `a4115eab8d4b5c26ab0177c84b6d92f10534647a`、tree `17b35016ee9efcbe5620be998c4795ea5ceda42b` が指定基準と一致。
AGENTS、PLAN、RESULTS、修正コード、P2独立レビュー記録、PRコメントとP3再レビュー `5910431872` を読取確認。
開始時点の専用CI `43708885362` はSUCCESS、通常・Palette・Track Aは待機/進行中、Track Bは条件外SKIPPED。後の最終状態はPR追補で区別する。

## 実測の範囲

Windows_NT 10.0.26300 / win32 x64 / Node v24.20.0で静的検査。原CIのOS/Nodeと同一環境とはしない。
配置済み候補の読取だけに `--dependencies ../../node_modules` を明示した。この領域を診断器rootへ移動・リンクしていない。
追加browser導入、binary/wrapper起動、実Ollama、固定4枠、E2Eローカル実行、手動dispatch、CI再実行は0。

現在の実測原票は `e2e-artifacts/preflight-static-20261115-c/`。先行snapshot a/bは別版として保持する。
検査時のrepo HEAD/treeは開始固定点で、追加preflightは未commitの実ファイルとしてhashで識別した。
preflight raw SHA-256 `e2ee03fe0df7b0c65a1c5410c2cd6fa4a51feae15cdda4a2c1d433fe26b3449c` / 31,731 bytes。
後の提出commitと実測時点を同一SHAとはしない。最終提出HEAD/tree、CI、commit後の静的原票はPR追補へ記録する。

| 検査 | 判定 | 実測根拠・不足 |
|---|---|---|
| A 取得物 | UNKNOWN | archive未保持、取得経路原票・信頼できる期待digestなし。以前の不正ZIPそのものを今回再検査したとはしない |
| B 実行物identity | UNKNOWN | headless-shell/通常Chromium候補とWebKit候補は存在しhash採取。実起動chain・期待hashとの独立対応・Windows実行ACLはUNKNOWN |
| C lock/依存 | FAIL | 固定lock44,319 bytesと作業lock45,582 bytesが不一致。CRLFを自動修正しない。候補依存はroot/node_modulesと異なり配置ゲートBLOCKED |
| D OS/runtime | UNKNOWN | PE直接importのDLL候補は不足0。推移/遅延依存・loader解決・起動成功は未証明 |
| E source/診断器 | PASS | 固定commit/tree/source/lock raw hash、両Git blob、完全目的call ID一意性、fallback除去を照合 |
| F 証拠/計画 | BLOCKED | 新規保存先・空き約402GB・固定4枠計画はPASS。環境付き実行前独立review receiptなし |

FAIL > BLOCKED > UNKNOWNの集計により総合FAIL、共通lockゲートを含むChromium/WebKit各適格性もFAIL。
このFAILはChart製品障害を再現した結果ではない。

## 版・固定値の照合

- 固定87a5ac2/tree、raw source SHA、lock SHAは[PREFLIGHT](PREFLIGHT.md)と一致。
- 作業lock SHA-256 `0cb203dba6139b7a627d69ae494f3a5b2b6cc6fbd8e8b0ddd9a5b5053a5b33cd`。期待lock SHA `284777a48f5a357a603bd6916f5d86c2fa1e7cd43537442c0fcb62f478b85edb` と不一致。
- 候補Playwright/coreは1.62.1。固定lockとのinstalled lock metadata/配置package版97件に不一致0・必須欠測0。ただし配置領域が異なり、package全byteの真正性はUNKNOWN。
- browsers.json SHA-256 `f306eed529599b1eaf2f8a85db9de2b23e1a3fe36c2b66434b7c9434fb627a99`、宣言revision1234/1234/2336を記録。OS別実起動revisionの保証ではない。
- Chromium headless-shell候補211,223,552 bytes / SHA-256 `ce4635cd0e5dc0e21494542a701f347e91c1f1d821970578d97ed8df4ced50ef`。
- WebKit候補202,752 bytes / SHA-256 `02098f76165779067df02881660593d25da6b8e3e11e052f9459f5ae1f94a1fc`。
- 診断器/observerのGit blobは基準と一致。作業版はCRLFのみの差を別記し、raw一致とはしていない。固定lockではこのCRLF例外を設けていない。
- 両生成runnerの目的call ID/hash、runner SHA、一意性1、Windows1194 fallback不在を原票へ記録。runnerは実行していない。

## 正常対照・故障注入

新54件＋既存P2/P3診断38件＋Chart utils217件、計309件成功、skip0。
新しい正常対照はsynthetic独立期待値であり、実取得物の真正性や実起動を認定しない。
実体欠落、browser/archive hash差、revision差、lock差、依存差/欠測、リンク切れ、共有lib欠測、取得経路不足、archive破損、起動先不明、上書き、欠測とNOT_TESTED、review/timeout/retry/実行回数を分離した。
正常対照と故障対照は `e2e-artifacts/preflight-controls-20261115-release/` の別JSONに保存。
構文確認2ファイル・git diff --check成功。誤った旧テストfilenameでの呼出し失敗も作業履歴として保持し、実テスト失敗や成功へ読み替えない。

独立レビューで、local ZIP headerのCRC/サイズだけの破損3条件を旧検査が受理する反例を取得した。
新検査で同一反例をFAILへ変更、正常ZIPは維持。hash取得と構造読取りの別byte混同、証拠shape欠測、共通lockゲートがengine集計から落ちる反例も回帰へ追加・閉鎖した。
既存期待値を緩めず、skipへ変更していない。既存診断器・observer・38試験は無変更。
最終独立レビューの識別、提出後専用CI/全workflowの最終結果はPR追補に記録する。

## 証拠の保全状態

原票cのpreflight.jsonは54,252 bytes / SHA-256 `90b1be119c1c1c69cb70f908d92234cfc9ed7b59019e6818ef790c12d32973cd`。
保存後の同一ローカル実ファイル再読取りがmanifestと一致。旧snapshot aと各失敗probeは上書きせず保持。
この原票と対照は後作成ローカル証拠であり、Actions原artifactではない。旧PR証拠やLibrary資料には変更していない。
外部保存後の実再取得はNOT_VERIFIED、保全完了false。本人限定リンク・秘密値を公開していない。
Windows x64以外の実環境適格性はNOT_TESTED相当の未検証であり、UNKNOWNを維持する。

## 未解決と次工程

公式取得経路・信頼できる期待digest、archive原物、起動chain対応、依存配置/raw lock、OS推移依存、環境付き実行前独立reviewが未充足。
本工程で自動導入・置換・改行変換・fallback・retryはしない。
実行開始には、これらの証拠を別工程で固定し、独立事前reviewと本人の新たな明示指示が必要。
4枠全てNOT_TESTED、原因UNKNOWN、実行開始推奨NO、マージNOを維持する。
