(function initGeometryBlockEditor(globalScope) {
  "use strict";

  const model = globalScope.MemoNexusGeometryEditorUtils;
  if (!model) throw new Error("MemoNexusGeometryEditorUtils is required");
  const renderer = globalScope.MemoNexusGeometrySvgRenderer;
  if (!renderer) throw new Error("MemoNexusGeometrySvgRenderer is required");
  const svgNamespace = "http://www.w3.org/2000/svg";
  const modes = [
    ["select", "選択"], ["point", "点"], ["segment", "線分"], ["triangle", "三角形"],
    ["quadrilateral", "四角形"], ["circle", "円"], ["polygon", "多角形"], ["right-angle", "直角"]
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
    let draftVertices = [];
    let draftPreview = null;
    let selectedEdgeIndex = 0;
    let drag = null;
    let pointerSelection = null;
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
        status.textContent = value === "right-angle" ? rightAngleDraftStatus() : value === "select" ? "選択モード" : `${label}モード`;
      });
      modeButtons.set(value, button);
      tools.append(button);
    });
    const completeButton = document.createElement("button");
    completeButton.type = "button";
    completeButton.textContent = "多角形を完了";
    completeButton.setAttribute("aria-label", "選択した点で多角形を完了");
    completeButton.addEventListener("click", () => completePolygon());
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "作成をキャンセル";
    cancelButton.setAttribute("aria-label", "図形の作成途中の操作をキャンセル");
    cancelButton.addEventListener("click", () => {
      clearDraft();
      status.textContent = "作成途中の操作を解除しました";
    });
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
    tools.append(completeButton, cancelButton, undoButton, redoButton, deleteButton);

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
    const lengthField = document.createElement("label");
    lengthField.textContent = "辺";
    const edgeSelect = document.createElement("select");
    edgeSelect.setAttribute("aria-label", "選択した図形の辺");
    edgeSelect.addEventListener("change", () => {
      selectedEdgeIndex = Number(edgeSelect.value) || 0;
      updateControls();
    });
    lengthField.append(edgeSelect);
    const lengthLabelField = document.createElement("label");
    lengthLabelField.textContent = "辺の長さ表示";
    const lengthInput = document.createElement("input");
    lengthInput.type = "text";
    lengthInput.maxLength = 500;
    lengthInput.setAttribute("aria-label", "選択した辺の長さ表示");
    lengthInput.addEventListener("change", () => {
      const object = selection?.kind === "object" ? model.objectById(geometry, selection.id) : null;
      if (!object || !["segment", "polygon"].includes(object.type)) return;
      commit(model.updateLengthLabel(geometry, object.id, lengthInput.value, selectedEdgeIndex));
      status.textContent = "辺の長さ表示を更新しました";
      updateControls();
    });
    lengthLabelField.append(lengthInput);
    properties.append(labelField, lineField, lengthField, lengthLabelField);

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
      draftVertices = [];
      draftPreview = null;
      draw();
      updateControls();
    }

    function setSelection(next) {
      selection = next;
      selectedEdgeIndex = 0;
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

    function selectPointerTarget(event) {
      const direct = selectTarget(event.target);
      if (direct?.kind !== "point" || typeof document.elementsFromPoint !== "function") return direct;
      const rightAngleHit = document.elementsFromPoint(event.clientX, event.clientY)
        .find((node) => svg.contains(node) && node.matches?.(".geometry-right-angle-hit[data-geometry-kind='annotation']"));
      if (!rightAngleHit) return direct;
      const point = geometry.points.find((entry) => entry.id === direct.id);
      const matrix = svg.getScreenCTM();
      const mark = svg.querySelector(`.geometry-right-angle-mark[data-geometry-id="${rightAngleHit.dataset.geometryId}"]`);
      const length = mark?.getTotalLength();
      if (!point || !matrix || !Number.isFinite(length) || length <= 0) return direct;
      const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const screenPath = [0, length / 2, length].map((position) => {
        const pathPoint = mark.getPointAtLength(position);
        return new DOMPoint(pathPoint.x, pathPoint.y).matrixTransform(matrix);
      });
      if (screenPath.some((pathPoint) => !Number.isFinite(pathPoint.x) || !Number.isFinite(pathPoint.y))) return direct;
      const distanceToSegment = (start, end) => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0) return Math.hypot(event.clientX - start.x, event.clientY - start.y);
        const ratio = Math.max(0, Math.min(1, ((event.clientX - start.x) * dx + (event.clientY - start.y) * dy) / lengthSquared));
        return Math.hypot(event.clientX - (start.x + dx * ratio), event.clientY - (start.y + dy * ratio));
      };
      // A right-angle mark has two line segments. Compare their displayed screen-space
      // distance with the vertex center so zoom, viewBox, and an explicit size stay meaningful.
      const markDistance = Math.min(distanceToSegment(screenPath[0], screenPath[1]), distanceToSegment(screenPath[1], screenPath[2]));
      const pointDistance = Math.hypot(event.clientX - screenPoint.x, event.clientY - screenPoint.y);
      return markDistance < pointDistance ? { kind: "annotation", id: rightAngleHit.dataset.geometryId } : direct;
    }

    function requiredVertices() {
      return { segment: 2, triangle: 3, quadrilateral: 4, circle: 2 }[mode] || null;
    }

    function annotationDraft() {
      return mode === "right-angle" ? { type: "right-angle", required: 3 } : null;
    }

    function rightAngleDraftStatus() {
      return [
        "直角の頂点を選択してください",
        "1本目の方向を選択してください",
        "2本目の方向を選択してください"
      ][draftVertices.length] || "直角の頂点を選択してください";
    }

    function pointForDraft(entry, points) {
      return entry.pointId ? points.get(entry.pointId) : entry;
    }

    function materializeDraft() {
      let next = geometry;
      const pointIds = [];
      draftVertices.forEach((entry) => {
        if (entry.pointId) pointIds.push(entry.pointId);
        else {
          next = model.addPoint(next, entry);
          pointIds.push(next.points.at(-1).id);
        }
      });
      return { next, pointIds };
    }

    function completeShape() {
      const required = requiredVertices();
      if ((!required && (mode !== "polygon" || draftVertices.length < 3)) || (required && draftVertices.length !== required)) return;
      try {
        const { next: withPoints, pointIds } = materializeDraft();
        const next = mode === "circle" ? model.addCircle(withPoints, pointIds[0], pointIds[1])
          : mode === "segment" ? model.addSegment(withPoints, pointIds[0], pointIds[1])
            : model.addPolygon(withPoints, pointIds);
        const label = mode === "triangle" ? "三角形" : mode === "quadrilateral" ? "四角形" : mode === "circle" ? "円" : mode === "segment" ? "線分" : `${pointIds.length}点の多角形`;
        clearDraft();
        commit(next);
        status.textContent = `${label}を作成しました`;
      } catch (error) {
        if (mode === "circle") {
          draftVertices = draftVertices.slice(0, 1);
          draftPreview = null;
          draw();
          updateControls();
        }
        status.textContent = error.message || String(error);
      }
    }

    function completePolygon() {
      if (mode === "polygon") completeShape();
    }

    function connectedSegmentIds(vertexId, rayVertexIds) {
      const segmentIds = rayVertexIds.map((rayVertexId) => geometry.objects.find((object) => object.type === "segment"
        && object.pointIds.includes(vertexId) && object.pointIds.includes(rayVertexId))?.id);
      return segmentIds.every(Boolean) ? segmentIds : undefined;
    }

    function completeAnnotation() {
      const draft = annotationDraft();
      if (!draft || draftVertices.length !== draft.required || draftVertices.some((entry) => !entry.pointId)) return;
      const [vertex, firstRay, secondRay] = draftVertices.map((entry) => entry.pointId);
      try {
        const rayVertexIds = [firstRay, secondRay];
        const next = model.addRightAngle(geometry, {
          vertexId: vertex,
          rayVertexIds,
          segmentIds: connectedSegmentIds(vertex, rayVertexIds)
        });
        clearDraft();
        commit(next);
        status.textContent = "直角記号を追加しました";
      } catch (error) {
        draftVertices = draftVertices.slice(0, 2);
        draftPreview = null;
        draw();
        updateControls();
        status.textContent = error.message || String(error);
      }
    }

    function handleCanvasClick(event) {
      if (drag?.moved) return;
      const target = mode === "select" ? selectPointerTarget(event) : selectTarget(event.target);
      if (mode === "select") {
        const nextSelection = target || pointerSelection;
        pointerSelection = null;
        setSelection(nextSelection);
        status.textContent = nextSelection ? "図形を選択しました" : "選択を解除しました";
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
      const annotation = annotationDraft();
      if (annotation) {
        if (target?.kind !== "point") {
          status.textContent = "直角記号は既存の点を順に選択してください";
          return;
        }
        if (draftVertices.some((entry) => entry.pointId === target.id)) {
          status.textContent = "直角には異なる3点を指定してください";
          return;
        }
        draftVertices.push({ pointId: target.id });
        if (draftVertices.length === annotation.required) return completeAnnotation();
        status.textContent = rightAngleDraftStatus();
        draw();
        updateControls();
        return;
      }
      const required = requiredVertices();
      if (mode !== "polygon" && !required) return;
      if (target?.kind === "point" && target.id === draftVertices[0]?.pointId && mode === "polygon" && draftVertices.length >= 3) return completePolygon();
      if (target?.kind === "point" && draftVertices.some((entry) => entry.pointId === target.id)) return;
      draftVertices.push(target?.kind === "point" ? { pointId: target.id } : coordinates(event));
      if (required && draftVertices.length === required) return completeShape();
      status.textContent = mode === "polygon"
        ? `${draftVertices.length}点を選択中。最初の点または「多角形を完了」で確定します`
        : `${required - draftVertices.length}点を指定してください`;
      if (mode === "polygon" && event.detail >= 2) completePolygon();
      else { draw(); updateControls(); }
    }

    function draw() {
      renderer.renderGeometrySvg(svg, geometry, { selection, vertexLabel: model.vertexLabel });
      const points = new Map(geometry.points.map((point) => [point.id, point]));
      const draftPoints = draftVertices.map((entry) => pointForDraft(entry, points)).filter(Boolean);
      const previewPoints = draftPreview ? [...draftPoints, draftPreview] : draftPoints;
      if (mode === "circle" && previewPoints.length === 2) {
        const [center, radiusPoint] = previewPoints;
        svg.append(svgElement("circle", { cx: center.x, cy: center.y, r: Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y), class: "geometry-draft", fill: "transparent", "pointer-events": "none" }));
      } else if ((mode === "polygon" || requiredVertices()) && previewPoints.length > 1) {
        svg.append(svgElement("polyline", { points: previewPoints.map((point) => `${point.x},${point.y}`).join(" "), class: "geometry-draft", "pointer-events": "none" }));
      }
      // Draft-only presentation stays in the editor; persisted geometry is
      // rendered exclusively by the semantic renderer above.
      draftVertices.forEach((entry) => {
        if (!entry.pointId) return;
        const node = svg.querySelector?.(`.geometry-point[data-geometry-source-id="${entry.pointId}"]`);
        node?.classList?.add("is-draft");
      });
    }

    function updateControls() {
      modeButtons.forEach((button, value) => button.setAttribute("aria-pressed", String(value === mode)));
      completeButton.disabled = mode !== "polygon" || draftVertices.length < 3;
      cancelButton.disabled = draftVertices.length === 0;
      undoButton.disabled = !history.canUndo;
      redoButton.disabled = !history.canRedo;
      deleteButton.disabled = !selection;
      const segment = selection?.kind === "object" ? model.objectById(geometry, selection.id) : null;
      labelInput.disabled = selection?.kind !== "point";
      labelInput.value = selectedLabel(geometry, selection);
      lineStyle.disabled = !segment || segment.type !== "segment";
      if (segment?.type === "segment") lineStyle.value = segment.lineStyle;
      const hasEdges = Boolean(segment && ["segment", "polygon"].includes(segment.type));
      edgeSelect.replaceChildren();
      if (hasEdges) {
        const count = model.edgeCount(segment);
        selectedEdgeIndex = Math.min(selectedEdgeIndex, count - 1);
        for (let index = 0; index < count; index += 1) {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = segment.type === "segment" ? "線分" : `辺 ${index + 1}`;
          edgeSelect.append(option);
        }
        edgeSelect.value = String(selectedEdgeIndex);
      }
      edgeSelect.disabled = !hasEdges;
      lengthInput.disabled = !hasEdges;
      lengthInput.value = hasEdges ? model.lengthLabel(geometry, segment.id, selectedEdgeIndex)?.label || "" : "";
    }

    svg.addEventListener("pointerdown", (event) => {
      pointerSelection = null;
      const target = mode === "select" ? selectPointerTarget(event) : selectTarget(event.target);
      if (mode !== "select" || !target || !["point", "object"].includes(target.kind)) return;
      pointerSelection = target;
      drag = { ...target, original: geometry, origin: coordinates(event), moved: false };
      svg.setPointerCapture?.(event.pointerId);
      selection = target;
      updateControls();
      event.preventDefault();
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const position = coordinates(event);
      try {
        geometry = drag.kind === "point"
          ? model.movePoint(geometry, drag.id, position.x, position.y)
          : model.moveObject(drag.original, drag.id, position.x - drag.origin.x, position.y - drag.origin.y);
        drag.moved = true;
        drag.hasMoveError = false;
        draw();
      } catch (_) {
        drag.hasMoveError = true;
        status.textContent = "円の中心と円周上の点は同じ位置にできません。別の位置へ移動してください。";
      }
      event.preventDefault();
    });
    svg.addEventListener("pointerup", (event) => {
      if (!drag) return;
      const didMove = drag.moved;
      const movedKind = drag.kind;
      const hasMoveError = drag.hasMoveError;
      drag = null;
      svg.releasePointerCapture?.(event.pointerId);
      if (didMove) {
        history.push(geometry);
        onChange?.(geometry);
        if (!hasMoveError) status.textContent = movedKind === "object" ? "図形を移動しました" : "点を移動しました";
        updateControls();
      }
    });
    svg.addEventListener("pointercancel", (event) => {
      if (!drag) return;
      geometry = drag.original;
      drag = null;
      pointerSelection = null;
      svg.releasePointerCapture?.(event.pointerId);
      draw();
    });
    svg.addEventListener("pointermove", (event) => {
      if (drag || (!draftVertices.length && mode !== "point")) return;
      draftPreview = coordinates(event);
      draw();
    });
    svg.addEventListener("pointerleave", () => {
      if (!draftPreview) return;
      draftPreview = null;
      draw();
    });
    svg.addEventListener("click", handleCanvasClick);
    article.addEventListener("keydown", (event) => {
      if (event.target.matches("input, textarea, select")) return;
      if (event.key === "Escape") {
        clearDraft();
        if (selection) {
          selection = null;
          updateControls();
          draw();
          status.textContent = "選択と作成途中の操作を解除しました";
        } else status.textContent = "作成途中の操作を解除しました";
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
