"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

test("関連メモドロワーは初期状態で閉じ、必要なARIA関係を持つ", () => {
  assert.match(html, /id="relatedToggleBtn"[^>]*aria-controls="auxiliaryPanel"[^>]*aria-expanded="false"/);
  assert.match(html, /id="auxiliaryPanel"[^>]*aria-labelledby="relatedPanelTitle"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html, /id="relatedBackdrop"[^>]*aria-label="関連メモパネルを閉じる"/);
  assert.match(html, /id="closeRelatedPanelBtn"[^>]*aria-label="関連メモパネルを閉じる"/);
});

test("ボタン、閉じる、外側、Esc、メモ切替で同じ開閉処理を使う", () => {
  assert.match(app, /relatedToggleBtn\.addEventListener\("click", \(\) => setRelatedDrawerOpen\(!isRelatedDrawerOpen\(\)\)\)/);
  assert.match(app, /closeRelatedPanelBtn\.addEventListener\("click", \(\) => setRelatedDrawerOpen\(false\)\)/);
  assert.match(app, /relatedBackdrop\.addEventListener\("click", \(\) => setRelatedDrawerOpen\(false\)\)/);
  assert.match(app, /event\.key === "Escape" && isRelatedDrawerOpen\(\)/);
  assert.match(app, /setRelatedDrawerOpen\(false, \{ restoreFocus: false \}\);\s*currentId = note\.id;/);
});

test("関連メモ抽出と最大8件の既存仕様を維持し件数を表示する", () => {
  assert.match(html, /id="relatedLimitNotice"[^>]*class="related-limit-notice"[^>]*hidden/);
  assert.match(app, /const allRelated = findRelated\(note\);\s*const related = allRelated\.slice\(0, 8\);\s*updateRelatedToggle\(allRelated\.length\);/);
  assert.match(app, /relatedCount\.textContent = String\(count\)/);
  assert.match(app, /if \(allRelated\.length > related\.length\) \{\s*relatedLimitNotice\.textContent = `\$\{allRelated\.length\}件中、\$\{related\.length\}件表示`;\s*relatedLimitNotice\.hidden = false;/);
  assert.match(app, /relatedLimitNotice\.hidden = true;\s*relatedLimitNotice\.textContent = "";/);
  assert.match(app, /関連メモはありません。/);
});

test("右パネルは本文幅を変えない固定オーバーレイで内部だけスクロールする", () => {
  assert.match(css, /\.related-panel\s*\{[^}]*position:\s*fixed;[^}]*width:\s*min\(340px, 90vw\);[^}]*transform:\s*translateX\(100%\)/s);
  assert.match(css, /\.auxiliary-panel-scroll\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(css, /\.related-limit-notice\s*\{[^}]*color:\s*var\(--muted\);[^}]*font-size:\s*12px;[^}]*white-space:\s*nowrap;/s);
  assert.match(css, /body\.related-open\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
