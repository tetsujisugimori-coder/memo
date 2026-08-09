const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");
const controllerStart = app.indexOf("function restoreLogoAnimationSetting(");
const controllerEnd = app.indexOf("\nfunction syncLayoutMode(", controllerStart);
const controllerSource = app.slice(controllerStart, controllerEnd);

function createLogoController({ storedValue = "daily", reducedMotion = false } = {}) {
  const classes = new Set();
  const logo = {
    dataset: {},
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    setAttribute: () => {}
  };
  const select = { value: "" };
  const frames = [];
  const timers = [];
  const storage = { value: storedValue, getItem: () => storage.value, setItem: (_key, value) => { storage.value = value; } };
  const controller = new Function("memoNexusLogo", "logoAnimationSelect", "localStorage", "window", "requestAnimationFrame", "nextLogoAnimationInCycle", "normalizeLogoAnimation", "resolveLogoAnimation", "LOGO_ANIMATION_STORAGE_KEY", `
    let logoAnimationSetting = "daily";
    let logoAnimationSessionOverride = null;
    let logoAnimationCleanupTimer = null;
    let logoInitialAnimationScheduled = false;
    let logoAnimationRequestId = 0;
    ${controllerSource}
    return { restoreLogoAnimationSetting, saveLogoAnimationSetting, playLogoAnimation, cycleLogoAnimation, scheduleInitialLogoAnimation, finishLogoAnimation, getSetting: () => logoAnimationSetting, getSessionAnimation: () => logoAnimationSessionOverride };
  `)(
    logo,
    select,
    storage,
    { matchMedia: () => ({ matches: reducedMotion }), clearTimeout: () => {}, setTimeout: (callback) => { timers.push(callback); return timers.length; } },
    (callback) => frames.push(callback),
    require("./logo-animation-utils.js").nextLogoAnimation,
    require("./logo-animation-utils.js").normalizeLogoAnimation,
    require("./logo-animation-utils.js").resolveLogoAnimation,
    "memo-nexus-logo-animation"
  );
  return { classes, controller, frames, logo, select, storage, timers };
}

test("ロゴはアクセシブルなbuttonと非干渉の装飾レイヤーを持つ", () => {
  const header = html.match(/<header class="app-header">[\s\S]*?<\/header>/)?.[0] || "";
  assert.match(header, /<button id="memoNexusLogo" class="memo-nexus-logo" type="button" aria-label="次のロゴアニメーションを表示">/);
  assert.match(header, /memo-nexus-logo-nexus" aria-hidden="true"/);
  assert.match(header, /memo-nexus-logo-scan" aria-hidden="true"/);
  assert.match(css, /\.memo-nexus-logo-nexus,[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /\.memo-nexus-logo:focus-visible/);
  assert.match(css, /white-space:\s*nowrap;/);
});

test("設定、初回再生、クリック再生、終了時解除とreduced motion停止を接続する", () => {
  assert.match(html, /id="logoAnimationSelect"/);
  ["daily", "typewriter", "nexus", "scan", "off"].forEach((value) => assert.match(html, new RegExp(`<option value="${value}"`)));
  assert.match(app, /const LOGO_ANIMATION_STORAGE_KEY = "memo-nexus-logo-animation"/);
  assert.match(app, /restoreLogoAnimationSetting\(\);/);
  assert.match(app, /scheduleInitialLogoAnimation\(\);/);
  assert.match(app, /memoNexusLogo\.addEventListener\("click", cycleLogoAnimation\)/);
  assert.match(app, /const \{ nextLogoAnimation: nextLogoAnimationInCycle,/);
  assert.match(app, /event\.animationName === "memo-nexus-logo-cycle"\) finishLogoAnimation\(\)/);
  assert.match(app, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(app, /if \(animation === "off"\) return;/);
  assert.match(app, /memoNexusLogo\.classList\.remove\("is-animating"\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.memo-nexus-logo[\s\S]*?animation:\s*none !important;/);
});

test("初回・再生・オフ・reduced motionのロゴ状態を安全に切り替える", () => {
  const fixture = createLogoController({ storedValue: "invalid" });
  fixture.controller.restoreLogoAnimationSetting();
  assert.equal(fixture.controller.getSetting(), "daily");
  assert.equal(fixture.select.value, "daily");
  fixture.controller.scheduleInitialLogoAnimation();
  fixture.controller.scheduleInitialLogoAnimation();
  assert.equal(fixture.frames.length, 1);
  fixture.frames.shift()();
  fixture.frames.shift()();
  assert.equal(fixture.classes.has("is-animating"), true);
  fixture.controller.finishLogoAnimation();
  assert.equal(fixture.classes.has("is-animating"), false);
  assert.equal("logoAnimation" in fixture.logo.dataset, false);
  fixture.controller.saveLogoAnimationSetting("off");
  fixture.controller.playLogoAnimation();
  assert.equal(fixture.classes.has("is-animating"), false);

  const reduced = createLogoController({ storedValue: "scan", reducedMotion: true });
  reduced.controller.restoreLogoAnimationSetting();
  reduced.controller.playLogoAnimation();
  assert.equal(reduced.frames.length, 0);
  assert.equal(reduced.classes.has("is-animating"), false);
});

test("3種類のロゴ演出は有限で専用クラスに限定する", () => {
  assert.match(css, /data-logo-animation="typewriter"/);
  assert.match(css, /data-logo-animation="nexus"/);
  assert.match(css, /data-logo-animation="scan"/);
  assert.match(css, /memo-nexus-logo-cycle 1250ms linear/);
  assert.doesNotMatch(css, /memo-nexus-logo[^\{]*\{[^}]*animation:[^;}]*infinite/s);
});

test("Nexusの枠完成とグローは最後の文字の表示後に始まる", () => {
  const lastLetterEndMs = 80 + 8 * 75 + 110;
  const rightAndBottomDelay = Number(css.match(/memo-nexus-logo-frame-bottom \{ animation: memo-nexus-logo-frame-finish 270ms ease-out (\d+)ms forwards; \}/)?.[1]);
  const nodeAndGlowDelay = Number(css.match(/memo-nexus-logo-node-end \{ animation: memo-nexus-logo-node-arrive 120ms ease-out (\d+)ms forwards; \}/)?.[1]);
  assert.ok(rightAndBottomDelay > lastLetterEndMs);
  assert.equal(nodeAndGlowDelay, rightAndBottomDelay + 270);
  assert.match(css, /memo-nexus-logo-text \{ animation: memo-nexus-logo-nexus-glow 190ms ease-out 1100ms; \}/);
});

test("クリックは設定を保存せず次の演出へ安全に循環する", () => {
  const fixture = createLogoController({ storedValue: "typewriter" });
  fixture.controller.restoreLogoAnimationSetting();
  fixture.controller.cycleLogoAnimation();
  assert.equal(fixture.controller.getSetting(), "typewriter");
  assert.equal(fixture.controller.getSessionAnimation(), "nexus");
  fixture.frames.shift()();
  assert.equal(fixture.logo.dataset.logoAnimation, "nexus");
  fixture.controller.cycleLogoAnimation();
  assert.equal(fixture.controller.getSessionAnimation(), "scan");
  fixture.frames.shift()();
  assert.equal(fixture.logo.dataset.logoAnimation, "scan");
  fixture.controller.cycleLogoAnimation();
  assert.equal(fixture.controller.getSessionAnimation(), "typewriter");
  assert.equal(fixture.storage.value, "typewriter");

  const reduced = createLogoController({ storedValue: "scan", reducedMotion: true });
  reduced.controller.restoreLogoAnimationSetting();
  reduced.controller.cycleLogoAnimation();
  assert.equal(reduced.controller.getSessionAnimation(), "typewriter");
  assert.equal(reduced.frames.length, 0);
});
