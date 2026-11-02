# WebKit版照合・内部未終端証拠・資料整合性チェック

Issue [#402](https://github.com/tetsujisugimori-coder/memo/issues/402)。
**総合PARTIAL。P2の局所修正自己検証PASS、独立再レビュー待ち、マージ推奨NO。**
版対応PARTIAL、公開方式のU証拠不足、内部計測候補は未成立という研究結論を維持する。
実行未承認／開始BLOCKED／実験NOT_RUN／U NOT_RUN／本番Worker HOLD。
H1〜H3 UNKNOWN、H4 PARTIALを維持する。修正後の独立受入は未実施。

[提出版の独立レビュー](https://github.com/tetsujisugimori-coder/memo/pull/403#issuecomment-6575852600)で
BASE_REVISIONの後続上書きを見逃すP2が確認された。[局所補訂報告](p2-fix.md)に
旧固定HEADの誤受理、同一入力での修正前後比較、対応構文、41純粋試験と保全範囲を記録する。

- [版対応表](version-map.md)：固定metadataと実行記録、事実・推論・UNKNOWN。
- [取得可能性](feasibility.md)：内部ID・停止・commit/abort・DB処理・通知経路とA/B/C。
- [契約](contract.md)・[schema](schema.json)：判定範囲、値、必須項目、終了コード。
- [実際の不足を含む入力](inputs/assessment.json)・[JSON出力](records/assessment-result.json)。
- [検証・保全](validation.md)。

## baseと既存成果

着手時mainは `438cf201abe83a53e8cb8e7ed160c4d6dbe147ba`、作業ツリーclean。
remoteは `https://github.com/tetsujisugimori-coder/memo.git`。worktree一覧と
関連6 worktree（main＋研究5）のHEAD/status/変更・未追跡ファイルhashを保存した。
未追跡証拠や旧製品作業はstash/破棄/commitしていない。

#401はGitHubでclosed/merged、baseは `investigate/idb-time-delay-only`、
headはレビュー記録commit `852c88330c25f44b5bd9243d836262c659e60640`、
mergeは **`a72e0657d07632926d2ace9bcd7836cfbc41ac13`** と確認。
独立レビュー対象 `e08c065161ba147e7dbba175a2038ef27bf968a0` を区別して継承した。
その設計とレビューを同時に参照でき、無関係なmainへ研究系列を取り込まないため、
確認済みmergeを固定分岐点に専用branch `investigate/idb-webkit-evidence` を作った。
Draft PR baseも `investigate/idb-time-delay-only`。既存PRのbaseは変更しない。

GitHubのIssue #387/#389/#391/#392/#396/#400、PR #388/#390/#393/#395/#397/#398/#399/#401の
本文・取得時レビュー・コメントを `records/*.json.gz` に保存した。
#390はmainへmerged、#401は研究baseへmerged。他の対象PRは取得時open。
#399のheadは#401統合後にa72e065…へ進んでいる。これを旧G実行HEADと混同しない。
#388の未解決Promise製品課題、#395の共有台帳等の試作を引き継ぎ、同じモデルは作り直さない。
R/Uとcomplete因果契約・旧D失敗/cleanup UNKNOWN・G INCONCLUSIVEを維持する。

## 再計算（repository rootから、依存install不要）

```powershell
node --test --test-reporter=tap design/idb-webkit-evidence/check.test.cjs design/idb-webkit-evidence/upstream-config.test.cjs
$checkerArgs = Get-Content -Raw -Encoding UTF8 design/idb-webkit-evidence/records/check-arguments.json | ConvertFrom-Json
node design/idb-webkit-evidence/check.cjs @checkerArgs
# 保存入力では終了1 / INCOMPLETE。CONSISTENTの終了0も実行許可ではない。
```

引数一覧はschema/planと12のsourceを個別に明示するデータ。チェッカー自身はこの一覧を
自動読込せず、受け取った引数のファイルしか読まない。source URLやsource内コードを追わない。
R/Uは資料の対象ラベルとして保持し、イベントtraceからの成立判定は行わない。
新規schemaVersionは証拠の実装版ではない。

現在の `records/p2-fix/SHA256SUMS` は自身を除くこのdirectory全fileのSHA-256。
旧 `records/SHA256SUMS` は旧HEAD `636e279…` の106 file用として不変更保存したもので、
現在のparser・文書に対するmanifestではない。
`inputs/source-index.json` はWebKit取得bytesのGit blob/SHA-256も保持する。
gzipは原始UTF-8応答またはsource bytesをmtime=0で保存。展開前hashと展開後hashは区別する。
このdirectory内だけの `.gitattributes` でtext改行変換を無効にし、Git保存bytesを保つ。
旧logの展開bytesを新入力へcopyしただけで、旧gzipを再圧縮・上書きしていない。
参照C++/IDL/patch/wrapperは静的資料として保存したもので、実行用の診断コードではない。

```python
# repository rootで実行。manifest記載fileだけを読み、bytesを照合する。
from pathlib import Path
import hashlib
root = Path('design/idb-webkit-evidence')
for line in (root / 'records/p2-fix/SHA256SUMS').read_text(encoding='utf-8').splitlines():
    expected, name = line.split('  ', 1)
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
```

取得を再確認する場合も、source-index記載の固定commitとpathに対してGitHub contentsの
base64 bytesを取得しhash照合する。別版へのfallback・依存更新・ブラウザ起動は不要。
ネットワーク取得失敗時は原始errorとUNKNOWNを残して有限終了する。

## 境界

製品検索・認可・保存、旧judge/runner/workflow、実データ・OAuth・サービス・ポート・Tunnelへ
接続しない。新旧ブラウザ実験0、再実行0、dispatch0、ビルド0、依存更新0。
CIはNOT_RUN。merge/auto-merge/Draft解除/branch削除/main更新を行わない。
静的整理を繰り返してU成立へ昇格させず、[取得可能性報告](feasibility.md)の判断材料で終了する。
