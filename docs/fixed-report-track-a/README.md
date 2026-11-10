# Track A: fixed-report WebKit (#443)

基準PR442 HEAD e41d72d00ea5e799acc70aaef4d78defa402e796、main69e5d648dddff4749a4f7b3faf2d214edfcff529を2026-11-11 JST再取得し一致。専用branch `verify/fixed-report-track-a-20261111`。元ブランチは変更しない。Track B/#436とは独立。

## 原因分類と最小変更

原run42831126774のWebKit job129881263401/129893122549は、runner割当後Ubuntu26.04.1のOS依存取得中にcancelled。初回npm ciは2秒、Playwright依存段階は14:09:07Z〜14:19:13Z、試験未到達。再試行もaptのパッケージ取得途中。メモリ/容量不足・製品失敗の証拠はない。通信・ミラー・runner環境による遅延の下位原因はUNKNOWN。

既存fixed-reportジョブだけubuntu-latestからubuntu-24.04へ固定。依存セットが変わるため26.04同等環境の成功とはしない。Playwright1.62.1/package-lock/製品/元試験assertionは不変。10分上限、全11標本を維持。これは環境固定による未到達対策で、製品不具合修正ではない。

専用workflowはnpm ci、OS依存、browser取得、PDF依存、フォント、元試験を分離し、開始/終了/elapsed/終了コードを保存。中断時RUNNINGのままなら完了を推定しない。traceなしの元npm scriptと任意traceありの元runnerを別matrixで実行し、観測有無を比較。traceはpersistent contextへだけ追加しwriter/timer/assertionを変更しない。両成功でも微小な観測負荷不存在は証明しない。

結果完全性checkerは全11ID、save/preview/image inspection、画像とtraceの存在を検査し、hash manifestを保存。WebKit PDF生成は既存通り対象外。未到達はNOT_TESTED。

## 検証と受入

最終CI/独立レビュー待ち。旧失敗ログをevidence/に保持。無関係な一般CIの失敗は隠さず記録する。PR442自体の再受入・更新・マージは対象外。

J2/U-C UNKNOWN、conditionU NOT_RUN、executionAuthorization NOT_GRANTED、startCondition BLOCKED、productionWorker HOLD維持。実ユーザーデータ・MCP/OAuth・本番Worker操作なし。
