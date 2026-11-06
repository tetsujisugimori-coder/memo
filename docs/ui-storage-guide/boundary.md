## 第1工程：変更境界の調査 (2026-11-06 19:45:31 +09:00)

- 最新main / UI既存ブランチ HEAD: `c9d350c83747b38c1e457430056282a479e080e1`。Issue固定スタートと一致。
- Issue全文・コメント、AGENTS.md、mainのREADME・保存/復元実装・設定UIを確認。
- 全open PR 16件。GitHub CLIのfiles一覧は100件で切れるため、REST files APIを全ページ取得して再集計（#405=1464、#403=249）。
- 以下のbase SHAはPRが報告する比較base。main等の現在先端と一致するとは限らない。各PR filesの固定スナップショットをUI専用docsへ保存予定。

| PR | base branch / SHA | head branch / SHA | 全変更数・領域 |
|---|---|---|---|
| [#419](https://github.com/tetsujisugimori-coder/memo/pull/419/files) | research/u2b-p1-precleanup-tx-cut-20261105 / b39c861d3ec8f60298cad0d0525b1a92b9c53435 | research/u2b-p1-c0-safe-capture-20261105 / 5b34fcee1de4b2a8e97397ea3920baffa32046ef | 9: design/idb-incomplete-stop/** |
| [#417](https://github.com/tetsujisugimori-coder/memo/pull/417/files) | research/u2b-p1-jsc-cut-20261104 / d5334839e07224981ea21c9ecc51b7f14d28db83 | research/u2b-p1-precleanup-tx-cut-20261105 / b39c861d3ec8f60298cad0d0525b1a92b9c53435 | 2: design/idb-incomplete-stop/** |
| [#415](https://github.com/tetsujisugimori-coder/memo/pull/415/files) | research/u2b-p1-j2-static-20261104 / 0edd1dd5f467f2dfb4a1b4f3df072048be23a97e | research/u2b-p1-jsc-cut-20261104 / d5334839e07224981ea21c9ecc51b7f14d28db83 | 2: design/idb-incomplete-stop/** |
| [#414](https://github.com/tetsujisugimori-coder/memo/pull/414/files) | design/idb-u2a-common-observation-contract / 5ea6f42db5ff122259261a5f0f3d25f6d63ba990 | research/u2c-p2-uc-static-20261104 / 5e86a2b2fbb2f6f93cb6a3681381f795067243d1 | 4: design/idb-incomplete-stop/** |
| [#413](https://github.com/tetsujisugimori-coder/memo/pull/413/files) | design/idb-u2a-common-observation-contract / 5ea6f42db5ff122259261a5f0f3d25f6d63ba990 | research/u2b-p1-j2-static-20261104 / 0edd1dd5f467f2dfb4a1b4f3df072048be23a97e | 2: design/idb-incomplete-stop/** |
| [#410](https://github.com/tetsujisugimori-coder/memo/pull/410/files) | design/idb-u2-witness-static-20261103 / eda663732d1eb98fc4a207eb2698f11a7f373e31 | design/idb-u2a-common-observation-contract / 5ea6f42db5ff122259261a5f0f3d25f6d63ba990 | 2: design/idb-incomplete-stop/** |
| [#408](https://github.com/tetsujisugimori-coder/memo/pull/408/files) | investigate/idb-time-delay-only / a72e0657d07632926d2ace9bcd7836cfbc41ac13 | design/idb-u2-witness-static-20261103 / eda663732d1eb98fc4a207eb2698f11a7f373e31 | 5: design/idb-incomplete-stop/** |
| [#406](https://github.com/tetsujisugimori-coder/memo/pull/406/files) | implement/idb-evidence-collector-u1 / 635d3c94e373970042eb467d5b9f0f4b3582a1ae | review/r2-full-cli-20261103 / 8f00ec0f3d17af5a8a839d276a3bb6bb7c82914d | 3: .github/workflows/**, design/idb-incomplete-stop/** |
| [#405](https://github.com/tetsujisugimori-coder/memo/pull/405/files) | investigate/idb-time-delay-only / a72e0657d07632926d2ace9bcd7836cfbc41ac13 | implement/idb-evidence-collector-u1 / 635d3c94e373970042eb467d5b9f0f4b3582a1ae | 1464: design/idb-incomplete-stop/** |
| [#403](https://github.com/tetsujisugimori-coder/memo/pull/403/files) | investigate/idb-time-delay-only / a72e0657d07632926d2ace9bcd7836cfbc41ac13 | investigate/idb-webkit-evidence / b64906439094b9f2bdfcc195fe7ec50895b5d2b4 | 249: design/idb-webkit-evidence/** |
| [#399](https://github.com/tetsujisugimori-coder/memo/pull/399/files) | investigate/idb-transaction-complete-only / 105d80a467e96aa7038052f501c4a1776a6e69bb | investigate/idb-time-delay-only / a72e0657d07632926d2ace9bcd7836cfbc41ac13 | 86: .github/workflows/**, design/idb-incomplete-stop/**, docs/reviews/pr-401-20261102-061130-JST.md, experiments/idb-time-delay-only/** |
| [#398](https://github.com/tetsujisugimori-coder/memo/pull/398/files) | investigate/idb-upgrade-lifecycle / 3734f82d117e09355cc721077ead626fa368e451 | investigate/idb-transaction-complete-only / 105d80a467e96aa7038052f501c4a1776a6e69bb | 30: .github/workflows/**, experiments/idb-transaction-complete-only/** |
| [#397](https://github.com/tetsujisugimori-coder/memo/pull/397/files) | investigate/mcp-worker-recovery / f2168f194b326b0ce9ffb722e81aa47e42ce0d03 | investigate/idb-upgrade-lifecycle / 3734f82d117e09355cc721077ead626fa368e451 | 33: .github/workflows/**, experiments/idb-upgrade-lifecycle/** |
| [#395](https://github.com/tetsujisugimori-coder/memo/pull/395/files) | investigate/mcp-worker-recovery / 06796f70f1a42b829ba6c4a2b7e962409aca20e6 | investigate/mcp-worker-stage5 / a40dfa457122173bdbe21e9147fe8ac4cdd2d04c | 99: .github/workflows/**, experiments/mcp-search-worker-feasibility/**, memo-search.e2e.js |
| [#393](https://github.com/tetsujisugimori-coder/memo/pull/393/files) | main / 714b1c63b8be3f0be35d2b1933865bb448343a12 | investigate/mcp-worker-recovery / f2168f194b326b0ce9ffb722e81aa47e42ce0d03 | 45: .github/workflows/**, experiments/mcp-search-worker-feasibility/**, experiments/t7-db-identity/**, memo-search.e2e.js |
| [#388](https://github.com/tetsujisugimori-coder/memo/pull/388/files) | main / 0fb770aa529a95b5f7cab7cefccbfea538bc424e | fix/mcp-search-heartbeat-status-only / 4fe3ea824b476d2ad6ef3c37fc14b6617be249ee | 7: .github/workflows/**, docs/mcp-saved-search.md, LOG.md, memo-search.e2e.js, memo-search.test.js, memo-search-broker.js, memo-search-ui.js |

### 禁止領域（main上の実体を含む）
- IndexedDB/保存/ZIP/復元: app.js の init、saveCurrentNote、putNote、saveLocalWorkspaceNow、importMarkdownZip、applyPortableBackupImport等、および indexeddb・backup・local-folder 関連実装。変更禁止。
- MCP/OAuth/通信/Worker/停止復旧: memo-search-*.js、mcp-*、codex-bridge*、受信関連、experiments/**。変更禁止。
- 研究契約/collector/schema/judge/runner/証拠: design/idb-*/**、研究workflow、研究レビュー/ログ。変更禁止。
- 研究積み上げ: #393→#397→#398→#399→(#403,#405,#408)、#405→#406、#408→#410→(#413,#414)、#413→#415→#417→#419。#395は#393系、#388はmain系の別MCP修正。取り込み禁止。

### 選定した安全領域と分離環境
- 新規 storage-guide.html / storage-guide.css を採用。スクリプト・フォーム・外部資源なしの説明専用ページ。テーマはOS/ブラウザ配色に従い、アプリの保存設定を読まない。
- index.html の設定→バックアップ節へ別タブリンクを1件のみ追加。app.js / style.css は変更しない。
- 試験コード storage-guide.e2e.cjs と証拠 docs/ui-storage-guide/** はUI専用。研究PRの変更パスとの重複0を検査する。
- 専用worktree: C:/Users/tetsu/Documents/Codex/メモ帳/work/ui-isolated-storage-guide-20261105。既存リモートブランチを追跡し、重複リモートブランチなし。
- branch: codex/ui-isolated-storage-guide-20261105 / HEAD: c9d350c83747b38c1e457430056282a479e080e1 / status: clean。通常・研究worktreeのHEAD/作業内容は変更しない。git object/refはworktree仕様上共有、作業ファイルは独立。
- 維持: J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLD。
- 実MCP・OAuth・停止実験・実メモ・既存データの消去/初期化は実行しない。現時点の試験 NOT_TESTED / merge NO。
