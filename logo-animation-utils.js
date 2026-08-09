(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusLogoAnimationUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const LOGO_ANIMATION_SETTINGS = ["daily", "typewriter", "nexus", "scan", "off"];
  const DAILY_LOGO_ANIMATIONS = ["typewriter", "nexus", "scan"];

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

  return { DAILY_LOGO_ANIMATIONS, LOGO_ANIMATION_SETTINGS, localDateKey, normalizeLogoAnimation, resolveLogoAnimation, stableDayIndex };
});
