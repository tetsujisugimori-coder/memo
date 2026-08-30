(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusLogoAnimationUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const LOGO_ANIMATION_SETTINGS = ["living-nexus", "typewriter", "nexus", "scan", "off"];
  const LOGO_ANIMATION_DURATIONS = {
    "living-nexus": 9600,
    typewriter: 1450,
    nexus: 1800,
    scan: 1100,
    off: 0
  };
  const AMBIENT_WAIT_MIN_MS = 12000;
  const AMBIENT_WAIT_MAX_MS = 35000;
  const TENTACLE_COUNT = 4;

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function easeInOut(value) {
    const progress = clamp(value);
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function normalizeLogoAnimation(value) {
    if (value === "daily" || value == null || value === "") return "living-nexus";
    return LOGO_ANIMATION_SETTINGS.includes(value) ? value : "living-nexus";
  }

  function randomBetween(random, minimum, maximum) {
    return minimum + clamp(Number(random()) || 0) * (maximum - minimum);
  }

  function createIdleTentacleState(phase = "idle", progress = 1) {
    return {
      phase,
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
      progress
    };
  }

  function motionSpecEnd(spec) {
    return spec.delay + spec.extendDuration + spec.waveDuration + spec.holdDuration + spec.retractDuration;
  }

  function logoCoordinate(value) {
    return Number(value.toFixed(2));
  }

  function createTentacleGeometry({ center, endpoint, tentacle }) {
    const centerX = Number(center?.x) || 0;
    const centerY = Number(center?.y) || 0;
    const dx = (Number(endpoint?.x) || 0) - centerX;
    const dy = (Number(endpoint?.y) || 0) - centerY;
    const baseLength = Math.hypot(dx, dy) || 1;
    const directionX = dx / baseLength;
    const directionY = dy / baseLength;
    const perpendicularX = -directionY;
    const perpendicularY = directionX;
    const extension = Number.isFinite(tentacle?.extension) ? tentacle.extension : 1;
    const rootBend = Number.isFinite(tentacle?.rootBend) ? tentacle.rootBend : 0;
    const middleBend = Number.isFinite(tentacle?.middleBend) ? tentacle.middleBend : 0;
    const tipBend = Number.isFinite(tentacle?.tipBend) ? tentacle.tipBend : 0;
    const tipLateral = Number.isFinite(tentacle?.tipLateral) ? tentacle.tipLateral : 0;
    const span = baseLength * extension;
    const endX = centerX + directionX * span + perpendicularX * tipLateral;
    const endY = centerY + directionY * span + perpendicularY * tipLateral;
    const relayX = centerX + directionX * span * 0.54 + perpendicularX * middleBend;
    const relayY = centerY + directionY * span * 0.54 + perpendicularY * middleBend;
    const jointAlong = span * 0.16;
    const jointAcross = (tipBend - rootBend) * 0.16;
    const jointX = directionX * jointAlong + perpendicularX * jointAcross;
    const jointY = directionY * jointAlong + perpendicularY * jointAcross;
    const rootControlX = centerX + directionX * span * 0.18 + perpendicularX * rootBend;
    const rootControlY = centerY + directionY * span * 0.18 + perpendicularY * rootBend;
    const relayControlInX = relayX - jointX;
    const relayControlInY = relayY - jointY;
    const relayControlOutX = relayX + jointX;
    const relayControlOutY = relayY + jointY;
    const tipControlX = endX - directionX * span * 0.18 + perpendicularX * tipBend;
    const tipControlY = endY - directionY * span * 0.18 + perpendicularY * tipBend;
    const path = `M${logoCoordinate(centerX)} ${logoCoordinate(centerY)} C${logoCoordinate(rootControlX)} ${logoCoordinate(rootControlY)} ${logoCoordinate(relayControlInX)} ${logoCoordinate(relayControlInY)} ${logoCoordinate(relayX)} ${logoCoordinate(relayY)} C${logoCoordinate(relayControlOutX)} ${logoCoordinate(relayControlOutY)} ${logoCoordinate(tipControlX)} ${logoCoordinate(tipControlY)} ${logoCoordinate(endX)} ${logoCoordinate(endY)}`;
    return {
      path,
      endX,
      endY,
      relayX,
      relayY,
      rootControlX,
      rootControlY,
      relayControlInX,
      relayControlInY,
      relayControlOutX,
      relayControlOutY,
      tipControlX,
      tipControlY
    };
  }

  function createStartupMotionPlan() {
    const specs = [
      { index: 0, delay: 1540, extension: 1.34, extendDuration: 760, waveDuration: 3630, waves: 2.25, waveSpeed: 0.62, phaseOffset: 0.18, phaseLag: 0.78, rootAmplitude: 2.05, middleAmplitude: 3.1, tipAmplitude: 2.52, tipFollow: 0.68, holdDuration: 460, retractDuration: 920 },
      { index: 1, delay: 1830, extension: 1.42, extendDuration: 880, waveDuration: 4120, waves: 2.8, waveSpeed: 0.68, phaseOffset: 1.32, phaseLag: 0.94, rootAmplitude: 2.28, middleAmplitude: 3.48, tipAmplitude: 2.78, tipFollow: 0.82, holdDuration: 540, retractDuration: 1020 },
      { index: 2, delay: 2210, extension: 1.37, extendDuration: 720, waveDuration: 3710, waves: 2.15, waveSpeed: 0.58, phaseOffset: 2.46, phaseLag: 0.72, rootAmplitude: 1.86, middleAmplitude: 2.94, tipAmplitude: 2.35, tipFollow: 0.62, holdDuration: 620, retractDuration: 860 },
      { index: 3, delay: 2470, extension: 1.46, extendDuration: 940, waveDuration: 4310, waves: 3.1, waveSpeed: 0.72, phaseOffset: 3.74, phaseLag: 1.02, rootAmplitude: 2.46, middleAmplitude: 3.78, tipAmplitude: 3.02, tipFollow: 0.88, holdDuration: 480, retractDuration: 1080 }
    ];
    return { kind: "startup", specs, totalDuration: LOGO_ANIMATION_DURATIONS["living-nexus"] };
  }

  function createAmbientMotionPlan({ random = Math.random, previous = null } = {}) {
    const firstRoll = randomBetween(random, 0, TENTACLE_COUNT);
    let primary = Math.min(TENTACLE_COUNT - 1, Math.floor(firstRoll));
    if (primary === previous?.primary) primary = (primary + 1 + Math.floor(randomBetween(random, 0, 2))) % TENTACLE_COUNT;
    const count = randomBetween(random, 0, 1) > 0.64 ? 2 : 1;
    const indices = [primary];
    if (count === 2) {
      const offset = 1 + Math.floor(randomBetween(random, 0, TENTACLE_COUNT - 1));
      indices.push((primary + offset) % TENTACLE_COUNT);
    }

    let extension = randomBetween(random, 1.18, 1.46);
    if (previous && Math.abs(extension - previous.extension) < 0.045) {
      extension = extension > 1.32 ? extension - 0.09 : extension + 0.09;
    }
    let extendDuration = Math.round(randomBetween(random, 920, 1640));
    if (previous && Math.abs(extendDuration - previous.extendDuration) < 90) extendDuration += extendDuration > 1280 ? -170 : 170;
    const holdDuration = Math.round(randomBetween(random, 420, 1250));
    const retractDuration = Math.round(randomBetween(random, 900, 1750));
    let middleAmplitude = randomBetween(random, 1.9, 4.35);
    if (previous && Math.abs(middleAmplitude - previous.middleAmplitude) < 0.15) middleAmplitude = clamp(middleAmplitude + (middleAmplitude > 3.1 ? -0.38 : 0.38), 1.9, 4.35);
    let waves = randomBetween(random, 2.05, 4);
    if (previous && Math.abs(waves - previous.waves) < 0.15) waves = clamp(waves + (waves > 3 ? -0.42 : 0.42), 2.05, 4);
    let waveSpeed = randomBetween(random, 0.5, 0.74);
    if (previous && Math.abs(waveSpeed - previous.waveSpeed) < 0.025) waveSpeed = clamp(waveSpeed + (waveSpeed > 0.62 ? -0.07 : 0.07), 0.5, 0.74);
    const phaseLag = randomBetween(random, 0.7, 1.08);
    let phaseOffset = randomBetween(random, 0, Math.PI * 2);
    if (previous && Math.abs(phaseOffset - previous.phaseOffset) < 0.12) phaseOffset = (phaseOffset + 0.73) % (Math.PI * 2);

    const specs = indices.map((index, order) => {
      const specWaves = clamp(waves + (order ? randomBetween(random, -0.55, 0.55) : 0), 2, 4);
      const specWaveSpeed = clamp(waveSpeed + (order ? randomBetween(random, -0.1, 0.1) : 0), 0.46, 0.78);
      const specMiddleAmplitude = middleAmplitude + (order ? randomBetween(random, -0.42, 0.42) : 0);
      return {
        index,
        delay: order === 0 ? 0 : Math.round(randomBetween(random, 170, 430)),
        extension: clamp(extension + (order ? randomBetween(random, -0.07, 0.07) : 0), 1.16, 1.48),
        extendDuration: Math.round(extendDuration + (order ? randomBetween(random, -180, 180) : 0)),
        waveDuration: Math.round(specWaves / specWaveSpeed * 1000),
        waves: specWaves,
        waveSpeed: specWaveSpeed,
        phaseOffset: phaseOffset + order * randomBetween(random, 0.42, 1.08),
        phaseLag: phaseLag + (order ? randomBetween(random, -0.12, 0.12) : 0),
        rootAmplitude: specMiddleAmplitude * randomBetween(random, 0.58, 0.76),
        middleAmplitude: specMiddleAmplitude,
        tipAmplitude: specMiddleAmplitude * randomBetween(random, 0.72, 0.92),
        tipFollow: specMiddleAmplitude * randomBetween(random, 0.18, 0.29),
        holdDuration: Math.round(holdDuration + (order ? randomBetween(random, -160, 160) : 0)),
        retractDuration: Math.round(retractDuration + (order ? randomBetween(random, -180, 180) : 0))
      };
    });
    const totalDuration = Math.max(...specs.map(motionSpecEnd));
    return { kind: "ambient", primary, extension, extendDuration, middleAmplitude, waves, waveSpeed, phaseOffset, specs, totalDuration };
  }

  function tentacleStateAt(spec, elapsed) {
    const local = elapsed - spec.delay;
    const extendEnd = spec.extendDuration;
    const waveEnd = extendEnd + spec.waveDuration;
    const holdEnd = waveEnd + spec.holdDuration;
    const retractEnd = holdEnd + spec.retractDuration;
    if (local < 0) return createIdleTentacleState("waiting", 0);
    let phase;
    let progress;
    let extension;
    let cycle;
    let waveStrength;
    let tipStrength;
    if (local < extendEnd) {
      phase = "extending";
      progress = clamp(local / spec.extendDuration);
      extension = 1 + (spec.extension - 1) * easeInOut(progress);
      cycle = progress * 0.36 * (spec.waveSpeed / 0.62);
      waveStrength = Math.sin(progress * Math.PI / 2) * 0.46;
      tipStrength = waveStrength * 0.88;
    } else if (local < waveEnd) {
      phase = "waving";
      progress = clamp((local - extendEnd) / spec.waveDuration);
      extension = spec.extension;
      cycle = 0.36 * (spec.waveSpeed / 0.62) + progress * spec.waves;
      waveStrength = 0.46 + 0.54 * easeInOut(clamp(progress / 0.28));
      tipStrength = waveStrength;
    } else if (local < holdEnd) {
      phase = "holding";
      progress = clamp((local - waveEnd) / spec.holdDuration);
      extension = spec.extension;
      cycle = 0.36 * (spec.waveSpeed / 0.62) + spec.waves + progress * 0.14 * (spec.waveSpeed / 0.62);
      waveStrength = 1 - 0.76 * easeInOut(progress);
      tipStrength = 1 - 0.68 * easeInOut(progress);
    } else if (local < retractEnd) {
      phase = "retracting";
      progress = clamp((local - holdEnd) / spec.retractDuration);
      extension = spec.extension - (spec.extension - 1) * easeInOut(progress);
      cycle = 0.5 * (spec.waveSpeed / 0.62) + spec.waves + progress * 0.48 * (spec.waveSpeed / 0.62);
      waveStrength = 0.24 * (1 - easeInOut(progress));
      tipStrength = 0.32 * (1 - Math.pow(progress, 1.35));
    } else {
      return createIdleTentacleState();
    }
    const rootPhase = spec.phaseOffset + cycle * Math.PI * 2;
    const middlePhase = rootPhase - spec.phaseLag;
    const tipPhase = middlePhase - spec.phaseLag;
    const nodePhase = tipPhase - spec.phaseLag * 0.58;
    return {
      phase,
      extension,
      rootBend: Math.sin(rootPhase) * spec.rootAmplitude * waveStrength,
      middleBend: Math.sin(middlePhase) * spec.middleAmplitude * waveStrength,
      tipBend: Math.sin(tipPhase) * spec.tipAmplitude * waveStrength,
      tipLateral: Math.sin(nodePhase) * spec.tipFollow * tipStrength,
      rootPhase,
      middlePhase,
      tipPhase,
      nodePhase,
      waveStrength,
      tipStrength,
      progress
    };
  }

  function motionSnapshot(plan, elapsed) {
    const byIndex = new Map((plan?.specs || []).map((spec) => [spec.index, tentacleStateAt(spec, elapsed)]));
    const tentacles = Array.from({ length: TENTACLE_COUNT }, (_, index) => ({
      index,
      ...(byIndex.get(index) || createIdleTentacleState())
    }));
    const active = tentacles.filter((item) => !["idle", "waiting"].includes(item.phase));
    const phasePriority = ["retracting", "holding", "waving", "extending"];
    const phase = phasePriority.find((name) => active.some((item) => item.phase === name)) || (elapsed < (plan?.totalDuration || 0) ? "waiting" : "idle");
    return {
      kind: plan?.kind || "idle",
      phase,
      activeIndices: active.map((item) => item.index),
      tentacles,
      elapsed,
      totalDuration: plan?.totalDuration || 0
    };
  }

  function staticMotionSnapshot() {
    return motionSnapshot({ kind: "idle", specs: [], totalDuration: 0 }, 0);
  }

  function createLogoAnimationController({
    element,
    windowObject,
    requestFrame,
    cancelFrame = () => {},
    initialVisible = true,
    random = Math.random,
    renderMotion = () => {},
    onStateChange = () => {}
  }) {
    const setTimer = (callback, delay) => windowObject.setTimeout(callback, delay);
    const clearTimer = (timer) => windowObject.clearTimeout(timer);
    let setting = "living-nexus";
    let cleanupTimer = null;
    let ambientTimer = null;
    let initialFrame = null;
    let startFrame = null;
    let motionFrame = null;
    let initialAnimationScheduled = false;
    let initialAnimationPlayed = false;
    let requestId = 0;
    let currentPlan = null;
    let previousAmbientPlan = null;
    let ambientAfterPlayback = false;
    let visible = Boolean(initialVisible);
    let state = {
      phase: "idle",
      kind: "idle",
      setting,
      playing: false,
      waiting: false,
      activeTentacles: []
    };

    function prefersReducedMotion() {
      return typeof windowObject.matchMedia === "function"
        && windowObject.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function isPageVisible() {
      const documentState = windowObject.document?.visibilityState;
      if (documentState === "visible" || documentState === "hidden") visible = documentState === "visible";
      return visible;
    }

    function publish(patch) {
      state = { ...state, ...patch, setting };
      onStateChange({ ...state, activeTentacles: [...state.activeTentacles] });
    }

    function applyElementMode(mode) {
      if (!element) return;
      if (element.dataset) element.dataset.logoAnimation = mode;
      const duration = LOGO_ANIMATION_DURATIONS[mode] || 0;
      element.style?.setProperty?.("--memo-nexus-logo-play-duration", `${duration}ms`);
    }

    function resetRenderedMotion() {
      renderMotion(staticMotionSnapshot());
      if (!element) return;
      if (element.dataset) delete element.dataset.logoActiveTentacle;
    }

    function cancelPendingWork({ reset = true } = {}) {
      requestId += 1;
      clearTimer(cleanupTimer);
      clearTimer(ambientTimer);
      cleanupTimer = null;
      ambientTimer = null;
      if (initialFrame != null) cancelFrame(initialFrame);
      if (startFrame != null) cancelFrame(startFrame);
      if (motionFrame != null) cancelFrame(motionFrame);
      initialFrame = null;
      startFrame = null;
      motionFrame = null;
      currentPlan = null;
      ambientAfterPlayback = false;
      element?.classList.remove("is-animating", "is-tentacle-active");
      if (reset) resetRenderedMotion();
    }

    function canAnimate(mode = setting) {
      return Boolean(element && isPageVisible() && mode !== "off" && !prefersReducedMotion());
    }

    function scheduleAmbient() {
      clearTimer(ambientTimer);
      ambientTimer = null;
      if (setting !== "living-nexus" || !canAnimate(setting) || state.playing) return false;
      const wait = Math.round(randomBetween(random, AMBIENT_WAIT_MIN_MS, AMBIENT_WAIT_MAX_MS));
      const scheduledForRequest = requestId;
      publish({ phase: "waiting", kind: "ambient", waiting: true, playing: false, activeTentacles: [], wait });
      ambientTimer = setTimer(() => {
        ambientTimer = null;
        if (scheduledForRequest !== requestId || !canAnimate(setting) || state.playing) return;
        startAmbientEvent();
      }, wait);
      return true;
    }

    function finishCurrent(id = requestId, { scheduleNext = true } = {}) {
      if (id !== requestId) return false;
      clearTimer(cleanupTimer);
      cleanupTimer = null;
      if (motionFrame != null) cancelFrame(motionFrame);
      motionFrame = null;
      currentPlan = null;
      element?.classList.remove("is-animating", "is-tentacle-active");
      resetRenderedMotion();
      publish({ phase: "idle", kind: "idle", playing: false, waiting: false, activeTentacles: [] });
      if (scheduleNext && setting === "living-nexus") scheduleAmbient();
      return true;
    }

    function runMotion(plan, id, startTimestamp, onComplete) {
      currentPlan = plan;
      let lastPhase = "";
      const tick = (timestamp) => {
        if (id !== requestId || !isPageVisible()) return;
        const elapsed = Math.max(0, timestamp - startTimestamp);
        const snapshot = motionSnapshot(plan, elapsed);
        renderMotion(snapshot);
        if (element?.dataset) {
          if (snapshot.activeIndices.length) element.dataset.logoActiveTentacle = snapshot.activeIndices.join(" ");
          else delete element.dataset.logoActiveTentacle;
        }
        if (snapshot.phase !== lastPhase) {
          lastPhase = snapshot.phase;
          publish({ phase: snapshot.phase, kind: plan.kind, playing: true, waiting: false, activeTentacles: snapshot.activeIndices });
        }
        if (elapsed >= plan.totalDuration) {
          motionFrame = null;
          onComplete();
          return;
        }
        motionFrame = requestFrame(tick);
      };
      tick(startTimestamp);
    }

    function play(mode = setting, { scheduleAmbientAfter = mode === setting } = {}) {
      const animation = normalizeLogoAnimation(mode);
      cancelPendingWork();
      applyElementMode(animation);
      if (!canAnimate(animation)) {
        publish({ phase: "idle", kind: "idle", playing: false, waiting: false, activeTentacles: [] });
        return false;
      }

      const id = ++requestId;
      ambientAfterPlayback = Boolean(scheduleAmbientAfter && animation === setting);
      startFrame = requestFrame((timestamp) => {
        startFrame = null;
        if (id !== requestId || !canAnimate(animation)) return;
        const duration = LOGO_ANIMATION_DURATIONS[animation];
        element.classList.add("is-animating");
        publish({ phase: "starting", kind: animation === "living-nexus" ? "startup" : animation, playing: true, waiting: false, activeTentacles: [] });
        cleanupTimer = setTimer(() => finishCurrent(id, { scheduleNext: ambientAfterPlayback }), duration + 160);
        if (animation === "living-nexus") {
          const plan = createStartupMotionPlan();
          runMotion(plan, id, timestamp, () => finishCurrent(id, { scheduleNext: ambientAfterPlayback }));
        }
      });
      return true;
    }

    function startAmbientEvent() {
      if (!canAnimate(setting) || setting !== "living-nexus") return false;
      cancelPendingWork();
      applyElementMode(setting);
      const plan = createAmbientMotionPlan({ random, previous: previousAmbientPlan });
      previousAmbientPlan = plan;
      const id = ++requestId;
      startFrame = requestFrame((timestamp) => {
        startFrame = null;
        if (id !== requestId || !canAnimate(setting)) return;
        element.classList.add("is-tentacle-active");
        publish({ phase: "extending", kind: "ambient", playing: true, waiting: false, activeTentacles: plan.specs.map((spec) => spec.index) });
        cleanupTimer = setTimer(() => finishCurrent(id), plan.totalDuration + 160);
        runMotion(plan, id, timestamp, () => finishCurrent(id));
      });
      return true;
    }

    function scheduleInitial() {
      if (initialAnimationScheduled || !element) return false;
      initialAnimationScheduled = true;
      const scheduledForRequest = requestId;
      initialFrame = requestFrame(() => {
        initialFrame = null;
        if (scheduledForRequest !== requestId || !isPageVisible() || initialAnimationPlayed) return;
        initialAnimationPlayed = true;
        play(setting);
      });
      return true;
    }

    function setSetting(value, { scheduleAmbient: shouldScheduleAmbient = false } = {}) {
      setting = normalizeLogoAnimation(value);
      cancelPendingWork();
      applyElementMode(setting);
      publish({ phase: "idle", kind: "idle", playing: false, waiting: false, activeTentacles: [] });
      if (shouldScheduleAmbient) scheduleAmbient();
      return setting;
    }

    function handleVisibilityChange(nextVisible) {
      visible = Boolean(nextVisible);
      cancelPendingWork();
      applyElementMode(setting);
      publish({ phase: visible ? "idle" : "hidden", kind: "idle", playing: false, waiting: false, activeTentacles: [] });
      if (!visible) return;
      if (initialAnimationScheduled && !initialAnimationPlayed) {
        const id = requestId;
        initialFrame = requestFrame(() => {
          initialFrame = null;
          if (id !== requestId || !isPageVisible() || initialAnimationPlayed) return;
          initialAnimationPlayed = true;
          play(setting);
        });
      } else if (setting === "living-nexus") {
        scheduleAmbient();
      }
    }

    function finish() {
      return finishCurrent(requestId, { scheduleNext: ambientAfterPlayback || state.kind === "ambient" });
    }

    applyElementMode(setting);
    resetRenderedMotion();

    return {
      finish,
      getLastAmbientPlan: () => previousAmbientPlan,
      getSetting: () => setting,
      getState: () => ({ ...state, activeTentacles: [...state.activeTentacles] }),
      handleVisibilityChange,
      play,
      prefersReducedMotion,
      scheduleAmbient,
      scheduleInitial,
      setSetting,
      startAmbientEvent
    };
  }

  return {
    AMBIENT_WAIT_MAX_MS,
    AMBIENT_WAIT_MIN_MS,
    LOGO_ANIMATION_DURATIONS,
    LOGO_ANIMATION_SETTINGS,
    createAmbientMotionPlan,
    createLogoAnimationController,
    createStartupMotionPlan,
    createTentacleGeometry,
    motionSnapshot,
    normalizeLogoAnimation,
    tentacleStateAt
  };
});
