# 軸タイトルE2Eの描画待機

## 確認した失敗

- main `da19f1b7e58f259cb5ed5e269cfb9f276f9b2ed1`: [CI 37533805665](https://github.com/tetsujisugimori-coder/memo/actions/runs/37533805665/job/112509529269)
- 2026-10-03 main `1a0b9a1d5aed8f9f0cbbd08b411207bbf6655d3d`: [CI 37127780721](https://github.com/tetsujisugimori-coder/memo/actions/runs/37127780721)
- 両ログとも Chromium の `chart-axis-titles` → `verifyAxisTitles` → `verifyDualGeometry`、ゼロ軸位置の誤差 `< 1e-8` が最初の失敗。古いログには数値座標が記録されておらず、当時の実測値そのものは確認できない。

## 切り分け

構造化編集はモデルを同期更新し、本文Previewを遅延更新する。軸タイトルが変わらない入力では、タイトル一致と要素の存在を待っても古いSVGを取得できる。

`beginComposition` で既存の派生描画を保留し、値を `[350, 0, 0] / [12, 0, 0]` から `[350, -20, 0] / [12, -0.3, 0]` に更新した。古いSVGは top=54、bottom=196、zero=196、新モデルの期待値は125。新しいSVGの対応する棒・点のtitleと項目/系列IDが一致するまで待つと125になる。軸計算、描画コード、許容誤差は変更していない。

| アプリ・検査 | 通常の軸タイトルケース3回 | 遅延描画を制御したケース3回 | 新しい描画取得後 |
| --- | --- | --- | --- |
| main da19f1b / 旧検査 | 成功・成功・成功 | 失敗・失敗・失敗 | 成功・成功・成功 |
| PR #347 dce3606 / 旧検査 | 成功・成功・成功 | 失敗・失敗・失敗 | 成功・成功・成功 |
| main da19f1b / 修正検査 | 成功・成功・成功 | 成功・成功・成功 | 成功・成功・成功 |

通常ケースは `node chart-block.e2e.js --feature chart-axis-titles`。制御ケースは `node chart-axis-render-wait.e2e.js` 相当の同一入力を各作業ツリーで実行。これはCIの時間順序を制御して再現した結果であり、過去ジョブの実測座標を補完したものではない。

修正後は Chromium / WebKit の制御ケース各3回も成功。`npm test` は1796件成功、変更JSの `node --check` と `git diff --check` 成功。CIには制御ケースの実行を追加した。固定sleep、再試行で成功するまでの実行、許容誤差変更はない。

PR #347のPDF失敗とは独立した問題として別PRで扱う。通常実行で3回成功しても旧検査が安全とは判断しない。
