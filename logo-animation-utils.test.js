const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AMBIENT_WAIT_MAX_MS,
  AMBIENT_WAIT_MIN_MS,
  LOGO_ANIMATION_DURATIONS,
  createAmbientMotionPlan,
  createLogoAnimationController,
  createStartupMotionPlan,
  createTentacleGeometry,
  motionSnapshot,
  normalizeLogoAnimation,
  tentacleStateAt
} = require("./logo-animation-utils.js");

function createFixture({ reducedMotion = false, visible = true, randomValues = [0.12, 0.82, 0.34, 0.73, 0.21, 0.91, 0.45, 0.66] } = {}) {
  const classes = new Set();
  const frames = new Map();
  const timers = new Map();
  const renders = [];
  const states = [];
  let nextFrameId = 0;
  let nextTimerId = 0;
  let randomIndex = 0;
  const element = {
    dataset: {},
    style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name))
    }
  };
  const windowObject = {
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      if (timers.has(id)) timers.get(id).cleared = true;
    }
  };
  const controller = createLogoAnimationController({
    element,
    windowObject,
    initialVisible: visible,
    random: () => randomValues[randomIndex++ % randomValues.length],
    requestFrame(callback) {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
    renderMotion: (snapshot) => renders.push(snapshot),
    onStateChange: (state) => states.push(state)
  });
  function runNextFrame(timestamp = 0) {
    const entry = frames.entries().next().value;
    assert.ok(entry, "pending RAF should exist");
    const [id, callback] = entry;
    frames.delete(id);
    callback(timestamp);
    return callback;
  }
  return { classes, controller, element, frames, renders, runNextFrame, states, timers };
}

test("旧設定値を維持しdailyと未知値を生体Nexusへ移行する", () => {
  for (const value of ["typewriter", "nexus", "scan", "off", "living-nexus"]) assert.equal(normalizeLogoAnimation(value), value);
  for (const value of ["daily", "", null, "unknown"]) assert.equal(normalizeLogoAnimation(value), "living-nexus");
});

test("起動演出は一度だけ予約され、実開始RAFの後に終了タイマーを作る", () => {
  const fixture = createFixture();
  assert.equal(fixture.controller.scheduleInitial(), true);
  assert.equal(fixture.controller.scheduleInitial(), false);
  assert.equal(fixture.frames.size, 1);
  assert.equal(fixture.timers.size, 0);
  fixture.runNextFrame(10);
  assert.equal(fixture.classes.has("is-animating"), false);
  assert.equal(fixture.timers.size, 0);
  fixture.runNextFrame(26);
  assert.equal(fixture.classes.has("is-animating"), true);
  assert.equal([...fixture.timers.values()][0].delay, LOGO_ANIMATION_DURATIONS["living-nexus"] + 160);
});

test("4本の起動触手は不等間隔で伸び、各状態を経て核へ戻る", () => {
  const plan = createStartupMotionPlan();
  assert.equal(plan.specs.length, 4);
  assert.deepEqual(plan.specs.map((spec) => spec.index), [0, 1, 2, 3]);
  const gaps = plan.specs.slice(1).map((spec, index) => spec.delay - plan.specs[index].delay);
  assert.ok(new Set(gaps).size > 1);
  assert.equal(new Set(plan.specs.map((spec) => spec.phaseOffset)).size, 4);
  assert.equal(new Set(plan.specs.map((spec) => spec.waveSpeed)).size, 4);
  assert.equal(new Set(plan.specs.map((spec) => spec.middleAmplitude)).size, 4);
  const spec = plan.specs[0];
  assert.equal(tentacleStateAt(spec, spec.delay - 1).phase, "waiting");
  assert.equal(tentacleStateAt(spec, spec.delay + 1).phase, "extending");
  assert.equal(tentacleStateAt(spec, spec.delay + spec.extendDuration + 1).phase, "waving");
  assert.equal(tentacleStateAt(spec, spec.delay + spec.extendDuration + spec.waveDuration + 1).phase, "holding");
  assert.equal(tentacleStateAt(spec, spec.delay + spec.extendDuration + spec.waveDuration + spec.holdDuration + 1).phase, "retracting");
  assert.deepEqual(tentacleStateAt(spec, plan.totalDuration + 1), {
    phase: "idle",
    extension: 1,
    rootBend: 0,
    middleBend: 0,
    tipBend: 0,
    tipLateral: 0,
    rootPhase: 0,
    middlePhase: 0,
    tipPhase: 0,
    nodePhase: 0,
    waveStrength: 0,
    tipStrength: 0,
    progress: 1
  });
});

test("触手内の波は根元・中間・先端・ノードへ位相差を伴って伝わる", () => {
  const spec = createStartupMotionPlan().specs[1];
  const state = tentacleStateAt(spec, spec.delay + spec.extendDuration + spec.waveDuration * 0.47);
  assert.equal(state.phase, "waving");
  assert.ok(Math.abs(state.rootPhase - state.middlePhase - spec.phaseLag) < 1e-10);
  assert.ok(Math.abs(state.middlePhase - state.tipPhase - spec.phaseLag) < 1e-10);
  assert.ok(Math.abs(state.tipPhase - state.nodePhase - spec.phaseLag * 0.58) < 1e-10);
  assert.ok(new Set([state.rootBend, state.middleBend, state.tipBend].map((value) => value.toFixed(4))).size >= 2);
  assert.ok(Math.abs(state.tipLateral) < spec.middleAmplitude);
});

test("伸長中から弱くうねり、保持で落ち着き、引き戻しで振幅を減衰する", () => {
  const spec = createStartupMotionPlan().specs[0];
  const extending = tentacleStateAt(spec, spec.delay + spec.extendDuration * 0.5);
  assert.equal(extending.phase, "extending");
  assert.ok(extending.waveStrength > 0 && extending.waveStrength < 0.46);
  assert.ok([extending.rootBend, extending.middleBend, extending.tipBend].some((value) => Math.abs(value) > 0.01));
  const holdingEarly = tentacleStateAt(spec, spec.delay + spec.extendDuration + spec.waveDuration + spec.holdDuration * 0.1);
  const holdingLate = tentacleStateAt(spec, spec.delay + spec.extendDuration + spec.waveDuration + spec.holdDuration * 0.9);
  assert.ok(holdingLate.waveStrength < holdingEarly.waveStrength);
  assert.ok(holdingLate.waveStrength > 0);
  const retractEarly = tentacleStateAt(spec, spec.delay + spec.extendDuration + spec.waveDuration + spec.holdDuration + spec.retractDuration * 0.2);
  const retractLate = tentacleStateAt(spec, spec.delay + spec.extendDuration + spec.waveDuration + spec.holdDuration + spec.retractDuration * 0.8);
  assert.ok(retractLate.waveStrength < retractEarly.waveStrength);
  assert.ok(retractLate.tipStrength < retractEarly.tipStrength);
  assert.ok(retractEarly.tipStrength > retractEarly.waveStrength);
});

test("触手は滑らかにつながる2区間曲線で、終点とノード座標を共有できる", () => {
  const center = { x: 22, y: 20 };
  const endpoint = { x: 38, y: 34 };
  const tentacle = {
    extension: 1.3,
    rootBend: 1.4,
    middleBend: -3.2,
    tipBend: 2.1,
    tipLateral: -0.72
  };
  const geometry = createTentacleGeometry({ center, endpoint, tentacle });
  assert.equal((geometry.path.match(/\bC/g) || []).length, 2);
  assert.ok(Math.abs((geometry.relayX - geometry.relayControlInX) - (geometry.relayControlOutX - geometry.relayX)) < 1e-10);
  assert.ok(Math.abs((geometry.relayY - geometry.relayControlInY) - (geometry.relayControlOutY - geometry.relayY)) < 1e-10);
  const length = Math.hypot(endpoint.x - center.x, endpoint.y - center.y);
  const expectedEndX = center.x + (endpoint.x - center.x) * tentacle.extension - ((endpoint.y - center.y) / length) * tentacle.tipLateral;
  const expectedEndY = center.y + (endpoint.y - center.y) * tentacle.extension + ((endpoint.x - center.x) / length) * tentacle.tipLateral;
  assert.equal(geometry.endX, expectedEndX);
  assert.equal(geometry.endY, expectedEndY);
  const reset = createTentacleGeometry({ center, endpoint, tentacle: tentacleStateAt(createStartupMotionPlan().specs[0], 99999) });
  assert.equal(reset.endX, endpoint.x);
  assert.equal(reset.endY, endpoint.y);
});

test("起動時の曲線と先端ノードは拡張したSVG表示領域に収まる", () => {
  const center = { x: 22, y: 20 };
  const endpoints = [{ x: 8, y: 7 }, { x: 37, y: 6 }, { x: 38, y: 34 }, { x: 7, y: 33 }];
  const plan = createStartupMotionPlan();
  for (let elapsed = 0; elapsed <= plan.totalDuration; elapsed += 80) {
    for (const spec of plan.specs) {
      const geometry = createTentacleGeometry({ center, endpoint: endpoints[spec.index], tentacle: tentacleStateAt(spec, elapsed) });
      const xs = [geometry.endX, geometry.relayX, geometry.rootControlX, geometry.relayControlInX, geometry.relayControlOutX, geometry.tipControlX];
      const ys = [geometry.endY, geometry.relayY, geometry.rootControlY, geometry.relayControlInY, geometry.relayControlOutY, geometry.tipControlY];
      assert.ok(Math.min(...xs) >= -2 && Math.max(...xs) <= 46, `tentacle ${spec.index} x should keep node radius inside viewBox`);
      assert.ok(Math.min(...ys) >= -2 && Math.max(...ys) <= 42, `tentacle ${spec.index} y should keep node radius inside viewBox`);
    }
  }
});

test("乱数端点を含む通常イベントもSVG境界で見切れない", () => {
  const center = { x: 22, y: 20 };
  const endpoints = [{ x: 8, y: 7 }, { x: 37, y: 6 }, { x: 38, y: 34 }, { x: 7, y: 33 }];
  for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
    const plan = createAmbientMotionPlan({ random: () => roll });
    for (let elapsed = 0; elapsed <= plan.totalDuration; elapsed += 100) {
      for (const spec of plan.specs) {
        const geometry = createTentacleGeometry({ center, endpoint: endpoints[spec.index], tentacle: tentacleStateAt(spec, elapsed) });
        const xs = [geometry.endX, geometry.relayX, geometry.rootControlX, geometry.relayControlInX, geometry.relayControlOutX, geometry.tipControlX];
        const ys = [geometry.endY, geometry.relayY, geometry.rootControlY, geometry.relayControlInY, geometry.relayControlOutY, geometry.tipControlY];
        assert.ok(Math.min(...xs) >= -2 && Math.max(...xs) <= 46);
        assert.ok(Math.min(...ys) >= -2 && Math.max(...ys) <= 42);
      }
    }
  }
});

test("アンビエント演出の状態は伸長・うねり・静止・引き戻しと遷移する", () => {
  const fixture = createFixture();
  assert.equal(fixture.controller.startAmbientEvent(), true);
  fixture.runNextFrame(100);
  const plan = fixture.controller.getLastAmbientPlan();
  const spec = plan.specs[0];
  assert.equal(fixture.controller.getState().phase, "extending");
  fixture.runNextFrame(100 + spec.extendDuration + 1);
  assert.equal(fixture.controller.getState().phase, "waving");
  fixture.runNextFrame(100 + spec.extendDuration + spec.waveDuration + 1);
  assert.equal(fixture.controller.getState().phase, "holding");
  fixture.runNextFrame(100 + spec.extendDuration + spec.waveDuration + spec.holdDuration + 1);
  assert.equal(fixture.controller.getState().phase, "retracting");
  fixture.runNextFrame(100 + plan.totalDuration + 1);
  assert.equal(fixture.controller.getState().waiting, true);
});

test("次回イベントは同じ触手・長さ・速度を連続させにくくする", () => {
  const constant = () => 0.2;
  const first = createAmbientMotionPlan({ random: constant });
  const second = createAmbientMotionPlan({ random: constant, previous: first });
  assert.notEqual(second.primary, first.primary);
  assert.notEqual(second.extension, first.extension);
  assert.notEqual(second.extendDuration, first.extendDuration);
  assert.notEqual(second.middleAmplitude, first.middleAmplitude);
  assert.notEqual(second.waves, first.waves);
  assert.notEqual(second.waveSpeed, first.waveSpeed);
  assert.notEqual(second.phaseOffset, first.phaseOffset);
  for (const spec of first.specs) {
    assert.ok(spec.waves >= 2 && spec.waves <= 4);
    assert.ok(spec.rootAmplitude !== spec.middleAmplitude);
    assert.ok(spec.tipFollow < spec.middleAmplitude);
  }
});

test("再実行は古いRAFとタイマーを無効化して先頭から再開する", () => {
  const fixture = createFixture();
  fixture.controller.play("typewriter");
  const staleStartCallback = fixture.frames.values().next().value;
  fixture.controller.play("scan");
  staleStartCallback(10);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.classes.has("is-animating"), false);
  assert.equal(fixture.element.dataset.logoAnimation, "scan");
  fixture.runNextFrame(20);
  assert.equal(fixture.classes.has("is-animating"), true);
  const firstTimer = [...fixture.timers.values()].at(-1);
  fixture.controller.play("nexus");
  assert.equal(firstTimer.cleared, true);
  assert.equal(fixture.classes.has("is-animating"), false);
  fixture.runNextFrame(30);
  assert.equal(fixture.element.dataset.logoAnimation, "nexus");
});

test("非表示中は停止し、再表示後に新しい待機を作る", () => {
  const fixture = createFixture();
  fixture.controller.scheduleAmbient();
  const firstTimer = [...fixture.timers.values()].at(-1);
  assert.ok(firstTimer.delay >= AMBIENT_WAIT_MIN_MS && firstTimer.delay <= AMBIENT_WAIT_MAX_MS);
  fixture.controller.handleVisibilityChange(false);
  assert.equal(firstTimer.cleared, true);
  assert.equal(fixture.controller.startAmbientEvent(), false);
  fixture.controller.handleVisibilityChange(true);
  assert.equal([...fixture.timers.values()].filter((timer) => !timer.cleared).length, 1);
});

test("reduced motionとoffではRAF・待機タイマーを作らない", () => {
  const reduced = createFixture({ reducedMotion: true });
  assert.equal(reduced.controller.play(), false);
  assert.equal(reduced.controller.scheduleAmbient(), false);
  assert.equal(reduced.frames.size, 0);
  assert.equal(reduced.timers.size, 0);
  const off = createFixture();
  off.controller.setSetting("off", { scheduleAmbient: true });
  assert.equal(off.controller.play(), false);
  assert.equal(off.frames.size, 0);
  assert.equal(off.timers.size, 0);
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

test("未選択の触手は静止状態に保つ", () => {
  const snapshot = motionSnapshot(createAmbientMotionPlan({ random: () => 0.1 }), 1);
  assert.equal(snapshot.tentacles.length, 4);
  assert.equal(snapshot.tentacles.filter((item) => item.phase === "idle").length, 3);
  const idle = snapshot.tentacles.find((item) => item.phase === "idle");
  assert.deepEqual([idle.rootBend, idle.middleBend, idle.tipBend, idle.tipLateral], [0, 0, 0, 0]);
});
