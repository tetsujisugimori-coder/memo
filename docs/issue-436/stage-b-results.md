# Issue #436 / Stage #436-B 実行結果

## A. 固定対象と最終判定
StageB診断コード検証HEAD: ba8d10d3cb0462e0295660391dbcfb30fefa2ae9。依存PR #437固定HEAD: b7270b85011c26f7667b275f62b380e2cc1e2d83。製品fixed: 478d8b3ea59b242e4ddd5cc82e12b44169223047。今回のStageBの限定診断実装・有限比較はPASS、**根本原因UNKNOWN、Windows実PC全条件の再受入NOT_TESTED、研究全体PARTIAL**。製品修正なし、独立再レビュー未実施、マージ推奨NO。Issue #436はopen、#435/#437はDraft維持。

最終[GitHub Actions run 42679317676](https://github.com/tetsujisugimori-coder/memo/actions/runs/42679317676) は2026-11-09 19:03 UTCに両job SUCCESS。Windows/Linux各10/10（既存診断＋StageB契約）、構文検査成功。両OSとも固定修正版 WebKit 1280/AB の既存passive→追加trace→追加trace→既存passive（ABBA）の各4試行すべて製品PASS/原child exit0/診断資料COMPLETE。Windows/Linux CI成功を以前のWindows実PCの原因除去や10件/guide20件再受入へ一般化しない。

## B. 追加traceの区間集計
次の表は各OSのtrace 2試行における最大値範囲（同種の測定区間の最大値であり、総起動時間ではない）。

| 区間 | Windows hosted CI | Linux hosted CI |
|---|---:|---:|
| HTTP request received→response finish | 42.9–53.9ms | 29.5–32.1ms |
| route callback start→end | 54.7–61.0ms | 53.9–70.6ms |
| browser resource duration | 68–72ms | 43–46ms |
| navigation→DOMContentLoadedEventEnd | 354–359ms | 471–479ms |
| Node event loop lag (測定区間最大) | 58.6–62.0ms | 28.4–31.4ms |

各traceでHTTP対応完了560件/未完0、route対応完了600件/未完0、browser snapshot8件、resource entries592件。HTTPとrouteの件数差は、外部リソースのrouteによるfulfill等を含み得る。ブラウザ時計とNode時計を単純に減算していない。Windows paging/CIMはtrace 1で取得失敗1件、trace 2で1サンプル取得（pagesPerSec=0、availableMBytes=13,120）。1サンプルだけではpagingが原因でないと断定できない。missingはnullとして保持する反例契約を追加し、10/10 PASSに含めた。

今回のいずれのrunでも過去の初期化開始約15,323msに相当する長い待機は観測していない。新trace正常系だけで失敗時のHTTP/route/browser/OS責任を確定できず、**rootCause=UNKNOWN**。特にWindows実PCの低空きメモリ条件、Playwright protocol遅延、旧Chromium timeoutとの因果は未識別。

## C. 固定原証拠と保存期間
最終run 42679317676のGitHub Actions artifact（自動期限14日、UTC）。
- [Linux #13701767147](https://github.com/tetsujisugimori-coder/memo/actions/runs/42679317676/artifacts/13701767147): SHA256 ebf4e1457547b1027b6aed10d66aba087b8e361847a083f83ed3bb441c0ca0f0、2,017,007 bytes、期限2026-11-23T19:02:57Z。
- [Windows #13701707311](https://github.com/tetsujisugimori-coder/memo/actions/runs/42679317676/artifacts/13701707311): SHA256 ca372f80546669d5ebac4bc539ac1e1f0681b94397124e603922fe75c0a55fee、1,242,871 bytes、期限2026-11-23T19:03:17Z。

成果物には原results.json/manifest.json、元child exit、supervisor log、追加telemetry、スクリーンショットを含む。重複する検証用source/ source.tarはartifactから除外し、source HEADとmanifestの個別照合を維持。上記2artifactの原ZIP全entryを別の独立監査担当が再計算したものではなく、今回の読戻し範囲はGitHub Actionsのjob log、artifact metadata、元のCI判定。よって独立再レビューは未完了として扱う。

## D. 次工程
根本原因を絞り込むには、**実際に遅延が再現するローカルWindows**の隔離された架空データ環境で、同じ固定HEAD・原assert・有効なStageB診断を有限比較し、遅延した同一requestのHTTP/route/ResourceTiming、Node/OS資源を時間境界内で照合する必要がある。今回CIでは再現しなかったため、同じ実験を無制限に増やすことは推奨しない。強制終了などでtraceが欠落したrunはINCOMPLETE、元製品FAILはFAILのままにする。

## E. 安全・変更境界
製品ソース、IDB writer、280msタイマー、BroadcastChannel、元の10秒期限とassertは不変。実データ、実MCP/OAuth、Worker停止復旧、製品本番切替なし。#435/#437/mainは変更せず、StageBは新Draft PR #438のみ。
J2/U-C=UNKNOWN / conditionU=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD維持。

2026-11-10 JST
