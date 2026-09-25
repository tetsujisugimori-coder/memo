# Chart c10 WebKit frame scheduling investigation

## 1. 調査目的

PR #301までの計測で、c10ではrAFに約66〜74msの空白がある一方、16ms間隔のtimer callbackはその間も動作し、ボタンと直接親の矩形も変化しないことが分かっていた。timer/DOM計測を増やすだけでは「frame供給」と「Playwrightのstable/actionability待ち」を分けられないため、既存Playwright traceのactionabilityログを同じ操作のページ観測と照合した。

## 2. 調査条件

- Ubuntu GitHub Actionsの手動WebKit Chart E2E、Playwright 1.62.1。
- 対象は既存条件のtooltip `configIndex=10 / light / 320px`（c10）、2 runで各1試行。
- 対照は同runのc4 (`configIndex=4 / light / 390px`) とc0 (`configIndex=0 / light / 320px`)。
- Run [35993568999](https://github.com/tetsujisugimori-coder/memo/actions/runs/35993568999) と [35994760494](https://github.com/tetsujisugimori-coder/memo/actions/runs/35994760494) の既存frame JSONとPlaywright traceを使用。各runはChart全条件・後続検査まで成功。
- 同じ手動診断条件でのChromium比較はない。通常CIのChromium/WebKit E2E成功はこのrAF診断のブラウザ比較ではない。

## 3. PR #301までに分かっていたこと

- c10の初回rAF間隔は66msと74ms。gap中もページtimer callbackは17/33/49/65msに4回動作し、最大遅れは1ms/0ms。
- c10のボタンと直接親は観測中、矩形・display・visibility・opacity・disabled状態が不変。
- Playwright traceの`visible, enabled and stable`合同確認ログ間は67.061ms/81.769ms。c4は25.386ms/22.490ms、c0は31.616ms/25.581ms。
- WebKitの`PerformanceObserver`は`longtask`を提供せず、style/layout/paint/composite段階とPlaywright stableの内部条件ごとの待ち時間は取れていない。

## 4. 今回新しく分かったこと

保存済みtraceを読むと、長い区間のログはPlaywright actionの`waiting for element to be visible, enabled and stable`から同条件の完了までを示す。c10の区間長はc4より長く、ページ側の初回rAF空白と同じ操作内で近接している。traceはPlaywright API/actionとsnapshotを含むが、WebKit engineの`RenderingFrame`/`Paint`/`Composite` eventは含まない。

WebKit上流のInspector `Timeline` protocolには`RenderingFrame`、`Paint`、`Composite`、`FireAnimationFrame`が定義されている（[WebKit Timeline protocol](https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/inspector/protocol/Timeline.json)）。一方Playwright 1.62.1の`BrowserContext.newCDPSession`はCDP APIで、同梱実装はCDP接続をChromiumに限定する。したがって現行のPlaywright trace/API経路からWebKit Timeline eventは取得できず、今回その情報を得たとは扱わない。

## 5. 代表タイムライン

Run 35993568999のc10をページ観測開始からの相対時刻で示す。Playwright trace側はtrace monotonic clockで別原点のため、同じ操作に対応づけて区間を照合する。異なる時計の絶対値を直接減算してはいない。

| 時刻（ページ観測開始から） | ページJavaScript / timer | rAF | WebKit frame/render | Playwright |
| ---: | --- | --- | --- | --- |
| 0ms | 観測開始。対象ボタンと親は表示・有効、矩形固定 | callback待ち | engine eventはtrace対象外 | click actionへ進行 |
| 17 / 33 / 49 / 65ms | timer callbackが各時刻に実行。最大遅れ1ms | まだcallbackなし | paint/layout/compositeは不明 | traceはvisible/enabled/stable合同待機中 |
| 66ms | ページJS/timerは実行可能 | 最初のcallback、rAF空白が終了 | `RenderingFrame`やpaintの有無は不明 | trace側ではstable待機区間長67.061ms（page clockとの境界対応は未確定） |
| 約75ms | `pointerdown`とclick eventを観測 | callback供給再開 | 内部描画段階は不明 | click dispatch後の処理へ進む |

この時系列は同じ実行内の対応を示す。rAF gap 66msとtraceの合同確認待機67.061msは近いが、別時計・異なる観測境界の区間長であり、1ms差を因果や厳密な境界一致とはみなさない。

## 6. 現時点の分類

**現時点の観測結果はWebKit/render scheduling仮説（A）と整合的である。**

**観測事実：** 2回のc10試行でrAF callbackに66ms/74msの空白があり、その間もtimer callbackは動作した。対象ボタンと直接親に持続的なgeometry等の変化は観測されなかった。Playwright traceのvisible/enabled/stable待機区間も67.061ms/81.769msで、c4より長かった。rAFのpage clockとPlaywright traceは別時計で、区間長は近いものの開始・終了境界の厳密な一致は確認していない。WebKit内部の`RenderingFrame`/`Paint`/`Composite`は未取得であり、同一診断条件のChromium比較もない。

**推測・解釈：** gap全体を通じた連続的なページmain-thread占有だけでは説明しにくく、rAF callback供給の空白とPlaywright stable待機の近接はrender scheduling仮説と整合する材料である。ただし、これだけでWebKit内部のframe/render処理が止まったとは証明できず、stable待機との因果も測定していない。Playwright側の独立したstable停滞を示す証拠は今回得られていないが、存在しないと結論することもできない。stable区間がrAF供給間隔を反映している可能性はあるものの、別clockと観測境界の違いが残るため、現段階では推測にとどまる。

試行数は2回であり、WebKit固有問題とも断定しない。異なるtrace/page時計の対応幅、短いメインスレッド占有、観測による負荷も残る。

## 7. 次の一手

次PRで調べる対象は一つに絞る。対象WebKit実行環境がInspector remote `Timeline` sessionを公開できるか確認し、接続できる場合のみc10再現中の`RenderingFrame`/`FireAnimationFrame`と`Paint`/`Composite`を短い1区間で採取して既存traceと時計対応する。接続できなければ現行環境ではWebKit内部renderとPlaywright待機の分離不能と記録する。ページ側timer/DOM probeやCDPを代替計測として追加しない。

## 変更と検証

このPRでは調査結果文書のみを追加する。テスト/E2Eコード、通常CI設定、製品コード、click操作、待機条件、timeoutは変更しない。既存の`chart-card-frame-observation.test.js`はNode test isolation無効で3/3成功。`npm test`全体はWindows環境の子プロセス起動が`spawn EPERM`となり実行不能だった（CI結果ではない）。`git diff --check`は成功。
