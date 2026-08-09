(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusLogoAnimationUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const LOGO_ANIMATION_SETTINGS = ["daily", "typewriter", "nexus", "scan", "off"];
  // This is also the header interaction order. Keeping the daily resolver on
  // this list lets an in-page cycle continue from today's selected effect.
  const LOGO_ANIMATION_CYCLE = ["typewriter", "nexus", "scan"];
  const DAILY_LOGO_ANIMATIONS = LOGO_ANIMATION_CYCLE;

  function normalizeLogoAnimation(value) {
    return LOGO_ANIMATION_SETTINGS.includes(value) ? value : "daily";
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function stableDayIndex(date = new Date()) {
    let hash = 0;
    for (const character of localDateKey(date)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash % DAILY_LOGO_ANIMATIONS.length;
  }

  function resolveLogoAnimation(value, date = new Date()) {
    const normalized = normalizeLogoAnimation(value);
    return normalized === "daily" ? DAILY_LOGO_ANIMATIONS[stableDayIndex(date)] : normalized;
  }

  function nextLogoAnimation(value) {
    const index = LOGO_ANIMATION_CYCLE.indexOf(value);
    return LOGO_ANIMATION_CYCLE[(index + 1 + LOGO_ANIMATION_CYCLE.length) % LOGO_ANIMATION_CYCLE.length];
  }

  return { DAILY_LOGO_ANIMATIONS, LOGO_ANIMATION_CYCLE, LOGO_ANIMATION_SETTINGS, localDateKey, nextLogoAnimation, normalizeLogoAnimation, resolveLogoAnimation, stableDayIndex };
});
