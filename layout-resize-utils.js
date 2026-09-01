(function initLayoutResizeUtils(globalScope) {
  "use strict";

  const EDITOR_MIN_WIDTH = 320;
  const CARD_MIN_WIDTH = 280;
  const CONTEXT_PANEL_MIN_WIDTH = 240;
  const CONTEXT_PANEL_MAX_WIDTH = 520;
  const DEFAULT_CONTEXT_PANEL_WIDTH = 340;
  const MAX_SAVED_WIDTH = 100000;

  function clampWidth(value, minimum, maximum) {
    const safeMinimum = Number.isFinite(minimum) ? minimum : 0;
    const safeMaximum = Number.isFinite(maximum) ? Math.max(safeMinimum, maximum) : safeMinimum;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return safeMinimum;
    return Math.min(safeMaximum, Math.max(safeMinimum, numericValue));
  }

  function validSavedWidth(value) {
    return typeof value === "number"
      && Number.isFinite(value)
      && value > 0
      && value <= MAX_SAVED_WIDTH;
  }

  function normalizeLayoutWidths(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const normalized = {};
    if (value.editorWidth === null) normalized.editorWidth = null;
    else if (validSavedWidth(value.editorWidth)) normalized.editorWidth = value.editorWidth;
    if (validSavedWidth(value.contextPanelWidth)) normalized.contextPanelWidth = value.contextPanelWidth;
    return normalized;
  }

  function parseLayoutWidths(rawValue) {
    if (typeof rawValue !== "string" || !rawValue.trim()) return {};
    try {
      return normalizeLayoutWidths(JSON.parse(rawValue));
    } catch (_) {
      return {};
    }
  }

  function calculateEditorRange(workspaceWidth, horizontalInsets = 0, separatorTrackWidth = 0) {
    const width = Number.isFinite(Number(workspaceWidth)) ? Math.max(0, Number(workspaceWidth)) : 0;
    const insets = Number.isFinite(Number(horizontalInsets)) ? Math.max(0, Number(horizontalInsets)) : 0;
    const separator = Number.isFinite(Number(separatorTrackWidth)) ? Math.max(0, Number(separatorTrackWidth)) : 0;
    const usableWidth = Math.max(0, width - insets - separator);
    return {
      minimum: EDITOR_MIN_WIDTH,
      maximum: Math.max(EDITOR_MIN_WIDTH, usableWidth - CARD_MIN_WIDTH),
      usableWidth
    };
  }

  function defaultEditorWidth(workspaceWidth, horizontalInsets = 0, separatorTrackWidth = 0) {
    const range = calculateEditorRange(workspaceWidth, horizontalInsets, separatorTrackWidth);
    return clampWidth(range.usableWidth / 1.8, range.minimum, range.maximum);
  }

  function calculateContextPanelRange(bodyWidth, workspaceMinimumWidth) {
    const width = Number.isFinite(Number(bodyWidth)) ? Math.max(0, Number(bodyWidth)) : 0;
    const workspaceMinimum = Number.isFinite(Number(workspaceMinimumWidth)) ? Math.max(0, Number(workspaceMinimumWidth)) : 0;
    const availableMaximum = width - workspaceMinimum;
    return {
      minimum: CONTEXT_PANEL_MIN_WIDTH,
      maximum: Math.max(
        CONTEXT_PANEL_MIN_WIDTH,
        Math.min(CONTEXT_PANEL_MAX_WIDTH, availableMaximum)
      )
    };
  }

  function commitLayoutWidthsForKind(requestedWidths, appliedWidths, kind) {
    const requested = requestedWidths && typeof requestedWidths === "object" ? requestedWidths : {};
    const applied = appliedWidths && typeof appliedWidths === "object" ? appliedWidths : {};
    const next = {
      editorWidth: requested.editorWidth === null
        ? null
        : (validSavedWidth(requested.editorWidth) ? requested.editorWidth : null),
      contextPanelWidth: validSavedWidth(requested.contextPanelWidth)
        ? requested.contextPanelWidth
        : DEFAULT_CONTEXT_PANEL_WIDTH
    };

    if (kind === "editor" && requested.editorWidth !== null && validSavedWidth(applied.editorWidth)) {
      next.editorWidth = applied.editorWidth;
    } else if (kind === "context" && validSavedWidth(applied.contextPanelWidth)) {
      next.contextPanelWidth = applied.contextPanelWidth;
    }
    return next;
  }

  const api = {
    CARD_MIN_WIDTH,
    CONTEXT_PANEL_MAX_WIDTH,
    CONTEXT_PANEL_MIN_WIDTH,
    DEFAULT_CONTEXT_PANEL_WIDTH,
    EDITOR_MIN_WIDTH,
    calculateContextPanelRange,
    calculateEditorRange,
    clampWidth,
    commitLayoutWidthsForKind,
    defaultEditorWidth,
    normalizeLayoutWidths,
    parseLayoutWidths
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  globalScope.MemoNexusLayoutResizeUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
