# Chart timeout v1: 既存原票と実装状況

2026-11-15 JST。総合PARTIAL、根本原因UNKNOWN、マージ推奨NO。製品修正は未実施。

## 固定版と取得範囲
PR456の最新HEADは開始時87a5ac2f2dbbb940e8f4b4dd6269e5c349e75fc1で指定と一致。原CI run43643819571、attempt1のChart job132596999432/132596999533、attempt2の132599947194/132599947449を直接取得した。元のAPI応答と4ログを私有原記録として保存。ログ本文のSHA/サイズと実測状態は[原票解析](original-analysis.json)に記録。APIから復号されたログであり、GitHubの原ZIPそのものではない。

原CIは28c2c8b2e1be596f02a4f5a9b790618d11ce6a22をcheckout。Gitで取得したtreeは固定HEADと同じb28b20bfe6a5b21da39b2c010e0ea4be42437932。mainは08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d。新診断はmain起点で、PR456は変更しない。

artifact一覧は15件取得。Chart固有のtrace/スクリーンショット/DOM原票は一覧に見当たらず、Chartジョブの診断upload各stepはskip。原CIのDOM/focus/input時系列はNOT_OBTAINED。他機能のartifactをChart証拠へ転用しない。削除済み資料の不存在まで証明するものではない。

## 初回：1757
両engineの原ログで、narrow待機は30秒timeout。待機はstacked/showStackTotals、系列1/項目5、5値完全一致、DOM total label5件と各書式値の一致をANDしていた。

失敗後に取得された内部モデルは5項目・1系列・stacked/showStackTotals=true。系列は `[100,1.7e308,1.6e308,1.5e308,1.4e308]` で、期待 `[Number.MAX_VALUE,1.7e308,1.6e308,1.5e308,1.4e308]` の先頭だけ異なる。この少なくとも1条件は失敗後snapshot時に不成立。timeout全期間の内部値不一致やDOM側だけの原因とは断定しない。両engineで同じ結果がありWebKit固有と断定できない。

## 再実行：1620
WebKitはInfinity入力後の移動拒否について、focus aria-label「2件目の売上の数値」とstatus「数値は有限な数値を入力してください」の複合条件を待った。

失敗後の内部項目は1月,3月,2月、3系列値もこの順に移動、statusは「『2月』を3件目へ移動しました」に相当する実テキスト。移動拒否という期待と異なる結果は確認できる。fillコマンドが例外なく通ったことと、クリック時点までInfinityがDOMに残ったことは別。後者と実focusはNOT_OBTAINED。

Chromium attempt2は該当featureを含むChart script PASS。ただし同時点のモデル/DOM/eventは採取されておらず、WebKitとの差の原因はUNKNOWN。初回と再実行を同因と認定しない。

## 静的仮説（未実証）
app.jsのmove-itemはモデルcommit後にrequestAnimationFrameでfocus/statusを復元する。E2Eは直前移動のモデル順だけを待ってInfinity fillへ進む。DOMの再生成・focus復元と入力操作の競合は候補だが、今回原票にイベント時系列がなく因果は未実証。MAX_VALUE入力不反映も同じ競合とは未確定。数値パース・先行描画・入力置換を観測で分離する必要がある。

## 診断実装と検証
既存E2Eのバイトhashを固定し、元featureの先行処理を保つ隔離runner生成、目的wait前後/失敗後に内部/DOM/条件別結果と受動eventを収集する補助を追加。製品/timeout/assertionを変えない。観測awaitによる介入限界を[計画](PLAN.md)へ明記。

初期局所単体10/10成功、生成JavaScript構文とsource drift拒否を確認。これは実ブラウザの成功ではない。独立事前レビューPENDING、追加ブラウザ実行0。固定4枠はすべてNOT_TESTED。

作業機Debian13/Node24.22.1は原CIUbuntu26.04/Node22.23.4と異なる。npm ci成功、Playwright1.62.1。公式browser導入はZIP中央ディレクトリ欠落で失敗。別buildへの代替・追加試行・製品修正は行っていない。ブラウザ実行環境BLOCKED。loopback非ブラウザ事前確認は成功。

## 未完了と次工程
独立レビュー、最終提出HEADのCI、原記録の永続保存後の実再取得独立照合は、完了後に追記するまでPENDING。原実行の失敗時DOM/入力/focusは後から復元不能。製品修正の必要箇所は未確定。

次は診断実装の独立レビューを終え、固定browserが取得可能な隔離環境で事前固定4枠だけ実施する。新たな実行環境への移動とON/OFF比較は別に条件固定し、無制限再試行しない。現時点では根因断定・製品修正・マージを推奨しない。
