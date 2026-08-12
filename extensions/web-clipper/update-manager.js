(function (root) {
  function parseSemanticVersion(value) {
    const match = String(value || "").trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return { numbers: match.slice(1, 4).map(Number), prerelease: match[4] ? match[4].split(".") : [] };
  }

  function compareSemanticVersions(left, right) {
    const a = parseSemanticVersion(left);
    const b = parseSemanticVersion(right);
    if (!a || !b) return null;
    for (let index = 0; index < 3; index += 1) {
      if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
    }
    if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
    const maximum = Math.max(a.prerelease.length, b.prerelease.length);
    for (let index = 0; index < maximum; index += 1) {
      if (a.prerelease[index] === undefined) return -1;
      if (b.prerelease[index] === undefined) return 1;
      const aNumber = /^\d+$/.test(a.prerelease[index]);
      const bNumber = /^\d+$/.test(b.prerelease[index]);
      if (aNumber && bNumber && Number(a.prerelease[index]) !== Number(b.prerelease[index])) return Number(a.prerelease[index]) > Number(b.prerelease[index]) ? 1 : -1;
      if (aNumber !== bNumber) return aNumber ? -1 : 1;
      if (a.prerelease[index] !== b.prerelease[index]) return a.prerelease[index] > b.prerelease[index] ? 1 : -1;
    }
    return 0;
  }

  function decideDevelopmentUpdate({ environment, currentVersion, latestVersion, previousAttempt, hasPendingTransfer }) {
    if (environment !== "development") return { action: "browser-managed", reason: "production" };
    const comparison = compareSemanticVersions(latestVersion, currentVersion);
    if (comparison === null) return { action: "continue", reason: "version-unavailable" };
    if (comparison <= 0) return { action: "continue", reason: "up-to-date" };
    if (hasPendingTransfer) return { action: "defer", reason: "clip-in-progress", targetVersion: latestVersion };
    if (previousAttempt?.targetVersion === latestVersion && compareSemanticVersions(currentVersion, latestVersion) < 0) {
      return { action: "manual", reason: "reload-did-not-update", targetVersion: latestVersion };
    }
    return { action: "reload", reason: "new-version", targetVersion: latestVersion };
  }

  const api = { compareSemanticVersions, decideDevelopmentUpdate, parseSemanticVersion };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipperUpdateManager = api;
})(globalThis);
