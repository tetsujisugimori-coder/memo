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

## Inspector Timeline可否確認

### 実装した診断

- `webkit-inspector-timeline.e2e.js`は独立実行し、最小HTMLの読み込み・DOM更新後、各段階を1行JSONで記録する。
- `npm run test:e2e:webkit-inspector-timeline`で単独実行する。
- GitHub Actionsは`workflow_dispatch`の`webkit_inspector_timeline`入力がtrueのときだけUbuntu上でWebKitを導入して診断し、JSONLをartifactとして保存する。通常PR CIでは診断jobを起動しない。
- 試した経路はPlaywright公開APIのWebKit起動とページ操作、および1.62.1同梱server実装の確認。WebKitの起動transportはPlaywright内部の`--inspector-pipe`で、Playwright BrowserServerのWebSocket endpointはInspector endpointではない。TimelineコマンドをInspector sessionへ送信する診断用private adapterは作成していない。

### ローカル実測（Windowsのみ）

- Playwright: `1.62.1`（lockfile固定）。Node: `v24.20.0`。実行ファイル: `webkit-2336/Playwright.exe`、Playwrightが報告したWebKit version: `26.5`。
- WebKit起動と最小ページのDOM更新は成功。
- Inspector remote target: 公開API経路では取得できず。Inspector session、Timeline開始、Timeline event受信はいずれも未到達。イベント数は0。失敗地点はtarget取得で、プロトコル接続エラーではなく、Playwright公開APIからInspector targetを返す経路がないため。
- ローカル出力: `e2e-artifacts/webkit-inspector-timeline.jsonl`。このローカル環境に限った到達状況はC相当だが、内部pipeを通じた別の接続方法の可否まで否定しない。

### Ubuntu GitHub Actions

手動workflow_dispatchの [run 36181871536](https://github.com/tetsujisugimori-coder/memo/actions/runs/36181871536) で確認。Ubuntu GitHub Actions、Node `v22.23.2`、Playwright `1.62.1`、`/home/runner/.cache/ms-playwright/webkit-2336/pw_run.sh`、WebKit `26.5`。

- WebKit起動・最小ページ操作は成功。起動引数は`--inspector-pipe --headless --no-startup-window`。remote-debugging引数はなく、BrowserServer WebSocketはPlaywright protocol endpointだった。
- Inspector remote targetを取得できず、失敗地点はtarget取得。ログ上の具体的な失敗理由は「Playwrightは`--inspector-pipe`で起動し、remote-debugging endpointを公開していない。BrowserServer WebSocketはPlaywright protocolであり、Inspector targetではない。Inspector pipeはPlaywright APIからattach可能なtargetとして公開されない」。Inspector session、Timeline開始、event受信は未到達、イベント数0。
- Local WindowsとUbuntu Actionsの結果は同じ。両方でPlaywright 1.62.1 / WebKit 26.5が`--inspector-pipe`を使い、公開Inspector targetは取得できなかった。
- Actions artifact `webkit-inspector-timeline`にJSONLを保存。診断jobとCI checksは成功。この調査の分類を**C. Inspector remote session自体を取得不可**とする。範囲は今回のPlaywright 1.62.1 + WebKit 26.5 + Ubuntu GitHub Actionsの接続経路に限る。

### 今回の範囲と制約

この環境ではWebKit内部render eventとPlaywright待機をこの接続方法では分離できない。失敗地点を超えるための別方式や追加probeには進まない。Inspector targetが公開されないことを、WebKit一般のTimeline非対応とは解釈しない。c10計測、製品コード、既存Chart E2E操作・期待値には変更を加えない。

## 変更と検証

この調査では新規診断スクリプト、npm単独実行script、手動workflow_dispatch job、調査文書を追加した。既存Chart E2E操作・期待値、製品コード、通常PR CI jobは変更していない。

- `node --check webkit-inspector-timeline.e2e.js`: 成功。
- `npm run test:e2e:webkit-inspector-timeline`: Windows Playwright 1.62.1 / WebKit 26.5で起動・ページ操作に成功し、C相当のローカルJSONLを出力。
- `npm test`: 14,060件中14,016成功、44失敗。Nodeの既定探索が既存の未追跡`work/`配下の複製プロジェクトまで実行し、そのコピー内のcache identifier等の不一致で失敗した。追加した診断や現行トップレベルのChart E2Eによる失敗とは確認されていない。未追跡作業は変更していない。
- `git diff --check`: 成功。
- Ubuntu Actionsの診断jobとCI checksは成功。通常PR CIに診断負荷を加えない構成で、手動dispatchから実測した。
