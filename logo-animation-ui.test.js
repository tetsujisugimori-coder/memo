const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const header = html.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] || "";
const logoButton = header.match(/<button id="memoNexusLogo"[\s\S]*?<\/button>/)?.[0] || "";

test("タイトルは4本の触手を持つキーボード操作可能なbuttonである", () => {
  assert.match(logoButton, /type="button" aria-label="Memo Nexus ロゴアニメーションを再生"/);
  assert.match(logoButton, /<svg viewBox="-4 -4 52 48" focusable="false">/);
  assert.equal((logoButton.match(/data-logo-tentacle="[0-3]"/g) || []).length, 4);
  assert.equal((logoButton.match(/data-logo-node="[0-3]"/g) || []).length, 4);
  assert.equal((logoButton.match(/d="M22 20 C[^\"]+ C/g) || []).length, 4);
  assert.match(logoButton, /memo-nexus-logo-core-halo/);
  assert.equal(logoButton.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(), "Memo Nexus");
});

test("触手の経路とノード位置は同じスナップショットから更新される", () => {
  const renderer = app.match(/function renderLogoTentaclesFor\(element, snapshot\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(renderer, /createTentacleGeometry\(\{ center: LOGO_TENTACLE_CENTER, endpoint: base, tentacle \}\)/);
  assert.match(renderer, /path\.setAttribute\("d", geometry\.path\)/);
  assert.match(renderer, /node\.setAttribute\("cx"/);
  assert.match(renderer, /node\.setAttribute\("cy"/);
  assert.match(renderer, /geometry\.endX/);
  assert.match(renderer, /geometry\.endY/);
});

test("5種類の選択カードは名称・説明・デモ・排他的なラジオを持つ", () => {
  const cards = html.match(/<div class="logo-animation-card[^>]*data-logo-animation-card="[^"]+">/g) || [];
  assert.equal(cards.length, 5);
  for (const [value, label] of [
    ["living-nexus", "生体Nexus"],
    ["typewriter", "タイプライター"],
    ["nexus", "Nexus接続"],
    ["scan", "光の走査"],
    ["off", "オフ"]
  ]) {
    assert.match(html, new RegExp(`type="radio" name="logoAnimationSetting" value="${value}"`));
    assert.match(html, new RegExp(`data-logo-animation-demo="${value}"`));
    assert.match(html, new RegExp(`<strong>${label}</strong>`));
  }
  assert.match(html, /id="logoAnimationCards"[^>]*role="radiogroup"/);
  assert.equal((html.match(/<input[^>]+name="logoAnimationSetting"[^>]+checked>/g) || []).length, 1);
  assert.equal((html.match(/data-logo-animation-preview=/g) || []).length, 4);
  assert.equal((html.match(/>演出を再生<\/button>/g) || []).length, 4);
  assert.match(html, /logo-animation-card-standard">標準</);
  assert.match(html, /logo-animation-card-static-note">アニメーションなし</);
  assert.match(html, /aria-label="オフは静止表示のため再生できません"/);
});

test("5種類のデモは共通DOMへ種類別の代表静止ポーズを適用する", () => {
  assert.match(app, /memoNexusLogo\.childNodes[\s\S]*node\.cloneNode\(true\)/);
  assert.match(app, /applyLogoAnimationPreviewPose\(demo, setting\)/);
  assert.match(app, /clearLogoAnimationPreviewPose\(target\)/);
  for (const pose of ["living-complete", "typewriter-caret", "nexus-connected", "scan-midpoint", "off-static"]) {
    assert.match(css, new RegExp(`data-logo-preview-pose="${pose}"`));
  }
  assert.match(css, /typewriter-caret[^}]*memo-nexus-logo-caret[^}]*opacity:\s*0\.74/);
  assert.match(css, /nexus-connected[^}]*memo-nexus-logo-tentacle/);
  assert.match(css, /scan-midpoint[^}]*memo-nexus-logo-scan[^}]*translateX\(96px\)/);
});

test("カード選択・デモ・適用・キャンセルは保存経路を分離する", () => {
  assert.match(html, /id="applyLogoAnimationBtn"/);
  assert.match(html, /id="resetLogoAnimationBtn"/);
  assert.match(app, /const LOGO_ANIMATION_STORAGE_KEY = "memo-nexus-logo-animation"/);
  const selection = app.match(/function selectLogoAnimationSetting\(value,[\s\S]*?\n\}/)?.[0] || "";
  const preview = app.match(/function previewLogoAnimation\(value\) \{[\s\S]*?\n\}/)?.[0] || "";
  const save = app.match(/function saveLogoAnimationSetting\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const cancel = app.match(/function resetLogoAnimationSettingsPreview\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(selection, /applyLogoAnimationSetting\(state\.selected\)/);
  assert.match(preview, /logoAnimationPreviewManager\.play\(preview, target\)/);
  assert.match(app, /node\.cloneNode\(true\)/);
  assert.match(app, /createLogoAnimationController\(\{/);
  assert.doesNotMatch(selection, /localStorage\.setItem/);
  assert.doesNotMatch(preview, /localStorage\.setItem/);
  assert.match(save, /localStorage\.setItem\(LOGO_ANIMATION_STORAGE_KEY, nextSetting\)/);
  assert.match(cancel, /logoAnimationSettingsSession\.cancel\(\)/);
  assert.match(cancel, /scheduleAmbient: true/);
  assert.match(app, /selectLogoAnimationSetting\("living-nexus"\)/);
  assert.match(app, /storedSetting === "daily"/);
});

test("クリックは選択済み演出だけを再生し、保存や画面遷移を呼ばない", () => {
  const clickBinding = app.match(/memoNexusLogo\.addEventListener\("click",[\s\S]*?\n\s*\}\);/)?.[0] || "";
  assert.match(clickBinding, /logoAnimationController\.getSetting\(\)/);
  assert.match(clickBinding, /logoAnimationController\.play\(reflectedSetting/);
  assert.doesNotMatch(clickBinding, /localStorage|saveLogo|saveCurrent|openNote|createNote|location\s*=/i);
  assert.match(app, /event\.animationName === "memo-nexus-logo-cycle"\) logoAnimationController\.finish\(\)/);
});

test("額縁は角丸なしの二重枠で四辺を時間差描画する", () => {
  assert.equal((logoButton.match(/memo-nexus-logo-frame-side memo-nexus-logo-frame-side-/g) || []).length, 4);
  assert.equal((logoButton.match(/memo-nexus-logo-frame-corner memo-nexus-logo-frame-corner-/g) || []).length, 4);
  assert.match(css, /\.memo-nexus-logo \{[\s\S]*?border-radius:\s*0;/);
  assert.match(css, /\.memo-nexus-logo::after[^}]*border:\s*1px solid/);
  assert.match(css, /memo-nexus-logo-frame-side-top[^}]*animation-delay:\s*100ms/);
  assert.match(css, /memo-nexus-logo-frame-side-right[^}]*animation-delay:\s*210ms/);
  assert.match(css, /@keyframes memo-nexus-logo-frame-x/);
  assert.match(css, /@keyframes memo-nexus-logo-frame-y/);
  assert.match(css, /data-logo-active-tentacle/);
});

test("通常時は核だけが弱く呼吸し、旧演出にはランダム触手を付けない", () => {
  assert.match(css, /data-logo-animation="living-nexus"[^}]*memo-nexus-logo-core[^}]*memo-nexus-logo-breathe 5\.8s/);
  assert.doesNotMatch(css, /memo-nexus-logo-drift-/);
  assert.match(app, /logoAnimationController\.setSetting\(setting, \{ scheduleAmbient \}\)/);
});

test("reduced motionとoffはロゴ全体を静止させる", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.memo-nexus-logo,[\s\S]*?animation:\s*none !important;/);
  assert.match(css, /transition:\s*none !important/);
  assert.match(css, /data-logo-animation="off"[^}]*animation:\s*none !important/);
  assert.match(css, /\.memo-nexus-logo\.is-animating \.memo-nexus-logo-letter \{\s*opacity:\s*1;\s*transform:\s*none;/);
});

test("モバイル幅では額縁と結節点を縮小する", () => {
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*?\.memo-nexus-logo \{[\s\S]*?width:\s*176px;/);
  assert.match(css, /@container app-width \(max-width: 719\.98px\)[\s\S]*?\.memo-nexus-logo-mark \{[\s\S]*?width:\s*36px;/);
  assert.match(css, /\.logo-animation-cards \{ grid-template-columns:\s*minmax\(0, 1fr\); \}/);
});
