/* UI-only command catalogue. IDs point to the original controls and listeners. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MemoNexusFeaturePalette = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const commands = Object.freeze([
    ["note.tags", "focusNoteTagBtn", "タグ", "タグを選んでメモを整理", "整理", "#", ["タグ", "分類"]],
    ["insert.table", "insertTableBtn", "表", "カーソル位置へ表を挿入", "挿入", "▦", ["表", "テーブル"]],
    ["import.table", "importTableFileBtn", "CSV/TSV", "CSV・TSVファイルから表を作成", "挿入", "⇥", ["取込", "CSV", "TSV"]],
    ["insert.geometry", "insertGeometryBtn", "図形", "カーソル位置へ図形を挿入", "挿入", "△", ["図形", "作図"]],
    ["insert.chart", "insertChartBtn", "グラフ", "カーソル位置へグラフを挿入", "挿入", "▥", ["グラフ", "チャート"]],
    ["insert.timeline", "insertTimelineBtn", "Timeline", "本文の末尾へ時系列を追加", "挿入", "↕", ["時系列", "年表"]],
    ["note.sources", "manageSourcesBtn", "出典", "メモの出典を管理", "整理", "※", ["出典", "引用"]],
    ["insert.callout", "insertCalloutBtn", "注意書き", "選んだ種類の注意書きを挿入", "書式", "!", ["注意", "NOTE", "TIP", "WARNING"]],
    ["format.highlight", "toggleHighlightBtn", "蛍光ペン", "選択範囲の強調を切り替え", "書式", "🖍️", ["強調", "ハイライト"]],
    ["insert.image", "insertImageBlockBtn", "画像", "カーソル位置へ画像を挿入", "挿入", "🖼️", ["画像", "写真"]],
    ["insert.explanation", "addExplanationBtn", "解説", "選択箇所またはカーソル位置へ解説を追加", "挿入", "💬", ["説明", "解説", "補足"]],
    ["open.calculator", "calculatorLinkBtn", "計算", "選択した式をCalculator Memoで開く", "支援", "=", ["計算", "式"]],
    ["help.syntax", "syntaxGuideBtn", "記法ガイド", "Markdownなどの記法を確認", "支援", "?", ["記法", "Markdown", "ヘルプ"]],
    ["ai.summarize", "aiSummarizeNoteBtn", "AI要約", "現在のメモを要約するAI操作", "AI", "✧", ["要約", "まとめ"]],
    ["ai.selection", "aiSendSelectionBtn", "AIへ選択範囲", "選択した文章をAIへ渡す", "AI", "↗", ["AI", "選択", "送信"]]
  ].map(([id, controlId, label, description, category, icon, keywords]) => Object.freeze({
    id, controlId, label, description, category, icon, keywords: Object.freeze(keywords)
  })));

  function clampPosition(position, size, viewport, margin = 8) {
    const left = viewport.left || 0, top = viewport.top || 0;
    return {
      x: Math.max(left + margin, Math.min(position.x, left + viewport.width - size.width - margin)),
      y: Math.max(top + margin, Math.min(position.y, top + viewport.height - size.height - margin))
    };
  }

  function create({ panel, triggers, editor, getNoteId, beforeCommand = () => {} }) {
    if (!panel || !editor) return null;
    const doc = panel.ownerDocument, win = doc.defaultView;
    const handle = panel.querySelector("[data-palette-drag]");
    const closeButton = panel.querySelector("[data-palette-close]");
    let opener = null, selection = null, position = null, drag = null;
    const controls = new Set(commands.map((command) => command.controlId));
    commands.forEach((command) => {
      const button = doc.getElementById(command.controlId);
      if (!button || !panel.contains(button)) return;
      button.dataset.commandId = command.id;
      button.dataset.commandCategory = command.category;
      button.title = command.description;
      // Keep the existing accessible name; the short visible label is supplementary.
      if (!button.hasAttribute("aria-label")) button.setAttribute("aria-label", command.description);
      const icon = doc.createElement("span");
      icon.className = "editor-tool-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = command.icon;
      const label = doc.createElement("span");
      label.textContent = command.label;
      button.replaceChildren(icon, label);
    });
    function remember() {
      selection = { noteId: getNoteId(), value: editor.value, start: editor.selectionStart, end: editor.selectionEnd,
        direction: editor.selectionDirection, scrollTop: editor.scrollTop };
    }
    function restore() {
      if (!selection || selection.noteId !== getNoteId() || selection.value !== editor.value) remember();
      editor.setSelectionRange(selection.start, selection.end, selection.direction);
      editor.scrollTop = selection.scrollTop;
    }
    function viewport() {
      const v = win.visualViewport;
      return { left: v?.offsetLeft || 0, top: v?.offsetTop || 0,
        width: v?.width || win.innerWidth, height: v?.height || win.innerHeight };
    }
    function place(reset = false) {
      if (panel.hidden) return;
      const v = viewport();
      const mobile = win.matchMedia("(max-width: 719.98px)").matches;
      const trayHeight = mobile ? (doc.getElementById("mobileWritingTools")?.getBoundingClientRect().height || 0) : 0;
      panel.style.maxHeight = `${Math.max(0, Math.min(480, v.height - trayHeight - 16))}px`;
      panel.style.maxWidth = `${Math.max(0, v.width - 16)}px`;
      const box = panel.getBoundingClientRect();
      const anchor = (opener?.getClientRects().length ? opener : triggers[0]).getBoundingClientRect();
      if (reset || !position || mobile) position = {
        x: mobile ? v.left + (v.width - box.width) / 2 : anchor.right - box.width,
        y: mobile ? v.top + v.height - box.height - trayHeight - 8 : anchor.bottom + 8
      };
      position = clampPosition(position, box, v);
      panel.style.left = `${position.x}px`;
      panel.style.top = `${position.y}px`;
    }
    function finishDrag() {
      if (!drag) return;
      const pointerId = drag.id;
      drag = null;
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      panel.classList.remove("is-dragging");
    }
    function close({ restoreFocus = false } = {}) {
      if (panel.hidden) return;
      finishDrag();
      panel.hidden = true;
      triggers.forEach((button) => {
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "機能パレットを開く");
        button.title = "機能パレットを開く";
      });
      if (restoreFocus) {
        const target = opener?.getClientRects().length ? opener : editor;
        target.focus({ preventScroll: true });
      }
    }
    function open(trigger, keyboard = false) {
      remember();
      opener = trigger;
      panel.hidden = false;
      triggers.forEach((button) => {
        button.setAttribute("aria-expanded", "true");
        button.setAttribute("aria-label", "機能パレットを閉じる");
        button.title = "機能パレットを閉じる";
      });
      place();
      if (keyboard) closeButton.focus({ preventScroll: true });
    }
    triggers.forEach((button) => button.addEventListener("click", (event) => {
      if (panel.hidden) open(button, event.detail === 0);
      else close({ restoreFocus: true });
    }));
    closeButton.addEventListener("click", () => close({ restoreFocus: true }));
    ["select", "input", "keyup", "pointerup", "scroll"].forEach((type) => editor.addEventListener(type, remember));
    // Capture runs before each original button listener, including native file pickers.
    ["pointerdown", "click"].forEach((type) => panel.addEventListener(type, (event) => {
      const button = event.target.closest("button");
      if (!button || !controls.has(button.id)) return;
      if (type === "pointerdown") remember();
      else restore();
      if (type === "click") {
        if (beforeCommand(button.id) === false) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        queueMicrotask(remember);
      }
    }, true));
    doc.addEventListener("pointerdown", (event) => {
      if (panel.hidden || panel.contains(event.target) || triggers.some((t) => t.contains(event.target))) return;
      if (doc.querySelector("dialog[open]")) return;
      close(); // Do not steal focus from the user's chosen outside target.
    }, true);
    doc.addEventListener("keydown", (event) => {
      if (panel.hidden || event.key !== "Escape" || doc.querySelector("dialog[open]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close({ restoreFocus: true });
    }, true);
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || win.matchMedia("(max-width: 719.98px)").matches) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...position } };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("is-dragging");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      position = { x: drag.origin.x + event.clientX - drag.x, y: drag.origin.y + event.clientY - drag.y };
      place();
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => handle.addEventListener(type, finishDrag));
    handle.addEventListener("keydown", (event) => {
      const steps = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
      if (event.key === "Home") { event.preventDefault(); place(true); }
      else if (steps[event.key]) {
        event.preventDefault();
        position = { x: position.x + steps[event.key][0], y: position.y + steps[event.key][1] };
        place();
      }
    });
    win.addEventListener("resize", () => { finishDrag(); place(); });
    win.visualViewport?.addEventListener("resize", () => place());
    win.visualViewport?.addEventListener("scroll", () => place());
    return { close, reposition: place };
  }
  return Object.freeze({ commands, clampPosition, create });
});
