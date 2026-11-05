# 提出範囲と固定HEADの読み方

Issue: https://github.com/tetsujisugimori-coder/memo/issues/424

branch: research/legacy-webkit-provenance-20261105
base: main、開始時commit 438cf201abe83a53e8cb8e7ed160c4d6dbe147ba。
研究基準: #423 HEAD 592ccb63478d0a23312237d1f736a419c096f5f8。

差分はdesign/idb-provenance-inventory/配下の新規研究Markdown、取得/hash台帳・解析JSON、読み取り専用checkerと合成fixtureのみ。製品関数・既存検査器/schema/judge/Collector/runner/workflow・旧証拠・契約・先行PRは変更しない。

自commitのSHAをこの文書内に自己参照させず、Draft PR本文に最終HEAD/tree/base/変更file一覧と独立レビュー対象HEAD・結果を記録する。提出後はGitHub APIからhead/base/state/draft/changed filesを読戻す。

調査未参加のCodex子エージェントには固定commitの全差分file全文、取得原bytes、hash、欠落判定、反例を反証レビューさせる。完了前に独立レビュー済みとは主張しない。実験・安全性・実行許可のレビューには拡張しない。

[skip ci]付きcommitとし、実験workflowはdispatchしない。GitHub run/check読戻し結果はPR本文へ記録する。Draft解除・merge・auto-mergeは行わない。

BUILD_BINDING=UNKNOWN; J2=UNKNOWN; U-C=UNKNOWN; conditionU=NOT_RUN; realExperiment=NOT_RUN; executionAuthorization=NOT_GRANTED; startCondition=BLOCKED; productionWorker=HOLD。

2026年11月5日 JST
