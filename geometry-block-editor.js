(function initGeometryBlockEditor(globalScope) {
  "use strict";

  const model = globalScope.MemoNexusGeometryEditorUtils;
  if (!model) throw new Error("MemoNexusGeometryEditorUtils is required");
  const svgNamespace = "http://www.w3.org/2000/svg";
  const modes = [
    ["select", "選択"], ["point", "点"], ["segment", "線分"], ["polygon", "多角形"]
  ];

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function selectedLabel(geometry, selection) {
    if (selection?.kind !== "point") return "";
    return model.vertexLabel(geometry, selection.id)?.label || "";
  }

  function createGeometryBlockEditor(initialGeometry, { blockIndex = 0, onChange, onDelete } = {}) {
    let geometry = initialGeometry;
    let mode = "select";
    let selection = null;
    let draftPointIds = [];
    let drag = null;
    const history = model.createHistory(geometry);
    const article = document.createElement("article");
    article.className = "geometry-block-editor";
    article.dataset.geometryId = geometry.id;
    article.dataset.geometryIndex = String(blockIndex);
    article.tabIndex = 0;

    const header = document.createElement("div");
    header.className = "geometry-block-editor-head";
    const title = document.createElement("strong");
    title.textContent = `図形 ${blockIndex + 1}`;
    const removeBlockButton = document.createElement("button");
    removeBlockButton.type = "button";
    removeBlockButton.className = "danger-button geometry-block-remove";
    removeBlockButton.textContent = "図形ブロックを削除";
    removeBlockButton.setAttribute("aria-label", `図形${blockIndex + 1}のブロック全体を削除`);
    removeBlockButton.disabled = typeof onDelete !== "function";
    removeBlockButton.addEventListener("click", () => {
      if (!onDelete || typeof globalScope.confirm !== "function" || !globalScope.confirm("この図形ブロックを削除しますか？")) return;
      onDelete();
    });
    const status = document.createElement("span");
    status.className = "geometry-block-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    header.append(title, removeBlockButton, status);

    const tools = document.createElement("div");
    tools.className = "geometry-block-tools";
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", `図形${blockIndex + 1}の作成モード`);
    const modeButtons = new Map();
    modes.forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.geometryMode = value;
      button.setAttribute("aria-pressed", String(value === mode));
      button.addEventListener("click", () => {
        mode = value;
        clearDraft();
        status.textContent = value === "select" ? "選択モード" : `${label}モード`;
      });
      modeButtons.set(value, button);
      tools.append(button);
    });
    const completeButton = document.createElement("button");
    completeButton.type = "button";
    completeButton.textContent = "多角形を完了";
    completeButton.setAttribute("aria-label", "選択した点で多角形を完了");
    completeButton.addEventListener("click", () => completePolygon());
    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.textContent = "戻す";
    undoButton.setAttribute("aria-label", "図形操作を元に戻す");
    undoButton.addEventListener("click", () => restoreHistory("undo"));
    const redoButton = document.createElement("button");
    redoButton.type = "button";
    redoButton.textContent = "やり直す";
    redoButton.setAttribute("aria-label", "図形操作をやり直す");
    redoButton.addEventListener("click", () => restoreHistory("redo"));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button";
    deleteButton.textContent = "選択を削除";
    deleteButton.addEventListener("click", () => {
      if (!selection) return;
      commit(model.deleteSelection(geometry, selection));
      selection = null;
      status.textContent = "選択を削除しました";
      updateControls();
    });
    tools.append(completeButton, undoButton, redoButton, deleteButton);

    const properties = document.createElement("div");
    properties.className = "geometry-block-properties";
    const labelField = document.createElement("label");
    labelField.textContent = "頂点名";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.maxLength = 500;
    labelInput.setAttribute("aria-label", "選択した点の頂点名");
    labelInput.addEventListener("change", () => {
      if (selection?.kind !== "point") return;
      commit(model.updateVertexLabel(geometry, selection.id, labelInput.value));
      status.textContent = "頂点名を更新しました";
      updateControls();
    });
    labelField.append(labelInput);
    const lineField = document.createElement("label");
    lineField.textContent = "線種";
    const lineStyle = document.createElement("select");
    lineStyle.setAttribute("aria-label", "選択した線分の線種");
    [["solid", "実線"], ["dashed", "破線"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      lineStyle.append(option);
    });
    lineStyle.addEventListener("change", () => {
      if (selection?.kind !== "object") return;
      commit(model.updateSegmentLineStyle(geometry, selection.id, lineStyle.value));
      status.textContent = "線種を更新しました";
      updateControls();
    });
    lineField.append(lineStyle);
    properties.append(labelField, lineField);

    const canvas = document.createElement("div");
    canvas.className = "geometry-canvas";
    const svg = svgElement("svg", { viewBox: `${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`, role: "img", tabindex: 0 });
    svg.setAttribute("aria-label", `図形${blockIndex + 1}の編集キャンバス`);
    canvas.append(svg);
    article.append(header, tools, properties, canvas);

    function coordinates(event) {
      return model.screenPointToViewBox(svg, event.clientX, event.clientY, geometry.viewBox);
    }

    function clearDraft() {
      draftPointIds = [];
      draw();
      updateControls();
    }

    function setSelection(next) {
      selection = next;
      updateControls();
      draw();
    }

    function commit(next) {
      geometry = next;
      history.push(geometry);
      onChange?.(geometry);
      draw();
      updateControls();
    }

    function restoreHistory(direction) {
      geometry = history[direction]();
      onChange?.(geometry);
      status.textContent = direction === "undo" ? "図形操作を元に戻しました" : "図形操作をやり直しました";
      draw();
      updateControls();
    }

    function selectTarget(target) {
      const node = target.closest?.("[data-geometry-kind]");
      if (!node) return null;
      return { kind: node.dataset.geometryKind, id: node.dataset.geometryId };
    }

    function completePolygon() {
      if (mode !== "polygon" || draftPointIds.length < 3) return;
      try {
        const pointIds = [...draftPointIds];
        const next = model.addPolygon(geometry, pointIds);
        draftPointIds = [];
        commit(next);
        status.textContent = `${pointIds.length}点の多角形を作成しました`;
      } catch (error) {
        status.textContent = error.message || String(error);
      }
    }

    function handleCanvasClick(event) {
      if (drag?.moved) return;
      const target = selectTarget(event.target);
      if (mode === "select") {
        setSelection(target);
        status.textContent = target ? "図形を選択しました" : "選択を解除しました";
        return;
      }
      if (mode === "point") {
        if (target) {
          setSelection(target);
          return;
        }
        const position = coordinates(event);
        commit(model.addPoint(geometry, position));
        status.textContent = "点を追加しました";
        return;
      }
      if (!target || target.kind !== "point") return;
      if (mode === "segment") {
        if (!draftPointIds.length) {
          draftPointIds = [target.id];
          status.textContent = "終点を選択してください";
          draw();
          return;
        }
        try {
          const next = model.addSegment(geometry, draftPointIds[0], target.id);
          draftPointIds = [];
          commit(next);
          status.textContent = "線分を作成しました";
        } catch (error) {
          status.textContent = error.message || String(error);
        }
        clearDraft();
        return;
      }
      if (mode === "polygon") {
        if (target.id === draftPointIds[0] && draftPointIds.length >= 3) return completePolygon();
        if (!draftPointIds.includes(target.id)) draftPointIds.push(target.id);
        status.textContent = `${draftPointIds.length}点を選択中。最初の点または「多角形を完了」で確定します`;
        if (event.detail >= 2) completePolygon();
        else {
          draw();
          updateControls();
        }
      }
    }

    function draw() {
      svg.replaceChildren();
      svg.setAttribute("viewBox", `${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`);
      const points = new Map(geometry.points.map((point) => [point.id, point]));
      geometry.objects.filter((object) => object.type === "polygon").forEach((polygon) => {
        const vertices = polygon.pointIds.map((pointId) => points.get(pointId)).filter(Boolean);
        if (vertices.length < 3) return;
        const node = svgElement("polygon", { points: vertices.map((point) => `${point.x},${point.y}`).join(" "), class: `geometry-polygon${selection?.kind === "object" && selection.id === polygon.id ? " is-selected" : ""}`, fill: "transparent", "data-geometry-kind": "object", "data-geometry-id": polygon.id });
        svg.append(node);
      });
      geometry.objects.filter((object) => object.type === "segment").forEach((segment) => {
        const [start, end] = segment.pointIds.map((pointId) => points.get(pointId));
        if (!start || !end) return;
        const hit = svgElement("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: "geometry-segment-hit", "data-geometry-kind": "object", "data-geometry-id": segment.id });
        const node = svgElement("line", { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: `geometry-segment${segment.lineStyle === "dashed" ? " is-dashed" : ""}${selection?.kind === "object" && selection.id === segment.id ? " is-selected" : ""}`, "pointer-events": "none" });
        svg.append(hit, node);
      });
      if (mode === "polygon" && draftPointIds.length > 1) {
        const vertices = draftPointIds.map((pointId) => points.get(pointId)).filter(Boolean);
        if (vertices.length > 1) svg.append(svgElement("polyline", { points: vertices.map((point) => `${point.x},${point.y}`).join(" "), class: "geometry-draft", "pointer-events": "none" }));
      }
      geometry.points.forEach((point) => {
        if (!point.visible) return;
        const hit = svgElement("circle", { cx: point.x, cy: point.y, r: 5, class: "geometry-point-hit", "data-geometry-kind": "point", "data-geometry-id": point.id });
        const node = svgElement("circle", { cx: point.x, cy: point.y, r: 1.8, class: `geometry-point${selection?.kind === "point" && selection.id === point.id ? " is-selected" : ""}${draftPointIds.includes(point.id) ? " is-draft" : ""}`, "pointer-events": "none" });
        const label = model.vertexLabel(geometry, point.id);
        svg.append(hit, node);
        if (label?.label) {
          const text = svgElement("text", { x: point.x + label.offsetX, y: point.y + label.offsetY, class: "geometry-label", "pointer-events": "none" });
          text.textContent = label.label;
          svg.append(text);
        }
      });
    }

    function updateControls() {
      modeButtons.forEach((button, value) => button.setAttribute("aria-pressed", String(value === mode)));
      completeButton.disabled = mode !== "polygon" || draftPointIds.length < 3;
      undoButton.disabled = !history.canUndo;
      redoButton.disabled = !history.canRedo;
      deleteButton.disabled = !selection;
      const segment = selection?.kind === "object" ? model.objectById(geometry, selection.id) : null;
      labelInput.disabled = selection?.kind !== "point";
      labelInput.value = selectedLabel(geometry, selection);
      lineStyle.disabled = !segment || segment.type !== "segment";
      if (segment?.type === "segment") lineStyle.value = segment.lineStyle;
    }

    svg.addEventListener("pointerdown", (event) => {
      const target = selectTarget(event.target);
      if (mode !== "select" || target?.kind !== "point") return;
      drag = { pointId: target.id, original: geometry, moved: false };
      svg.setPointerCapture?.(event.pointerId);
      selection = target;
      updateControls();
      event.preventDefault();
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const position = coordinates(event);
      geometry = model.movePoint(geometry, drag.pointId, position.x, position.y);
      drag.moved = true;
      draw();
      event.preventDefault();
    });
    svg.addEventListener("pointerup", (event) => {
      if (!drag) return;
      const didMove = drag.moved;
      drag = null;
      svg.releasePointerCapture?.(event.pointerId);
      if (didMove) {
        history.push(geometry);
        onChange?.(geometry);
        status.textContent = "点を移動しました";
        updateControls();
      }
    });
    svg.addEventListener("pointercancel", () => {
      if (!drag) return;
      geometry = drag.original;
      drag = null;
      draw();
    });
    svg.addEventListener("click", handleCanvasClick);
    article.addEventListener("keydown", (event) => {
      if (event.target.matches("input, textarea, select")) return;
      if (event.key === "Escape") {
        clearDraft();
        status.textContent = "作成途中の操作を解除しました";
        event.preventDefault();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        deleteButton.click();
        event.preventDefault();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        restoreHistory(event.shiftKey ? "redo" : "undo");
        event.preventDefault();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        restoreHistory("redo");
        event.preventDefault();
      }
    });
    draw();
    updateControls();
    return article;
  }

  const api = { createGeometryBlockEditor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusGeometryBlockEditor = api;
})(typeof window !== "undefined" ? window : globalThis);
