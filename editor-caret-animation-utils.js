(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusEditorCaretAnimationUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const DEFAULT_EDITOR_CARET_ANIMATION_SETTINGS = Object.freeze({
    enabled: true,
    idleDelay: 4000,
    respectReducedMotion: true
  });
  const EDITOR_CARET_REPEAT_DELAY = 20000;

  function normalizeEditorCaretAnimationSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      enabled: source.enabled !== false,
      idleDelay: Number(source.idleDelay) === 4000 ? 4000 : DEFAULT_EDITOR_CARET_ANIMATION_SETTINGS.idleDelay,
      respectReducedMotion: source.respectReducedMotion !== false
    };
  }

  function canPlayEditorCaretAnimation(state = {}) {
    return Boolean(
      state.enabled
      && state.desktopPointer
      && state.focused
      && state.collapsed
      && !state.composing
      && !state.hidden
      && !state.modalOpen
      && !state.popout
      && !state.aiBusy
      && !(state.respectReducedMotion && state.reducedMotion)
    );
  }

  function editorCaretPrefersReducedMotion(browser = typeof window !== "undefined" ? window : null) {
    if (typeof browser?.matchMedia !== "function") return false;
    try {
      return Boolean(browser.matchMedia("(prefers-reduced-motion: reduce)")?.matches);
    } catch (_) {
      return false;
    }
  }

  function editorCaretDelayForCycle({ repeated = false, idleDelay } = {}) {
    return repeated ? EDITOR_CARET_REPEAT_DELAY : normalizeEditorCaretAnimationSettings({ idleDelay }).idleDelay;
  }

  return { DEFAULT_EDITOR_CARET_ANIMATION_SETTINGS, EDITOR_CARET_REPEAT_DELAY, canPlayEditorCaretAnimation, editorCaretDelayForCycle, editorCaretPrefersReducedMotion, normalizeEditorCaretAnimationSettings };
});
