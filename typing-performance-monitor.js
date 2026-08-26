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
  const DEFAULT_EVENT_LIMIT = 200;
  const NUMERIC_ATTRIBUTES = new Set(["bodyLength", "titleLength", "memoCount"]);
  const BOOLEAN_ATTRIBUTES = new Set(["isComposing", "isCurrentNote"]);
  const ENUM_ATTRIBUTES = {
    inputKind: new Set(["body", "title", "table", "other"]),
    inputType: new Set([
      "unknown", "other", "insertText", "insertCompositionText", "insertReplacementText",
      "insertLineBreak", "insertParagraph", "insertFromPaste", "insertFromDrop", "insertFromYank",
      "deleteContentBackward", "deleteContentForward", "deleteByCut", "deleteByDrag",
      "deleteWordBackward", "deleteWordForward", "historyUndo", "historyRedo"
    ]),
    renderType: new Set(["full", "auxiliary", "none"])
  };
  const PROCESS_NAMES = new Set([
    ...["body", "title", "table"].flatMap((inputKind) => [
      `${inputKind}.sync.captureUndoSnapshot`,
      `${inputKind}.sync.applyCurrentEditorDraft`,
      `${inputKind}.sync.scheduleDraftMirror`,
      `${inputKind}.sync.setSaveStatus`,
      `${inputKind}.sync.scheduleSaveTimer`,
      `${inputKind}.sync.scheduleDerivedUi.full`,
      `${inputKind}.sync.scheduleDerivedUi.auxiliary`,
      `${inputKind}.sync.updateUndoButton`,
      `${inputKind}.input.total`
    ]),
    ...["full", "auxiliary"].flatMap((renderType) => [
      `${renderType}.derived.renderMemoListPanel`,
      `${renderType}.derived.renderPreview`,
      `${renderType}.derived.renderRelated`,
      `${renderType}.derived.renderTextStats`,
      `${renderType}.derived.renderTableBlockEditors`,
      `${renderType}.derived.updateAiTargetPreview`,
      `${renderType}.derived.total`
    ])
  ]);

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
    for (const [key, allowed] of Object.entries(ENUM_ATTRIBUTES)) {
      if (typeof attributes[key] !== "string") continue;
      normalized[key] = allowed.has(attributes[key]) ? attributes[key] : "other";
    }
    return normalized;
  }

  function percentile(sorted, ratio) {
    if (!sorted.length) return 0;
    return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
  }

  function summarizeEvents(events) {
    const durationsByName = new Map();
    events.forEach((event) => {
      if (!durationsByName.has(event.name)) durationsByName.set(event.name, []);
      durationsByName.get(event.name).push(event.duration);
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
    limit = DEFAULT_EVENT_LIMIT,
    performance: performanceObject,
    dateNow
  } = {}) {
    const active = enabled === true;
    const capacity = Math.max(1, Math.floor(Number(limit)) || DEFAULT_EVENT_LIMIT);
    const now = safeNowFactory(performanceObject, dateNow);
    const buffer = active ? new Array(capacity) : null;
    let count = 0;
    let nextIndex = 0;

    function getEvents() {
      if (!active || count === 0) return [];
      const start = count < capacity ? 0 : nextIndex;
      return Array.from({ length: count }, (_, offset) => {
        const event = buffer[(start + offset) % capacity];
        return { ...event, attributes: { ...event.attributes } };
      });
    }

    function record(name, duration, attributes) {
      if (!active) return false;
      if (!PROCESS_NAMES.has(name)) return false;
      const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : 0;
      buffer[nextIndex] = Object.freeze({
        name,
        duration: safeDuration,
        attributes: Object.freeze(normalizeAttributes(attributes))
      });
      nextIndex = (nextIndex + 1) % capacity;
      count = Math.min(count + 1, capacity);
      return true;
    }

    function clear() {
      if (!active) return;
      buffer.fill(undefined);
      count = 0;
      nextIndex = 0;
    }

    return Object.freeze({
      clear,
      elapsed(startedAt) {
        if (!active) return 0;
        const duration = now() - Number(startedAt);
        return Number.isFinite(duration) ? Math.max(0, duration) : 0;
      },
      getEvents,
      getSummary: () => summarizeEvents(getEvents()),
      isEnabled: () => active,
      record,
      start: () => active ? now() : 0
    });
  }

  return {
    DEFAULT_EVENT_LIMIT,
    createTypingPerformanceMonitor,
    isTypingPerformanceEnabled,
    summarizeEvents
  };
});
