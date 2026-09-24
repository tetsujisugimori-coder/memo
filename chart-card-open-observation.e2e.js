"use strict";

// This probe is installed only by the manual WebKit profiles, before the real click.
async function startCardOpenObservation(page) {
  await page.evaluate(() => {
    if (window.__chartCardOpenObservation) throw new Error("Previous card observation was not collected");
    const button = document.getElementById("cardPaneBtn");
    const card = document.getElementById("previewCard");
    const state = { clickAt: null, ariaAt: null, edgeAt: null, frame: null };
    const observeEdge = () => {
      state.frame = null;
      if (state.edgeAt !== null) return;
      if (card.getAttribute("aria-hidden") === "false"
        && Math.abs(card.getBoundingClientRect().right - innerWidth) < 1) {
        state.edgeAt = performance.now();
      } else {
        state.frame = requestAnimationFrame(observeEdge);
      }
    };
    const onClick = () => {
      if (state.clickAt !== null) return;
      state.clickAt = performance.now();
      state.frame = requestAnimationFrame(observeEdge);
    };
    const observer = new MutationObserver(() => {
      if (state.clickAt !== null && state.ariaAt === null
        && card.getAttribute("aria-hidden") === "false") state.ariaAt = performance.now();
    });
    button.addEventListener("click", onClick, { capture: true });
    observer.observe(card, { attributes: true, attributeFilter: ["aria-hidden"] });
    window.__chartCardOpenObservation = { button, onClick, observer, state };
  });
}

async function finishCardOpenObservation(page) {
  return page.evaluate(() => {
    const probe = window.__chartCardOpenObservation;
    if (!probe) return { clickToAria: null, ariaToEdge: null, clickToEdge: null, reason: "observerMissing" };
    delete window.__chartCardOpenObservation;
    probe.button.removeEventListener("click", probe.onClick, { capture: true });
    probe.observer.disconnect();
    if (probe.state.frame !== null) cancelAnimationFrame(probe.state.frame);
    const { clickAt, ariaAt, edgeAt } = probe.state;
    return {
      clickToAria: clickAt === null || ariaAt === null ? null : ariaAt - clickAt,
      ariaToEdge: ariaAt === null || edgeAt === null ? null : edgeAt - ariaAt,
      clickToEdge: clickAt === null || edgeAt === null ? null : edgeAt - clickAt,
      reason: clickAt === null ? "clickEventMissing" : ariaAt === null ? "ariaObservationMissing"
        : edgeAt === null ? "edgeObservationMissing" : null
    };
  });
}

function summarizeCardOpenObservations(entries) {
  const names = ["clickToAria", "ariaToEdge", "clickToEdge"];
  const stages = {};
  const slowest = {};
  for (const name of names) {
    const present = entries.filter(({ observation }) => Number.isFinite(observation?.[name]));
    const missing = entries.filter(({ observation }) => !Number.isFinite(observation?.[name]));
    const ms = present.reduce((sum, { observation }) => sum + observation[name], 0);
    const missingReasons = {};
    for (const { observation } of missing) {
      const reason = observation?.reason || "observationMissing";
      missingReasons[reason] = (missingReasons[reason] || 0) + 1;
    }
    stages[name] = {
      count: present.length, ms: present.length ? Math.round(ms) : null,
      perCallMs: present.length ? Math.round(ms / present.length * 10) / 10 : null,
      maxMs: present.length ? Math.round(Math.max(...present.map(({ observation }) => observation[name]))) : null,
      missingCount: missing.length, missingReasons
    };
    slowest[name] = present.map(({ context, observation }) => ({ ...context, ms: Math.round(observation[name]) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 5);
  }
  return { stages, slowest };
}

module.exports = { startCardOpenObservation, finishCardOpenObservation, summarizeCardOpenObservations };
