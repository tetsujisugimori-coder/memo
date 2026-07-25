(function (globalScope) {
  "use strict";

  const CALCULATOR_MEMO_URL = "https://tetsujisugimori-coder.github.io/calculator-memo/";
  const MAX_CALCULATOR_EXPRESSION_LENGTH = 2000;

  function selectedEditorText(editor) {
    if (!editor || typeof editor.value !== "string") return "";
    const start = Number.isInteger(editor.selectionStart) ? editor.selectionStart : 0;
    const end = Number.isInteger(editor.selectionEnd) ? editor.selectionEnd : start;
    return editor.value.slice(start, end).trim();
  }

  function buildCalculatorMemoUrl(expression = "") {
    const trimmedExpression = String(expression).trim();
    if (trimmedExpression.length > MAX_CALCULATOR_EXPRESSION_LENGTH) {
      throw new RangeError(`計算式は${MAX_CALCULATOR_EXPRESSION_LENGTH}文字以内で選択してください`);
    }

    const url = new URL(CALCULATOR_MEMO_URL);
    if (trimmedExpression) url.searchParams.set("expr", trimmedExpression);
    return url.toString();
  }

  function openCalculatorMemo(editor, openWindow = globalScope?.open?.bind(globalScope)) {
    const url = buildCalculatorMemoUrl(selectedEditorText(editor));
    if (typeof openWindow !== "function") return url;
    const openedWindow = openWindow(url, "_blank", "noopener,noreferrer");
    if (openedWindow) openedWindow.opener = null;
    return url;
  }

  const api = {
    CALCULATOR_MEMO_URL,
    MAX_CALCULATOR_EXPRESSION_LENGTH,
    buildCalculatorMemoUrl,
    openCalculatorMemo,
    selectedEditorText
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusCalculatorLink = api;
})(typeof window !== "undefined" ? window : globalThis);
