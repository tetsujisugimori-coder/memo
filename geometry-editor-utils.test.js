const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeometryBlock, cloneGeometryBlock, parseGeometryBlockLine, serializeGeometryBlock } = require("./geometry-block-utils.js");
const {
  addCircle, addPoint, addPolygon, addRightAngle, addSegment, createHistory, deleteSelection, moveObject, movePoint,
  screenPointToViewBox, updateLengthLabel, updateSegmentLineStyle, updateVertexLabel
} = require("./geometry-editor-utils.js");

function withPoints(count = 3) {
  let geometry = createGeometryBlock("editor-test");
  for (let index = 0; index < count; index += 1) geometry = addPoint(geometry, { x: 10 + index * 20, y: 20 + index * 10 });
  return geometry;
}

function svgFallbackMock(rect) {
  return { getBoundingClientRect: () => rect };
}

test("非正方形の編集領域ではSVG表示余白を除いて画面座標を論理座標へ変換する", () => {
  const viewBox = { x: 0, y: 0, width: 100, height: 100 };
  const desktop = screenPointToViewBox(svgFallbackMock({ left: 100, top: 40, width: 600, height: 200 }), 400, 140, viewBox);
  assert.deepEqual(desktop, { x: 50, y: 50 });
  const mobile = screenPointToViewBox(svgFallbackMock({ left: 10, top: 20, width: 300, height: 500 }), 160, 270, viewBox);
  assert.deepEqual(mobile, { x: 50, y: 50 });
});

test("getScreenCTMの逆行列を優先してクリック・ドラッグ終点を論理座標へ変換する", () => {
  const inverse = { a: 0.25, b: 0, c: 0, d: 0.5, e: -20, f: -10 };
  const svg = {
    getScreenCTM: () => ({ inverse: () => inverse }),
    createSVGPoint: () => ({
      x: 0, y: 0,
      matrixTransform(matrix) { return { x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f }; }
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  };
  assert.deepEqual(screenPointToViewBox(svg, 280, 120, { x: 0, y: 0, width: 100, height: 100 }), { x: 50, y: 50 });
});

test("点を追加し、頂点名を編集して相対位置つきで保持する", () => {
  const geometry = withPoints(1);
  const point = geometry.points[0];
  const changed = updateVertexLabel(geometry, point.id, "P");
  const label = changed.annotations.find((annotation) => annotation.pointId === point.id);
  assert.deepEqual(changed.points[0], { id: point.id, x: 10, y: 20, visible: true, style: "default" });
  assert.equal(label.label, "P");
  assert.equal(label.offsetX, 8);
  assert.equal(label.offsetY, -8);
});

test("線分は点IDを参照し、重複と自己参照を拒否し、線種を保存する", () => {
  const geometry = withPoints(2);
  const [a, b] = geometry.points;
  const withSegment = addSegment(geometry, a.id, b.id, "dashed");
  assert.deepEqual(withSegment.objects[0].pointIds, [a.id, b.id]);
  assert.equal(withSegment.objects[0].lineStyle, "dashed");
  assert.throws(() => addSegment(withSegment, b.id, a.id), /既にあります/);
  assert.throws(() => addSegment(geometry, a.id, a.id), /異なる2点/);
  assert.equal(updateSegmentLineStyle(withSegment, withSegment.objects[0].id, "solid").objects[0].lineStyle, "solid");
});

test("三角形、四角形、5点以上の多角形は頂点順を保持する", () => {
  [3, 4, 5].forEach((count) => {
    const geometry = withPoints(count);
    const polygon = addPolygon(geometry, geometry.points.map((point) => point.id)).objects[0];
    assert.deepEqual(polygon.pointIds, geometry.points.map((point) => point.id));
  });
});

test("線分の辺ラベルは辺0だけを保存し、既存の省略edgeIndexは辺0として復元する", () => {
  let geometry = withPoints(2);
  geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id);
  const segment = geometry.objects[0];
  geometry = updateLengthLabel(geometry, segment.id, "5 cm", 0);
  assert.equal(parseGeometryBlockLine(serializeGeometryBlock(geometry)).annotations[2].label, "5 cm");
  assert.throws(() => updateLengthLabel(geometry, segment.id, "不正", 1), /辺の指定が不正/);
  const legacy = {
    ...geometry,
    annotations: [{ id: "legacy-length", type: "length-label", objectId: segment.id, label: "a" }]
  };
  assert.equal(parseGeometryBlockLine(serializeGeometryBlock(legacy)).annotations[0].edgeIndex, undefined);
});

test("円、三角形、四角形を点参照で作成し、辺の表示文字列を保存・復元する", () => {
  let geometry = withPoints(4);
  geometry = addPolygon(geometry, geometry.points.slice(0, 3).map((point) => point.id));
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  geometry = addCircle(geometry, geometry.points[0].id, geometry.points[1].id);
  geometry = updateLengthLabel(geometry, geometry.objects[0].id, "a", 0);
  geometry = updateLengthLabel(geometry, geometry.objects[0].id, "triangle-last", 2);
  geometry = updateLengthLabel(geometry, geometry.objects[1].id, "5 cm", 2);
  geometry = updateLengthLabel(geometry, geometry.objects[1].id, "quad-last", 3);
  const restored = parseGeometryBlockLine(serializeGeometryBlock(geometry));
  assert.equal(restored.objects.filter((object) => object.type === "circle").length, 1);
  assert.equal(restored.annotations.find((annotation) => annotation.objectId === geometry.objects[0].id && annotation.edgeIndex === 0).label, "a");
  assert.equal(restored.annotations.find((annotation) => annotation.objectId === geometry.objects[1].id && annotation.edgeIndex === 2).label, "5 cm");
  assert.equal(restored.annotations.find((annotation) => annotation.objectId === geometry.objects[0].id && annotation.edgeIndex === 2).label, "triangle-last");
  assert.equal(restored.annotations.find((annotation) => annotation.objectId === geometry.objects[1].id && annotation.edgeIndex === 3).label, "quad-last");
});

test("同一座標の異なる点IDから半径0の円を作成しない", () => {
  let geometry = createGeometryBlock("zero-radius");
  geometry = addPoint(geometry, { x: 40, y: 50 });
  geometry = addPoint(geometry, { x: 40, y: 50 });
  assert.throws(() => addCircle(geometry, geometry.points[0].id, geometry.points[1].id), /中心と異なる位置/);
});

test("円を構成する点の移動で半径0になる操作を拒否し、元データを変更しない", () => {
  let geometry = createGeometryBlock("circle-drag");
  geometry = addPoint(geometry, { x: 20, y: 30 });
  geometry = addPoint(geometry, { x: 60, y: 30 });
  geometry = addCircle(geometry, geometry.points[0].id, geometry.points[1].id);
  const before = JSON.parse(JSON.stringify(geometry));
  assert.throws(() => movePoint(geometry, geometry.points[0].id, 60, 30), /中心と異なる位置/);
  assert.deepEqual(geometry, before);
});

test("点移動は参照先の線分・多角形を変えず、論理座標だけを更新する", () => {
  let geometry = withPoints(3);
  geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id);
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const moved = movePoint(geometry, geometry.points[0].id, 61.5, 18.25);
  assert.equal(moved.points[0].x, 61.5);
  assert.equal(moved.points[0].y, 18.25);
  assert.deepEqual(moved.objects, geometry.objects);
});

test("図形全体の移動はその構成点だけを同じ距離だけ移動する", () => {
  let geometry = withPoints(3);
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const moved = moveObject(geometry, geometry.objects[0].id, 15, -5);
  moved.points.forEach((point, index) => {
    assert.equal(point.x, geometry.points[index].x + 15);
    assert.equal(point.y, geometry.points[index].y - 5);
  });
  assert.deepEqual(moved.objects, geometry.objects);
});

test("点削除は参照する線分・多角形・注釈をまとめて削除する", () => {
  let geometry = withPoints(3);
  geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id);
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const result = deleteSelection(geometry, { kind: "point", id: geometry.points[0].id });
  assert.equal(result.points.length, 2);
  assert.equal(result.objects.length, 0);
  assert.equal(result.annotations.some((annotation) => annotation.pointId === geometry.points[0].id), false);
});

test("直角注釈は異なる3点を参照して追加・移動・削除・Undo/Redoできる", () => {
  const geometry = withPoints(3);
  const [firstRay, vertex, secondRay] = geometry.points;
  const history = createHistory(geometry);
  const annotated = addRightAngle(geometry, {
    vertexId: vertex.id,
    rayVertexIds: [firstRay.id, secondRay.id]
  });
  const annotation = annotated.annotations.find((item) => item.type === "right-angle");
  assert.ok(annotation, "有効な3点から直角注釈を追加する");
  assert.equal(annotation.vertexId, vertex.id);
  assert.deepEqual(annotation.rayVertexIds, [firstRay.id, secondRay.id]);
  history.push(annotated);

  assert.throws(() => addRightAngle(geometry, { vertexId: vertex.id, rayVertexIds: [vertex.id, secondRay.id] }), /異なる2つの方向点/);
  assert.throws(() => addRightAngle(geometry, { vertexId: vertex.id, rayVertexIds: [firstRay.id, firstRay.id] }), /異なる2つの方向点/);
  assert.throws(() => addRightAngle(geometry, { vertexId: "missing", rayVertexIds: [firstRay.id, secondRay.id] }), /頂点/);

  const moved = movePoint(annotated, vertex.id, 55, 35);
  assert.deepEqual(moved.annotations.find((item) => item.id === annotation.id).rayVertexIds, annotation.rayVertexIds, "点移動後も注釈の参照IDを維持する");
  const deletedByPoint = deleteSelection(moved, { kind: "point", id: firstRay.id });
  assert.equal(deletedByPoint.annotations.some((item) => item.id === annotation.id), false, "関連点削除時に直角注釈も削除する");
  assert.equal(deleteSelection(annotated, { kind: "annotation", id: annotation.id }).annotations.some((item) => item.id === annotation.id), false, "直角注釈を単体でも削除できる");
  assert.equal(history.undo().annotations.some((item) => item.type === "right-angle"), false, "Undoで直角注釈の追加を戻せる");
  assert.equal(history.redo().annotations.find((item) => item.type === "right-angle").id, annotation.id, "Redoで同じ直角注釈を復元できる");
});

test("直角注釈の線分参照は対応する方向点との組を検証し、保存時も不整合を拒否する", () => {
  let geometry = withPoints(4);
  const [firstRay, vertex, secondRay, other] = geometry.points;
  geometry = addSegment(geometry, vertex.id, firstRay.id);
  geometry = addSegment(geometry, vertex.id, secondRay.id);
  geometry = addSegment(geometry, vertex.id, other.id);
  const [firstSegment, secondSegment, wrongDirectionSegment] = geometry.objects;
  assert.doesNotThrow(() => addRightAngle(geometry, {
    vertexId: vertex.id,
    rayVertexIds: [firstRay.id, secondRay.id],
    segmentIds: [firstSegment.id, secondSegment.id]
  }), "対応する2本の線分参照を受理する");
  assert.throws(() => addRightAngle(geometry, {
    vertexId: vertex.id,
    rayVertexIds: [firstRay.id, secondRay.id],
    segmentIds: [wrongDirectionSegment.id, secondSegment.id]
  }), /線分参照が不正/, "頂点だけを共有する別方向の線分参照を拒否する");
  const invalidStored = {
    ...geometry,
    annotations: [{
      id: "invalid-right-angle", type: "right-angle",
      vertexId: vertex.id,
      rayVertexIds: [firstRay.id, secondRay.id],
      pointIds: [firstRay.id, vertex.id, secondRay.id],
      segmentIds: [wrongDirectionSegment.id, secondSegment.id]
    }]
  };
  assert.throws(() => serializeGeometryBlock(invalidStored), /対応する頂点と方向点/);
  assert.equal(parseGeometryBlockLine(`<!-- memo-nexus:geometry-block:${Buffer.from(JSON.stringify(invalidStored)).toString("hex")} -->`), null, "保存済みの不整合な線分参照も読込時に拒否する");

  const annotated = addRightAngle(geometry, {
    vertexId: vertex.id,
    rayVertexIds: [firstRay.id, secondRay.id],
    segmentIds: [firstSegment.id, secondSegment.id]
  });
  assert.ok(deleteSelection(annotated, { kind: "object", id: wrongDirectionSegment.id }).annotations.some((item) => item.type === "right-angle"), "無関係な線分の削除では直角注釈を維持する");
  assert.equal(deleteSelection(annotated, { kind: "object", id: firstSegment.id }).annotations.some((item) => item.type === "right-angle"), false, "参照中の線分の削除では直角注釈を削除する");
});

test("保存・読込で点、参照、頂点名、線種を維持し、不正参照を安全に拒否する", () => {
  let geometry = withPoints(3);
  geometry = updateVertexLabel(geometry, geometry.points[0].id, "頂点A");
  geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id, "dashed");
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const restored = parseGeometryBlockLine(serializeGeometryBlock(geometry));
  assert.deepEqual(restored, geometry);
  assert.throws(() => serializeGeometryBlock({ ...geometry, objects: [{ ...geometry.objects[0], pointIds: ["missing", geometry.points[1].id] }] }), /参照先が存在しません/);
});

test("複製時はブロック・点・図形・注釈のIDを再生成して独立する", () => {
  let geometry = withPoints(3);
  geometry = addSegment(geometry, geometry.points[0].id, geometry.points[1].id);
  geometry = addPolygon(geometry, geometry.points.map((point) => point.id));
  const copied = cloneGeometryBlock(geometry);
  assert.notEqual(copied.id, geometry.id);
  assert.equal(copied.points.some((point) => geometry.points.some((original) => original.id === point.id)), false);
  assert.equal(copied.objects.some((object) => geometry.objects.some((original) => original.id === object.id)), false);
  assert.equal(copied.objects.every((object) => object.pointIds.every((pointId) => copied.points.some((point) => point.id === pointId))), true);
});

test("図形内履歴は追加、移動、削除をUndo/Redoでき、移動は一操作として記録する", () => {
  let geometry = withPoints(1);
  const history = createHistory(geometry);
  const moved = movePoint(geometry, geometry.points[0].id, 30, 40);
  history.push(moved);
  const deleted = deleteSelection(moved, { kind: "point", id: moved.points[0].id });
  history.push(deleted);
  assert.equal(history.undo().points.length, 1);
  assert.deepEqual(history.undo().points[0], geometry.points[0]);
  assert.equal(history.redo().points[0].x, 30);
  assert.equal(history.redo().points.length, 0);
});
