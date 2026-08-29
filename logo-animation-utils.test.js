const assert = require("node:assert/strict");
const test = require("node:test");
const { LOGO_ANIMATION_DURATION_MS, createLogoAnimationController } = require("./logo-animation-utils.js");

function createFixture({ reducedMotion = false } = {}) {
  const classes = new Set();
  const frames = [];
  const timers = new Map();
  let nextTimerId = 0;
  const element = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name)
    }
  };
  const windowObject = {
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout: (callback, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      if (timers.has(id)) timers.get(id).cleared = true;
    }
  };
  const controller = createLogoAnimationController({
    element,
    windowObject,
    requestFrame: (callback) => frames.push(callback)
  });
  return { classes, controller, frames, timers };
}

test("初回演出はアプリ起動中に一度だけ予約する", () => {
  const fixture = createFixture();
  assert.equal(fixture.controller.scheduleInitial(), true);
  assert.equal(fixture.controller.scheduleInitial(), false);
  assert.equal(fixture.frames.length, 1);

  fixture.frames.shift()();
  assert.equal(fixture.frames.length, 1);
  fixture.frames.shift()();
  assert.equal(fixture.classes.has("is-animating"), true);
  assert.equal([...fixture.timers.values()][0].delay, LOGO_ANIMATION_DURATION_MS);
});

test("再生中の再実行は古いRAFとタイマーを無効化して最初から再開する", () => {
  const fixture = createFixture();
  fixture.controller.play();
  const staleFrame = fixture.frames.shift();
  const firstTimer = [...fixture.timers.values()][0];

  fixture.controller.play();
  const currentFrame = fixture.frames.shift();
  assert.equal(firstTimer.cleared, true);
  assert.equal(fixture.classes.has("is-animating"), false);

  staleFrame();
  assert.equal(fixture.classes.has("is-animating"), false);
  currentFrame();
  assert.equal(fixture.classes.has("is-animating"), true);

  const activeTimer = [...fixture.timers.values()].at(-1);
  activeTimer.callback();
  assert.equal(fixture.classes.has("is-animating"), false);
});

test("reduced motionでは一括表示の静止状態を維持する", () => {
  const fixture = createFixture({ reducedMotion: true });
  assert.equal(fixture.controller.prefersReducedMotion(), true);
  assert.equal(fixture.controller.play(), false);
  assert.equal(fixture.frames.length, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.classes.has("is-animating"), false);
});

test("要素がない場合も初期化と再生を安全に無視する", () => {
  const controller = createLogoAnimationController({
    element: null,
    windowObject: { matchMedia: () => ({ matches: false }), clearTimeout: () => {}, setTimeout: () => 1 },
    requestFrame: () => assert.fail("RAF should not run")
  });
  assert.equal(controller.scheduleInitial(), false);
  assert.equal(controller.play(), false);
});
