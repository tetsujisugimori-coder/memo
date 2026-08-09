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

  return { DEFAULT_EDITOR_CARET_ANIMATION_SETTINGS, canPlayEditorCaretAnimation, normalizeEditorCaretAnimationSettings };
});
