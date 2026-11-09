Windows Playwrightの起動timeoutを、固定ソース・元の受入assertを維持して調査しました。全タブ終了後のWebKit再起動で、IDB open前のscript/DOM到達遅延を観測しました。原因・一般利用への影響はUNKNOWNで、製品修正はしていません。

依存: Draft #435 (`codex/issue-429-save-conflict-20261107`) / 固定HEAD `478d8b3ea59b242e4ddd5cc82e12b44169223047`。このPRのbaseを#435のbranchにしています。旧対照 `8f35ca25001ffa031abfd304dd2a5e9a3d9197dd`。Refs #436（原因未確定のためcloseしません）。

変更: opt-in起動計測、有限4比較のWindows/Linux専用CI、製品・IDB不使用の通信probe、独立合成境界/計測試験、証拠文書。保存関数・280msタイマー・BC・IDB writer・製品UIは変更していません。timeout延長、SKIP化、成功条件緩和なし。

総合PARTIAL・マージ推奨NO。有限調査/提出完了、原因特定未達、修正未実施、Windows全条件再受入未完了を区別します。

| 検証 | 結果 |
|---|---|
| ローカルWindows 1280 AB | 無計測/受動計測WebKit完走、初回deep WebKit attached待機10秒でFAIL。init15,323ms / load15,369ms、IDB open44ms。Chromium deep完走 |
| Windows / Linux専用CI | 各OSの修正版2engine完走、旧版2engine編集消失RED（原child exit1保持）。両job SUCCESS |
| 独立合成 | 7/7 PASS、v6欠落revision回復の反例なし。実ブラウザ受入とは分離 |
| 製品/IDBなし通信probe | 各環境の3条件完走。原因の最小再現器は未成立 |

旧Chromiumの中断試行は原資料不成立として保持し、別保存の再開REDで置換しません。計測干渉、ローカル資源状態等の原因候補はUNKNOWN。Windows CIの単発成功をローカルの安定化や全10件/guide20件の再受入へ一般化しません。

専用CI: https://github.com/tetsujisugimori-coder/memo/actions/runs/42614097846

詳細: [A–L調査報告](https://github.com/tetsujisugimori-coder/memo/blob/codex/issue-436-startup-investigation-20261108/docs/issue-436/report.md)、[独立監査](https://github.com/tetsujisugimori-coder/memo/blob/codex/issue-436-startup-investigation-20261108/docs/issue-436/independent-review.md)、[原資料/全SHA256](https://github.com/tetsujisugimori-coder/memo/blob/codex/issue-436-startup-investigation-20261108/docs/issue-436/evidence-index.json)、[区間時系列](https://github.com/tetsujisugimori-coder/memo/blob/codex/issue-436-startup-investigation-20261108/docs/issue-436/startup-intervals.json)。原JSON/ログ/終了コード/画像をリポジトリ内3ZIPへ保存し、CI原ZIPはAPI digestと一致。GitHub artifact期限はLinux2026-11-23 12:07:11 UTC、Windows12:10:38 UTC、リポジトリ版は自動期限なし。診断SHAのLF/CRLF差を独立確認して保持。

20既存PRのHEAD/baseとmain不変を読戻し確認。元worktreeもresearch branch/264937aのままclean。マージ・公開なし。独立レビューは別Codex子エージェントによるもので、同GitHubアカウントから代行COMMENTを提出し、自己APPROVEとはしません。

J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLD維持。実データ/実MCP/OAuth/Worker停止復旧操作なし。

2026-11-09 JST
