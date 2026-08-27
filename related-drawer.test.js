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

test("バックリンクを独立表示し、通常関連は重複除外後も最大8件を維持する", () => {
  assert.match(html, /id="relatedLimitNotice"[^>]*class="related-limit-notice"[^>]*hidden/);
  assert.match(app, /backlinksByTargetId\.get\(note\.id\)/);
  assert.match(app, /const backlinkIds = new Set\(backlinks\.map/);
  assert.match(app, /findRelated\(note, memoIndex\)\.filter\(\(\{ note: item \}\) => !backlinkIds\.has\(item\.id\)\)/);
  assert.match(app, /const related = allRelated\.slice\(0, 8\);/);
  assert.match(app, /updateRelatedToggle\(backlinks\.length \+ allRelated\.length\)/);
  assert.match(app, /relatedCount\.textContent = String\(count\)/);
  assert.match(app, /if \(allRelated\.length > related\.length\) \{\s*relatedLimitNotice\.textContent = `\$\{allRelated\.length\}件中、\$\{related\.length\}件表示`;\s*relatedLimitNotice\.hidden = false;/);
  assert.match(app, /relatedLimitNotice\.hidden = true;\s*relatedLimitNotice\.textContent = "";/);
  assert.match(app, /このメモへのリンク/);
  assert.match(app, /このメモへのリンクはありません/);
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

test("右端の関連メモとロボット操作は上下に固定され、ドロワー表示中も右端に残る", () => {
  const relatedRule = css.match(/\.related-toggle\s*\{([\s\S]*?)\}/)?.[1] || "";
  const robotRule = css.match(/\.ai-robot-button\s*\{([\s\S]*?)\}/)?.[1] || "";
  assert.match(relatedRule, /top:\s*40vh/);
  assert.match(relatedRule, /right:\s*0/);
  assert.match(robotRule, /right:\s*0/);
  assert.match(robotRule, /bottom:\s*calc\(28px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /body\.related-open \.related-toggle\s*\{[^}]*right:\s*0/);
  assert.match(css, /\.ai-robot-button\s*\{[^}]*z-index:\s*var\(--z-ai-trigger\)/s);
  assert.doesNotMatch(css, /\.ai-robot-button\s*\{[^}]*right:\s*-/s);
  assert.doesNotMatch(css, /@container app-width[\s\S]*?\.ai-robot-button\s*\{[^}]*right:\s*-/s);
});
