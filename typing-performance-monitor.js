(function initTypingPerformanceMonitor(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.MemoNexusTypingPerformance = api.createTypingPerformanceMonitor({
      enabled: api.isTypingPerformanceEnabled(root.location?.search),
      performance: root.performance
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function typingPerformanceMonitorFactory() {
  const DEFAULT_SAMPLE_LIMIT = 200;
  const INPUT_KINDS = new Set(["body", "title", "table", "other"]);
  const INPUT_TYPES = new Set([
    "unknown", "other", "insertText", "insertCompositionText", "insertReplacementText",
    "insertLineBreak", "insertParagraph", "insertFromPaste", "insertFromDrop", "insertFromYank",
    "deleteContentBackward", "deleteContentForward", "deleteByCut", "deleteByDrag",
    "deleteWordBackward", "deleteWordForward", "historyUndo", "historyRedo"
  ]);
  const RENDER_TYPES = new Set(["full", "auxiliary", "none"]);
  const INPUT_DURATION_NAMES = new Set([
    "captureUndoSnapshot",
    "applyCurrentEditorDraft",
    "scheduleDraftMirror",
    "setSaveStatus",
    "scheduleSaveTimer",
    "scheduleDerivedUi",
    "updateUndoButton"
  ]);
  const DERIVED_DURATION_NAMES = new Set([
    "invalidateTermRelationIndex",
    "renderMemoListPanel",
    "renderPreview",
    "renderRelated",
    "renderTextStats",
    "renderTableBlockEditors",
    "updateAiTargetPreview"
  ]);
  const NUMERIC_ATTRIBUTES = new Set(["bodyLength", "titleLength", "memoCount"]);
  const BOOLEAN_ATTRIBUTES = new Set(["isCurrentNote"]);

  function isTypingPerformanceEnabled(search = "") {
    if (typeof search !== "string" || !search) return false;
    try {
      return new URLSearchParams(search).get("debugTypingPerf") === "1";
    } catch (_) {
      return /(?:^|[?&])debugTypingPerf=1(?:&|$)/.test(search);
    }
  }

  function safeNowFactory(performanceObject, dateNow = Date.now) {
    const performanceNow = typeof performanceObject?.now === "function"
      ? performanceObject.now.bind(performanceObject)
      : null;
    return () => {
      if (performanceNow) {
        try {
          const value = performanceNow();
          if (Number.isFinite(value)) return value;
        } catch (_) {
          // Date.nowへフォールバックします。
        }
      }
      try {
        const value = dateNow();
        return Number.isFinite(value) ? value : 0;
      } catch (_) {
        return 0;
      }
    };
  }

  function safeDuration(value) {
    const duration = Number(value);
    return Number.isFinite(duration) ? Math.max(0, duration) : 0;
  }

  function normalizeInputKind(value) {
    return INPUT_KINDS.has(value) ? value : "other";
  }

  function normalizeInputType(value) {
    return INPUT_TYPES.has(value) ? value : "other";
  }

  function normalizeRenderType(value) {
    return RENDER_TYPES.has(value) ? value : "none";
  }

  function normalizeAttributes(attributes) {
    const normalized = {};
    if (!attributes || typeof attributes !== "object") return normalized;
    for (const key of NUMERIC_ATTRIBUTES) {
      const value = Number(attributes[key]);
      if (Number.isFinite(value) && value >= 0) normalized[key] = value;
    }
    for (const key of BOOLEAN_ATTRIBUTES) {
      if (typeof attributes[key] === "boolean") normalized[key] = attributes[key];
    }
    return normalized;
  }

  function normalizeDurations(durations, allowedNames, renderType = "none") {
    const normalized = {};
    if (!durations || typeof durations !== "object") return normalized;
    for (const name of allowedNames) {
      if (!Object.prototype.hasOwnProperty.call(durations, name)) continue;
      if (renderType === "auxiliary" && name === "renderTableBlockEditors") continue;
      normalized[name] = safeDuration(durations[name]);
    }
    return normalized;
  }

  function cloneSample(sample) {
    return {
      sampleType: sample.sampleType,
      inputKind: sample.inputKind,
      inputType: sample.inputType,
      isComposing: sample.isComposing,
      renderType: sample.renderType,
      durations: { ...sample.durations },
      totalDuration: sample.totalDuration,
      attributes: { ...sample.attributes }
    };
  }

  function percentile(sorted, ratio) {
    if (!sorted.length) return 0;
    return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
  }

  function summaryName(sample, durationName) {
    if (sample.sampleType === "input") {
      const suffix = durationName === "scheduleDerivedUi"
        ? `${durationName}.${sample.renderType}`
        : durationName;
      return `${sample.inputKind}.sync.${suffix}`;
    }
    return `${sample.renderType}.derived.${durationName}`;
  }

  function summarizeSamples(samples) {
    const durationsByName = new Map();
    function add(name, duration) {
      if (!durationsByName.has(name)) durationsByName.set(name, []);
      durationsByName.get(name).push(safeDuration(duration));
    }
    samples.forEach((sample) => {
      Object.entries(sample.durations || {}).forEach(([name, duration]) => {
        const allowed = sample.sampleType === "input" ? INPUT_DURATION_NAMES : DERIVED_DURATION_NAMES;
        if (allowed.has(name)) add(summaryName(sample, name), duration);
      });
      const totalName = sample.sampleType === "input"
        ? `${normalizeInputKind(sample.inputKind)}.input.total`
        : `${normalizeRenderType(sample.renderType)}.derived.total`;
      add(totalName, sample.totalDuration);
    });
    const summary = {};
    [...durationsByName.keys()].sort().forEach((name) => {
      const durations = durationsByName.get(name).slice().sort((left, right) => left - right);
      const total = durations.reduce((sum, value) => sum + value, 0);
      summary[name] = {
        count: durations.length,
        average: durations.length ? total / durations.length : 0,
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: durations.length ? durations[durations.length - 1] : 0
      };
    });
    return summary;
  }

  function createTypingPerformanceMonitor({
    enabled = false,
    limit = DEFAULT_SAMPLE_LIMIT,
    performance: performanceObject,
    dateNow,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = {}) {
    const active = enabled === true;
    if (!active) {
      const empty = () => [];
      return Object.freeze({
        addInputDuration: () => false,
        beginInput: () => null,
        clear: () => {},
        completeInput: () => false,
        consumeInput: () => null,
        discardNote: () => false,
        discardPending: () => false,
        discardTransient: () => false,
        elapsed: () => 0,
        getEvents: empty,
        getSamples: empty,
        getSummary: () => ({}),
        isEnabled: () => false,
        recordDerivedSample: () => false,
        shouldMeasureDerived: () => false,
        start: () => 0
      });
    }

    const capacity = Math.max(1, Math.floor(Number(limit)) || DEFAULT_SAMPLE_LIMIT);
    const now = safeNowFactory(performanceObject, dateNow);
    const buffer = new Array(capacity);
    const collectors = new Map();
    let count = 0;
    let nextIndex = 0;
    let nextToken = 1;
    let pendingInput = null;
    let pendingTimer = null;
    let derivedContext = null;

    function clearPendingTimer() {
      if (pendingTimer !== null) clearTimer(pendingTimer);
      pendingTimer = null;
    }

    function removeCollector(token) {
      if (token !== null && token !== undefined) collectors.delete(token);
    }

    function discardPending() {
      if (!pendingInput) return false;
      clearPendingTimer();
      removeCollector(pendingInput.token);
      pendingInput = null;
      return true;
    }

    function createCollector(context) {
      const token = nextToken;
      nextToken += 1;
      collectors.set(token, {
        noteKey: context?.noteKey,
        revision: context?.revision,
        inputKind: normalizeInputKind(context?.inputKind),
        inputType: normalizeInputType(context?.inputType || "unknown"),
        isComposing: context?.isComposing === true,
        durations: {}
      });
      return token;
    }

    function beginInput(context = {}) {
      discardPending();
      const token = createCollector(context);
      pendingInput = { token };
      pendingTimer = setTimer(() => {
        if (pendingInput?.token !== token) return;
        pendingTimer = null;
        removeCollector(token);
        pendingInput = null;
      }, 0);
      return token;
    }

    function collectorMatches(collector, context) {
      return collector
        && collector.noteKey === context?.noteKey
        && collector.revision === context?.revision
        && collector.inputKind === normalizeInputKind(context?.inputKind)
        && collector.inputType === normalizeInputType(context?.inputType || "unknown")
        && collector.isComposing === (context?.isComposing === true);
    }

    function consumeInput(context = {}) {
      const token = pendingInput?.token;
      const collector = collectors.get(token);
      clearPendingTimer();
      pendingInput = null;
      if (collectorMatches(collector, context)) return token;
      removeCollector(token);
      return createCollector(context);
    }

    function addInputDuration(token, name, duration) {
      const collector = collectors.get(token);
      if (!collector || !INPUT_DURATION_NAMES.has(name)) return false;
      collector.durations[name] = safeDuration(duration);
      return true;
    }

    function storeSample(sample) {
      buffer[nextIndex] = Object.freeze({
        ...sample,
        durations: Object.freeze(sample.durations),
        attributes: Object.freeze(sample.attributes)
      });
      nextIndex = (nextIndex + 1) % capacity;
      count = Math.min(count + 1, capacity);
    }

    function attributesFromFactory(attributesFactory) {
      return normalizeAttributes(typeof attributesFactory === "function" ? attributesFactory() : null);
    }

    function completeInput(token, {
      durations,
      totalDuration = 0,
      renderType = "none",
      derived,
      attributesFactory
    } = {}) {
      const collector = collectors.get(token);
      if (!collector) return false;
      if (pendingInput?.token === token) {
        clearPendingTimer();
        pendingInput = null;
      }
      Object.assign(collector.durations, normalizeDurations(durations, INPUT_DURATION_NAMES));
      const normalizedRenderType = normalizeRenderType(renderType);
      if (derived) {
        derivedContext = {
          noteKey: derived.noteKey,
          revision: derived.revision,
          inputKind: collector.inputKind,
          inputType: collector.inputType,
          isComposing: collector.isComposing,
          renderType: normalizedRenderType
        };
      }
      const attributes = attributesFromFactory(attributesFactory);
      storeSample({
        sampleType: "input",
        inputKind: collector.inputKind,
        inputType: collector.inputType,
        isComposing: collector.isComposing,
        renderType: normalizedRenderType,
        durations: normalizeDurations(collector.durations, INPUT_DURATION_NAMES),
        totalDuration: safeDuration(totalDuration),
        attributes
      });
      removeCollector(token);
      return true;
    }

    function recordDerivedSample({
      noteKey,
      revision,
      renderType,
      durations,
      totalDuration = 0,
      attributesFactory
    } = {}) {
      const normalizedRenderType = normalizeRenderType(renderType);
      if (
        !derivedContext
        || derivedContext.noteKey !== noteKey
        || derivedContext.revision !== revision
        || derivedContext.renderType !== normalizedRenderType
      ) return false;
      const context = derivedContext;
      derivedContext = null;
      const attributes = attributesFromFactory(attributesFactory);
      storeSample({
        sampleType: "derived",
        inputKind: context.inputKind,
        inputType: context.inputType,
        isComposing: context.isComposing,
        renderType: normalizedRenderType,
        durations: normalizeDurations(durations, DERIVED_DURATION_NAMES, normalizedRenderType),
        totalDuration: safeDuration(totalDuration),
        attributes
      });
      return true;
    }

    function shouldMeasureDerived(noteKey, revision, renderType) {
      return Boolean(
        derivedContext
        && derivedContext.noteKey === noteKey
        && derivedContext.revision === revision
        && derivedContext.renderType === normalizeRenderType(renderType)
      );
    }

    function getSamples() {
      if (count === 0) return [];
      const start = count < capacity ? 0 : nextIndex;
      return Array.from({ length: count }, (_, offset) => cloneSample(buffer[(start + offset) % capacity]));
    }

    function discardNote(noteKey) {
      let discarded = false;
      if (pendingInput) {
        const collector = collectors.get(pendingInput.token);
        if (collector?.noteKey === noteKey) discarded = discardPending() || discarded;
      }
      for (const [token, collector] of collectors) {
        if (collector.noteKey !== noteKey) continue;
        collectors.delete(token);
        discarded = true;
      }
      if (derivedContext?.noteKey === noteKey) {
        derivedContext = null;
        discarded = true;
      }
      return discarded;
    }

    function discardTransient() {
      const discarded = pendingInput !== null || collectors.size > 0 || derivedContext !== null;
      clearPendingTimer();
      collectors.clear();
      pendingInput = null;
      derivedContext = null;
      return discarded;
    }

    function clear() {
      discardTransient();
      buffer.fill(undefined);
      count = 0;
      nextIndex = 0;
    }

    return Object.freeze({
      addInputDuration,
      beginInput,
      clear,
      completeInput,
      consumeInput,
      discardNote,
      discardPending,
      discardTransient,
      elapsed(startedAt) {
        const duration = now() - Number(startedAt);
        return Number.isFinite(duration) ? Math.max(0, duration) : 0;
      },
      getEvents: getSamples,
      getSamples,
      getSummary: () => summarizeSamples(getSamples()),
      isEnabled: () => true,
      recordDerivedSample,
      shouldMeasureDerived,
      start: now
    });
  }

  return {
    DEFAULT_SAMPLE_LIMIT,
    createTypingPerformanceMonitor,
    isTypingPerformanceEnabled,
    summarizeSamples
  };
});
