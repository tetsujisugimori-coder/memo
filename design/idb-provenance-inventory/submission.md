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

## PR #425の局所修正

今回の基準HEADは`544aebbbe57b3a4380e8611af0a5cfbf4ce98328`。同branch・同PR・同baseを使い、既存14file内のchecker/独立期待値/合成fixture/検証・提出文書だけを修正する。既存証拠台帳・解析JSON・payloadは変更しない。

親が修正前の実CLI RED、局所実装、修正後GREENと各receipt単位の回帰、commit/pushを担当する。実装未参加の新しい子エージェントを実装完了後に起動し、固定HEADの14fileと原資料を読み取り専用でレビューさせる。起動成功を観測するまでは今回の独立レビュー済みと主張しない。利用不可/失敗はSUBAGENT_NOT_AVAILABLE/SUBAGENT_FAILEDとして区別する。

Windows実測とLinux NOT_TESTEDを分離する。通常file symlinkはWinError1314でNOT_TESTED。Windows junction・case alias・root外参照は合成fixtureで別途実測し、通常symlinkやLinux実測の代用としない。VS Code固有の一般的な対応状況を、このセッションでの委任ツールの実在と混同しない。

修正後の実測HEAD、最終提出HEAD、子の実行主体・検査範囲・判定、マージ推奨の対象範囲はvalidationとPRコメントへ記録する。初回研究レビューとは別の今回レビューとして扱う。
