# C0研究統合：証明済みの範囲と受入条件

**総合PARTIAL。BUILD_BINDING / OWNER_INTERVAL / NON_REENTRANCY はUNKNOWN。安全captureの成立・実験開始は承認しない。**
Issue [#422](https://github.com/tetsujisugimori-coder/memo/issues/422)、先行Issue [#420](https://github.com/tetsujisugimori-coder/memo/issues/420)。2026-11-05 JST。

## 固定研究と開始時点の区別

|対象|固定値・開始時GitHub読戻し|
|---|---|
|#419の研究基準|`64861de4f35615f7f0351941314689c3588cfb02`。追加3文書を全文確認した|
|#421の直接積み上げ元|`a0470360efe8285a6bca1dfd7197d050e78ef6e2`。修正後3文書を全文確認した|
|開始時#419|OPEN / Draft、HEAD `47041b189831a8819827adcf149a325b96ebccc0`、base `b39c861d3ec8f60298cad0d0525b1a92b9c53435`|
|開始時#421|MERGED / 非Draft。merge commitは上記`47041b1…`、merge時刻2026-11-05 03:15:23 UTC。HEADは指定値、baseは`64861de…`|
|新規PRのbase|現存する#421 branch `research/u2b-p1-c0-wpe-borrow-closure-20261105`、`a047036…`。#419の最新merge commitへ基準を差し替えない|
|一次ソース|WebKit `343e13bf22dca9d0ec227801419aab0f9001a32f` / Playwright `26a9e470a7b3c7822084b09fb7f13902c5f37b51`|
|不変契約|[共通観測契約v1](../u2-witness/common-observation-contract-v1.md)、blob `1a4b59272c13fb6b821a0c3853eed89e58a93967`|

開始時に両PRの本文・全conversationコメント・正式review・inlineコメント・review threadを再読した。inline/threadは両PRとも0（GraphQLのhasNextPage=false）。#420はOPEN、コメント0。先行レビューが局所閉鎖したのは#419のqueue混同と#421の所有判定の過剰FAILであり、実build・全所有期間・全非再入の残件は閉鎖していない。先行PRの現在状態と、過去本文にある「Draft維持」を区別し、今回それらを変更しない。

## 分類と証拠の強さ

CONFIRMEDは固定一次ソースから直接確認した**限定命題**、CONDITIONALは明示前件からの静的推論、UNKNOWNは前件・証拠不足、FAILは指定主張を否定する明示反例とする。研究全体のPARTIALと各命題の4分類を混ぜない。下表の「事実」は上流ソースについてであり、実配布buildへは未結合。「設計」は未実装、今回の動的実証は全項目NOT_RUN。

S番号と固定path/blob/行範囲は[#419ソース索引](c0-entry-writer-ownership-audit.md#8-固定ソース索引)を再利用する。対象buildへの結合がないままCONFIRMEDを実行対象のPASSへ昇格しない。

|軸・限定命題|分類|証拠種別・継承根拠|実対象の残件／PASSに必要なもの|
|---|---|---|---|
|C0の位置|CONFIRMED|事実：S01 WorkerDedicatedRunLoop::run、L244/245間。外側loop終了後、runCleanupTasks呼出し前|実Workerの同runloop・同build・同世代への到達記録。nested runInMode終了は代用不可|
|C0の適用範囲|CONDITIONAL|S02 L106–110のdynamicDowncast成功で当該runへ入る通常dedicated経路に限定|main runloop・Worklet・他Worker種への一般化不可。クラス名だけで全Worker適用を証明しない|
|E：entryScope解除後にexit servicesがある|CONFIRMED|事実：S06 L59–66、S09 exit services/listener。null代入と復帰は別|最後の最外exit services完了→task復帰→C0の完全call chain、native/Wasm等の残存なし、同VM joinはUNKNOWN|
|E：isEntered=falseだけで全実行終了|FAIL|静的反証：解除後のservices呼出しを落とす主張。CAP-N04|実C0に未完servicesが残ると観測したという意味ではない|
|F：停止要求から常にC0でexecutionForbidden=true|FAIL|静的反証：idle / module load失敗でF=falseが残る経路。CAP-N01/02、BC-N10|F=falseを追加設定して補わない。対象事象のE/F同時成立はUNKNOWN|
|F：trueなら全入口で実行不能|UNKNOWN|設計前件不足：S04/S08のflagと一部gateのみ。ENT22群は候補集合|対象buildのJIT/LLInt/Wasm/native/Inspector/生成binding/cleanup全入口と下層gateの閉包|
|T：Clientの正確な5状態|CONFIRMED|事実：Active / Inactive / Committing / Aborting / Finished、S31/S32。private m_state|現行public predicatesのみでCommitting/Abortingを識別する方式はFAIL（BC-N09）。安全な正確enum取得APIは未実装、実capture UNKNOWN|
|I：完全identityと世代|UNKNOWN|事実はresource/connectionの一部伝搬（S39/S40/S59/S60）。台帳は設計のみ|JS run/db/worker/connection/tx/iteration、build/process/producer、Worker/context/VM/object/接続/backend各世代と実wrapper返却join、失効、再利用排除|
|W：当該shutdown系列のC0→drain→prepare|CONDITIONAL|静的call/queue推論：S01/S02/S43、killed queue優先と指定cleanup task|同incarnationの過去W1なし、全CleanupTask producer/payload、以前のprepare/stopの排除はUNKNOWN|
|S：既存所有の局所移譲|CONFIRMED|事実：proxy map→local RefPtr→origin直接call／task capture（#421修正）|map離脱≠最終解放。borrow全区間のowner継続はUNKNOWN|
|S：所有・生存・非再入の全区間安全性|UNKNOWN|設計：#421単一borrow-copy案を維持|[所有・非再入の証明条件](c0-owner-nonreentrancy-proof-obligations.md)の区間・全caller/writer/destructor監査が必要|
|backend C1/C2だけでpending否定|UNKNOWN|C1=接続fallback error、C2=server事前条件error。Client受信/保存がcut前でも真正C3ではない|異常理由を保持、正常U-Cに採用しない。C0/Tからbackend進行を推定しない|
|真正C3が明示的にC0より前|CONDITIONAL|真正backing-store論理commit resultの出自・対象層・完全identity/世代・同一試行・C3≺C0・無矛盾が全て成立する入力ならbackendPending=FAIL|物理SQL成功とは別。今回の対象実行で前件を満たす証拠はない。C3が後、又はログ不在だけでもpending PASS不可|
|観測器がfield/寿命/順序を変えない|UNKNOWN|weak作成、lazy wrapper、確保、Ref/deref、JSLock解放、record保存に副作用候補|observer未実装。borrow end後の解放・記録も含む摂動監査とrecorder完全性が必要|

backend規則は[既存監査§6](c0-entry-writer-ownership-audit.md#6-backend結果の出自とc0を分離)と固定P2 [出自研究](https://github.com/tetsujisugimori-coder/memo/blob/3d1ceb6ace08be09989208dee4ba797c8d9642b3/design/idb-incomplete-stop/u2c-p2/backend-result-cut-deep-dive.md)を維持する。単一Client packetの成立はbackend producer cutの成立ではない。

## 今回追加できた証拠と限界

- 保存cacheの再照合：`work/c0-audit-materials/manifest.json`の372ファイル、`work/pr421-ownership-materials/manifest.json`の11ファイルについてGit blobと行数の不一致0。これはsource bytesの整合だけで、実binary manifestでも全入口網羅性でもない。
- 固定Playwrightのregistry実装を追加で直接読取り、metadata→platform別archive path→wrapperという静的対応を具体化した。binary/build/Workerの対応は未取得。[build証拠計画](c0-build-identity-evidence-plan.md)にblob・照合箇所を記録する。
- 保存G実験の既存Actions artifact `13087243261`を**読取りのみ**で取得し、API digestとZIP SHA-256一致を確認。9 entryは結果JSON・generated JSなどであり、native binary、CMakeCache、WebIDL/IPC生成C++、実loaded module記録を含まない。旧1ms実験を再実行せず、その成功件数も追加しない。
- 所有期間をownerごとの開始/移譲/終了とborrow利用順へ展開した。checkpoint closureの既存Refも候補へ明示し、proxyだけを唯一ownerとしない。実C0での継続保持は未証明。

## 依存関係と終了条件

build母集団の固定 → そのbuildの生成binding/翻訳単位/featureの固定 → 登録・失効と完全identity → 既存owner区間と全writer/入口閉包 → E/F/T/Iの局所共通cut → W・recorder・摂動 → J2評価、の各edgeに独立証拠を要求する。backend cutは別producerの証拠をjoinする。build取得だけで非再入をPASSにせず、非再入を仮定してowner期間を補わない。

次の最小工程は**旧配布buildの保存native artifactとbuilder provenanceの有無を照会・静的照合すること**。取得できなければretrospective BUILD_BINDINGをUNKNOWNとしたまま、上流source限定の所有局所補題だけを続ける。新規buildや実Workerで穴を埋めない。

受入条件は「3領域それぞれの証明範囲、不足成果物、取得元/操作、制約、PASS条件を第三者が追えること」であり、UNKNOWNの消滅ではない。文書のリンク・blob・差分検査と独立レビューをDraft PRへ固定HEAD付きで記録する。文書品質の評価を研究全体の実安全性と別に報告する。

`J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD`。

2026年11月5日 JST
