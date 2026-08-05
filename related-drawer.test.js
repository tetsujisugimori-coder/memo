"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

test("関連メモドロワーは初期状態で閉じ、必要なARIA関係を持つ", () => {
  assert.match(html, /id="relatedToggleBtn"[^>]*aria-controls="auxiliaryPanel"[^>]*aria-expanded="false"/);
  assert.match(html, /id="relatedToggleBtn"[\s\S]*?<span>関連メモ<\/span>/);
  assert.match(html, /id="auxiliaryPanel"[^>]*aria-labelledby="relatedPanelTitle"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html, /id="relatedBackdrop"[^>]*aria-label="関連メモパネルを閉じる"/);
  assert.match(html, /id="closeRelatedPanelBtn"[^>]*aria-label="関連メモパネルを閉じる"/);
});

test("ボタン、閉じる、外側、Esc、メモ切替で同じ開閉処理を使う", () => {
  assert.match(app, /relatedToggleBtn\.addEventListener\("click", \(\) => setRelatedDrawerOpen\(!isRelatedDrawerOpen\(\)\)\)/);
  assert.match(app, /closeRelatedPanelBtn\.addEventListener\("click", \(\) => setRelatedDrawerOpen\(false\)\)/);
  assert.match(app, /relatedBackdrop\.addEventListener\("click", \(\) => setRelatedDrawerOpen\(false\)\)/);
  assert.match(app, /event\.key === "Escape" && isRelatedDrawerOpen\(\)/);
  assert.match(app, /function openNote\(id\) \{[\s\S]*?if \(layoutMode !== "wide"\) \{\s*setRelatedDrawerOpen\(false, \{ restoreFocus: false \}\);\s*\}[\s\S]*?currentId = note\.id;/);
});

test("関連メモの選択は広い画面ではドロワーを維持し、狭幅だけ閉じる", () => {
  assert.match(app, /if \(layoutMode !== "wide"\) \{\s*setRelatedDrawerOpen\(false, \{ restoreFocus: false \}\);\s*\}/);
  assert.doesNotMatch(app, /function openNote\(id\) \{[\s\S]{0,180}setRelatedDrawerOpen\(false, \{ restoreFocus: false \}\);\s*currentId/s);
});

test("選択中メモがない場合も案内を表示する", () => {
  assert.match(app, /メモを選択すると関連メモが表示されます。/);
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

test("関連メモUIはモバイルを含む全幅で一元管理した階層順になる", () => {
  const readZ = (name) => Number(css.match(new RegExp(`--z-${name}:\\s*(\\d+)`))?.[1]);
  const context = readZ("context-panel");
  const backdrop = readZ("related-backdrop");
  const drawer = readZ("related-drawer");
  const trigger = readZ("related-trigger");
  assert.ok(Number.isFinite(context));
  assert.equal(drawer > backdrop, true);
  assert.equal(backdrop > context, true);
  assert.equal(trigger > drawer, true);
  assert.match(css, /\.context-panel\s*\{[^}]*z-index:\s*var\(--z-context-panel\)/s);
  assert.match(css, /\.related-backdrop\s*\{[^}]*z-index:\s*var\(--z-related-backdrop\)/s);
  assert.match(css, /\.related-panel\s*\{[^}]*z-index:\s*var\(--z-related-drawer\)/s);
  assert.match(css, /\.related-toggle\s*\{[^}]*z-index:\s*var\(--z-related-trigger\)/s);
  assert.doesNotMatch(css, /@container app-width \(max-width: 1039\.98px\)[\s\S]*?\.context-panel[^}]*z-index:\s*80/);
});
