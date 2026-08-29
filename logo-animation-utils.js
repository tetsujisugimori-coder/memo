(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusLogoAnimationUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const LOGO_ANIMATION_DURATION_MS = 1500;

  function createLogoAnimationController({ element, windowObject, requestFrame }) {
    let cleanupTimer = null;
    let initialAnimationScheduled = false;
    let animationRequestId = 0;

    function prefersReducedMotion() {
      return typeof windowObject.matchMedia === "function"
        && windowObject.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function finish() {
      animationRequestId += 1;
      windowObject.clearTimeout(cleanupTimer);
      cleanupTimer = null;
      element?.classList.remove("is-animating");
    }

    function play() {
      if (!element) return false;
      finish();
      if (prefersReducedMotion()) return false;

      const requestId = ++animationRequestId;
      requestFrame(() => {
        if (requestId === animationRequestId) element.classList.add("is-animating");
      });
      cleanupTimer = windowObject.setTimeout(finish, LOGO_ANIMATION_DURATION_MS);
      return true;
    }

    function scheduleInitial() {
      if (initialAnimationScheduled || !element) return false;
      initialAnimationScheduled = true;
      requestFrame(() => play());
      return true;
    }

    return { finish, play, prefersReducedMotion, scheduleInitial };
  }

  return { LOGO_ANIMATION_DURATION_MS, createLogoAnimationController };
});
