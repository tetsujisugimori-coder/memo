const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const header = html.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] || "";

test("タイトルは結節点SVGを持つキーボード操作可能なbuttonである", () => {
  assert.match(header, /<button id="memoNexusLogo" class="memo-nexus-logo" type="button" aria-label="Memo Nexus ロゴアニメーションを再生">/);
  assert.match(header, /<svg viewBox="0 0 34 34" focusable="false">/);
  assert.equal((header.match(/memo-nexus-logo-node memo-nexus-logo-node-/g) || []).length, 4);
  assert.equal((header.match(/memo-nexus-logo-link memo-nexus-logo-link-/g) || []).length, 2);
  assert.match(header, /memo-nexus-logo-core-halo/);
  assert.match(header, /memo-nexus-logo-core"/);
  const logoButton = header.match(/<button id="memoNexusLogo"[\s\S]*?<\/button>/)?.[0] || "";
  assert.equal(logoButton.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(), "Memo Nexus");
  assert.match(css, /\.memo-nexus-logo-mark[^}]*pointer-events:\s*none;/);
  assert.match(css, /\.memo-nexus-logo:hover/);
  assert.match(css, /\.memo-nexus-logo:focus-visible/);
});

test("固定演出だけを初回一度とクリック時へ接続する", () => {
  assert.doesNotMatch(html, /id="logoAnimationSelect"/);
  assert.match(app, /const logoAnimationController = createLogoAnimationController\(/);
  assert.match(app, /function scheduleInitialLogoAnimation\(\) \{\s*logoAnimationController\.scheduleInitial\(\);\s*\}/);
  assert.match(app, /scheduleInitialLogoAnimation\(\);/);
  assert.match(app, /memoNexusLogo\.addEventListener\("click", logoAnimationController\.play\)/);
  assert.match(app, /event\.animationName === "memo-nexus-logo-cycle"\) logoAnimationController\.finish\(\)/);
  assert.doesNotMatch(app, /cycleLogoAnimation|LOGO_ANIMATION_STORAGE_KEY|localStorage\.setItem\([^\n]*logo/i);
});

test("演出は核・ノード、逐次文字、カーソルと接続線の順で1.5秒以内に終わる", () => {
  assert.match(css, /memo-nexus-logo-cycle 1500ms linear/);
  assert.match(css, /memo-nexus-logo-core-awake 400ms/);
  assert.match(css, /memo-nexus-logo-node-awake 320ms/);
  assert.match(css, /calc\(420ms \+ var\(--memo-nexus-logo-delay\) \* 72ms\)/);
  assert.match(css, /memo-nexus-logo-caret-once 260ms ease-out 1190ms/);
  assert.match(css, /memo-nexus-logo-link-glow 280ms ease-out 1200ms/);
  const lastLetterEndMs = 420 + (8 * 72) + 110;
  assert.ok(lastLetterEndMs <= 1200);
  assert.ok(1200 + 280 <= 1500);
});

test("通常時は文字を静止し結節点だけを弱く動かす", () => {
  assert.doesNotMatch(css, /\.memo-nexus-logo-word\s*\{[^}]*animation:/s);
  assert.match(css, /memo-nexus-logo-breathe 4\.8s ease-in-out infinite/);
  assert.match(css, /memo-nexus-logo-drift-a 7\.2s ease-in-out infinite/);
  assert.doesNotMatch(css, /\.memo-nexus-logo\s*\{[^}]*animation:[^;}]*infinite/s);
});

test("reduced motionでは文字・ノード・カーソルを静止状態にする", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.memo-nexus-logo,[\s\S]*?animation:\s*none !important;/);
  assert.match(css, /\.memo-nexus-logo\.is-animating \.memo-nexus-logo-letter \{\s*opacity:\s*1;\s*transform:\s*none;/);
  assert.match(css, /\.memo-nexus-logo\.is-animating \.memo-nexus-logo-caret \{\s*opacity:\s*0;/);
});

test("モバイル幅ではロゴと結節点を縮小する", () => {
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*?\.memo-nexus-logo \{[\s\S]*?width:\s*156px;/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*?\.memo-nexus-logo-mark \{[\s\S]*?width:\s*28px;/);
});
