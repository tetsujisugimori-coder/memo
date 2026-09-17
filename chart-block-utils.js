(function initChartBlockUtils(globalScope) {
  "use strict";

  const CHART_BLOCK_VERSION = 1;
  const CHART_BLOCK_PATTERN = /^\s*<!-- memo-nexus:chart-block:([0-9a-f]+) -->\s*$/i;
  const DEFAULT_CHART_COLOR = "#4f46e5";
  const DEFAULT_CHART_SERIES_NAME = "系列 1";
  const CHART_SERIES_COLORS = ["#4f46e5", "#dc2626", "#059669"];
  const PIE_CHART_COLORS = ["#4f46e5", "#dc2626", "#059669", "#d97706", "#0891b2", "#7c3aed", "#db2777", "#65a30d"];
  const IMAGE_BLOCK_START = "<!-- memo-nexus:image-block -->";
  const IMAGE_BLOCK_END = "<!-- /memo-nexus:image-block -->";

  function utf8ToHex(value) {
    return Array.from(new TextEncoder().encode(String(value))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function hexToUtf8(value) {
    const source = String(value || "");
    if (!source || source.length % 2 !== 0 || /[^0-9a-f]/i.test(source)) throw new Error("グラフブロックのデータ形式が不正です");
    const bytes = new Uint8Array(source.length / 2);
    for (let index = 0; index < source.length; index += 2) bytes[index / 2] = Number.parseInt(source.slice(index, index + 2), 16);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function normalizedText(value) {
    return value == null ? "" : String(value).replace(/\r\n?/g, "\n");
  }

  function normalizedColor(value, fallback = DEFAULT_CHART_COLOR) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "").trim()) ? String(value).trim().toLowerCase() : fallback;
  }

  function nonNegativeFiniteNumber(value, fallback = 0) {
    if (value === "" || value == null) return fallback;
    const number = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  }

  function normalizeBarMode(value) {
    return ["stacked", "percent-stacked"].includes(value) ? value : "grouped";
  }

  function normalizeBarOrientation(value) {
    return value === "horizontal" ? "horizontal" : "vertical";
  }

  function normalizePieItemColors(value, items) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries((Array.isArray(items) ? items : []).flatMap((item) => {
      const id = normalizedText(item?.id).trim();
      const color = id && Object.hasOwn(source, id) ? String(source[id] || "").trim() : "";
      return /^#[0-9a-f]{6}$/i.test(color) ? [[id, color.toLowerCase()]] : [];
    }));
  }

  function normalizeChartItem(item, fallbackId, index, usedIds) {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const baseId = normalizedText(source.id).trim() || `${fallbackId}-item-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      label: normalizedText(source.label).trim()
    };
  }

  function normalizeChartSeries(series, fallbackId, index, itemCount, usedIds, legacyValues) {
    const source = series && typeof series === "object" && !Array.isArray(series) ? series : {};
    const baseId = normalizedText(source.id).trim() || `${fallbackId}-series-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const sourceValues = Array.isArray(source.values) ? source.values : legacyValues;
    return {
      id,
      name: normalizedText(source.name).trim() || `${DEFAULT_CHART_SERIES_NAME.replace("1", String(index + 1))}`,
      color: normalizedColor(source.color, CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]),
      values: Array.from({ length: itemCount }, (_, itemIndex) => nonNegativeFiniteNumber(sourceValues?.[itemIndex]))
    };
  }

  function normalizeChartBlock(value, fallbackId = "chart") {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const id = normalizedText(source.id).trim() || normalizedText(fallbackId).trim() || "chart";
    const sourceItems = Array.isArray(source.items) ? source.items.slice(0, 50) : [];
    const usedIds = new Set();
    const items = sourceItems.map((item, index) => normalizeChartItem(item, id, index, usedIds));
    const appearanceSource = source.appearance && typeof source.appearance === "object" && !Array.isArray(source.appearance)
      ? source.appearance : {};
    const appearanceWithoutPieItemColors = { ...appearanceSource };
    delete appearanceWithoutPieItemColors.pieItemColors;
    const legacyValues = sourceItems.map((item) => nonNegativeFiniteNumber(item?.value));
    const sourceSeries = Array.isArray(source.series) && source.series.length ? source.series.slice(0, 3) : [
      { id: `${id}-series-1`, name: DEFAULT_CHART_SERIES_NAME, color: appearanceSource.color, values: legacyValues }
    ];
    const usedSeriesIds = new Set();
    const series = sourceSeries.map((entry, index) => normalizeChartSeries(entry, id, index, items.length, usedSeriesIds, index === 0 ? legacyValues : []));
    const pieSeriesId = typeof appearanceSource.pieSeriesId === "string" && series.some((entry) => entry.id === appearanceSource.pieSeriesId)
      ? appearanceSource.pieSeriesId : series[0].id;
    const pieItemColors = normalizePieItemColors(appearanceSource.pieItemColors, items);
    return {
      ...source,
      type: "chart",
      id,
      schemaVersion: Number.isInteger(source.schemaVersion) && source.schemaVersion > 0 ? source.schemaVersion : CHART_BLOCK_VERSION,
      chartType: ["bar", "pie", "line"].includes(source.chartType) ? source.chartType : "bar",
      title: normalizedText(source.title).trim(),
      unit: normalizedText(source.unit).trim(),
      items,
      series,
      appearance: {
        ...appearanceWithoutPieItemColors,
        // appearance.color is retained as a compatibility mirror. Series colors are authoritative.
        color: series[0].color,
        barMode: normalizeBarMode(appearanceSource.barMode),
        barOrientation: normalizeBarOrientation(appearanceSource.barOrientation),
        showStackTotals: appearanceSource.showStackTotals === true,
        showValues: appearanceSource.showValues !== false,
        showPoints: appearanceSource.showPoints !== false,
        showLegend: appearanceSource.showLegend === true,
        pieLabelMode: ["percentage", "value", "none"].includes(appearanceSource.pieLabelMode)
          ? appearanceSource.pieLabelMode : "percentage",
        pieSeriesId,
        ...(Object.keys(pieItemColors).length ? { pieItemColors } : {})
      }
    };
  }

  function moveChartItem(chartValue, itemIndex, direction) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    if (!Number.isInteger(itemIndex) || !Number.isInteger(direction)) return chart;
    const destinationIndex = itemIndex + direction;
    if (itemIndex < 0 || itemIndex >= chart.items.length || destinationIndex < 0 || destinationIndex >= chart.items.length) return chart;
    const moveAtIndex = (values) => values.map((value, index) => {
      if (index === itemIndex) return values[destinationIndex];
      if (index === destinationIndex) return values[itemIndex];
      return value;
    });
    return {
      ...chart,
      items: moveAtIndex(chart.items),
      series: chart.series.map((series) => ({ ...series, values: moveAtIndex(series.values) }))
    };
  }

  function moveChartSeries(chartValue, seriesIndex, direction) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    if (!Number.isInteger(seriesIndex) || !Number.isInteger(direction)) return chart;
    const destinationIndex = seriesIndex + direction;
    if (seriesIndex < 0 || seriesIndex >= chart.series.length || destinationIndex < 0 || destinationIndex >= chart.series.length) return chart;
    const series = chart.series.map((entry, index) => {
      if (index === seriesIndex) return chart.series[destinationIndex];
      if (index === destinationIndex) return chart.series[seriesIndex];
      return entry;
    });
    return {
      ...chart,
      series,
      // appearance.color remains a compatibility mirror of the first series.
      appearance: { ...chart.appearance, color: series[0].color }
    };
  }

  function createChartBlock(id) {
    return normalizeChartBlock({
      type: "chart",
      id,
      schemaVersion: CHART_BLOCK_VERSION,
      chartType: "bar",
      title: "",
      unit: "",
      items: [{ id: `${id}-item-1`, label: "" }],
      series: [{ id: `${id}-series-1`, name: DEFAULT_CHART_SERIES_NAME, color: DEFAULT_CHART_COLOR, values: [0] }],
      appearance: { barMode: "grouped", barOrientation: "vertical", showStackTotals: false, showValues: true, showPoints: true, showLegend: false, pieLabelMode: "percentage", pieSeriesId: `${id}-series-1` }
    }, id);
  }

  function serializeChartBlock(chart) {
    return `<!-- memo-nexus:chart-block:${utf8ToHex(JSON.stringify(normalizeChartBlock(chart, chart && chart.id)))} -->`;
  }

  function parseChartBlockLine(line) {
    const match = String(line || "").match(CHART_BLOCK_PATTERN);
    if (!match) return null;
    try {
      return normalizeChartBlock(JSON.parse(hexToUtf8(match[1])));
    } catch (error) {
      return null;
    }
  }

  function pieChartSegments(items) {
    const displayItems = Array.isArray(items) ? items.filter((item) => item && item.label && Number.isFinite(item.value) && item.value >= 0) : [];
    const positiveItems = displayItems.filter((item) => item.value > 0);
    const total = positiveItems.reduce((sum, item) => sum + item.value, 0);
    const maximumValue = positiveItems.reduce((maximum, item) => Math.max(maximum, item.value), 0);
    if (!(maximumValue > 0)) return { total: 0, segments: [] };
    const scaledTotal = positiveItems.reduce((sum, item) => sum + item.value / maximumValue, 0);
    let startAngle = -Math.PI / 2;
    const segments = positiveItems.map((item, index) => {
      const ratio = (item.value / maximumValue) / scaledTotal;
      const endAngle = index === positiveItems.length - 1 ? (Math.PI * 3) / 2 : startAngle + ratio * Math.PI * 2;
      const segment = {
        ...item,
        color: pieItemColor(item, displayItems),
        startAngle,
        endAngle,
        percentage: ratio * 100
      };
      startAngle = endAngle;
      return segment;
    });
    return { total, segments };
  }

  function pieItemColor(item, displayItems) {
    const items = Array.isArray(displayItems) ? displayItems : [];
    const index = items.findIndex((entry) => entry?.id === item?.id);
    return normalizedColor(item?.color, PIE_CHART_COLORS[(index < 0 ? 0 : index) % PIE_CHART_COLORS.length]);
  }

  function resolvePieSeries(chartValue) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    return chart.series.find((series) => series.id === chart.appearance.pieSeriesId) || chart.series[0];
  }

  function chartDisplaySeries(chart) {
    const normalized = normalizeChartBlock(chart, chart?.id);
    return normalized.chartType === "pie" ? [resolvePieSeries(normalized)] : normalized.series;
  }

  function chartValueMaximum(items) {
    return Math.max(0, ...(Array.isArray(items) ? items : [])
      .filter((item) => item && Number.isFinite(item.value) && item.value >= 0)
      .map((item) => item.value));
  }

  function chartTextWidth(value, { characterWidth = 12 } = {}) {
    const safeCharacterWidth = Number.isFinite(characterWidth) ? Math.max(1, characterWidth) : 12;
    return Array.from(normalizedText(value)).reduce((width, character) => {
      // SVG fonts differ slightly by browser. Treating Latin characters as a
      // little wider than their usual glyph width leaves a stable safety gap.
      return width + (/^[\u0000-\u00ff]$/.test(character) ? safeCharacterWidth * 0.72 : safeCharacterWidth);
    }, 0);
  }

  function chartLabelLayout(value, { maximumWidth = 180, characterWidth = 12, maximumLines = 2 } = {}) {
    const fullText = normalizedText(value).trim();
    const safeWidth = Number.isFinite(maximumWidth) ? Math.max(42, maximumWidth) : 180;
    const safeCharacterWidth = Number.isFinite(characterWidth) ? Math.max(1, characterWidth) : 12;
    // Use the full-width character estimate for line breaks. This is deliberately
    // conservative for unbroken Japanese and alphanumeric identifiers.
    const charactersPerLine = Math.max(3, Math.floor(safeWidth / safeCharacterWidth));
    const maximumCharacters = charactersPerLine * Math.max(1, Math.floor(maximumLines) || 1);
    const characters = Array.from(fullText);
    const shortened = characters.length > maximumCharacters;
    const visible = shortened ? characters.slice(0, Math.max(1, maximumCharacters - 1)).concat("…") : characters;
    const lines = Array.from({ length: Math.max(1, Math.ceil(visible.length / charactersPerLine)) }, (_, index) => visible.slice(index * charactersPerLine, (index + 1) * charactersPerLine).join(""));
    return { fullText, text: visible.join(""), lines, shortened, charactersPerLine, width: safeWidth };
  }

  function chartCategoryLabels(items, { plotWidth = 320, maximumLabelWidth = 120, characterWidth = 12, minimumGap = 8 } = {}) {
    const entries = (Array.isArray(items) ? items : []).map((item, itemIndex) => ({ item, itemIndex, fullText: normalizedText(item?.label).trim() }))
      .filter((entry) => entry.fullText);
    const safePlotWidth = Number.isFinite(plotWidth) ? Math.max(1, plotWidth) : 320;
    const safeMaximumWidth = Number.isFinite(maximumLabelWidth) ? Math.max(42, maximumLabelWidth) : 120;
    const safeGap = Number.isFinite(minimumGap) ? Math.max(2, minimumGap) : 8;
    const longest = Math.max(42, ...entries.map((entry) => chartTextWidth(entry.fullText, { characterWidth })));
    const desiredWidth = Math.min(safeMaximumWidth, longest);
    const slotWidth = safePlotWidth / Math.max(1, entries.length);
    const interval = Math.max(1, Math.ceil((desiredWidth + safeGap) / Math.max(1, slotWidth)));
    const visibleIndexes = [];
    entries.forEach((entry, index) => {
      if (index % interval === 0) visibleIndexes.push(index);
    });
    // Keep the final category where it can coexist with the prior label. When
    // it cannot, replace the prior candidate instead of allowing an overlap.
    if (entries.length > 1 && !visibleIndexes.includes(entries.length - 1)) {
      const previous = visibleIndexes[visibleIndexes.length - 1];
      if ((entries.length - 1) - previous < interval) visibleIndexes[visibleIndexes.length - 1] = entries.length - 1;
      else visibleIndexes.push(entries.length - 1);
    }
    const labelWidth = Math.min(safeMaximumWidth, Math.max(42, slotWidth * interval - safeGap));
    const visible = new Set(visibleIndexes);
    return entries.map((entry, index) => ({
      ...entry,
      visible: visible.has(index),
      layout: chartLabelLayout(entry.fullText, { maximumWidth: labelWidth, characterWidth, maximumLines: 2 })
    }));
  }

  function formatChartAxisValue(value) {
    if (!Number.isFinite(value) || value < 0) return "0";
    if (value === 0) return "0";
    const rounded = Number(value.toPrecision(12));
    return Number.isFinite(rounded) ? String(rounded) : String(value);
  }

  function chartNumericTicks(maximum, { availableSpace = 140, minimumSpacing = 32, maximumCount = 5 } = {}) {
    const safeMaximum = Number.isFinite(maximum) && maximum >= 0 ? maximum : 0;
    if (safeMaximum === 0) return [{ value: 0, label: "0" }];
    const safeSpace = Number.isFinite(availableSpace) ? Math.max(1, availableSpace) : 140;
    const safeSpacing = Number.isFinite(minimumSpacing) ? Math.max(12, minimumSpacing) : 32;
    const safeMaximumCount = Number.isFinite(maximumCount) ? Math.max(2, Math.floor(maximumCount)) : 5;
    const count = Math.max(2, Math.min(safeMaximumCount, Math.floor(safeSpace / safeSpacing) + 1));
    return Array.from({ length: count }, (_, index) => {
      const value = safeMaximum * (index / Math.max(1, count - 1));
      return { value: Number.isFinite(value) ? value : 0, label: formatChartAxisValue(value) };
    });
  }

  function chartValueAxisLayout(maximum, { availableSpace = 140, characterWidth = 12, minimum = 42, maximumWidth = 124, minimumSpacing = 32, maximumCount = 5 } = {}) {
    const ticks = chartNumericTicks(maximum, { availableSpace, minimumSpacing, maximumCount });
    const labelWidth = Math.max(...ticks.map((tick) => chartTextWidth(tick.label, { characterWidth })));
    const safeMinimum = Number.isFinite(minimum) ? Math.max(24, minimum) : 42;
    const safeMaximumWidth = Number.isFinite(maximumWidth) ? Math.max(safeMinimum, maximumWidth) : 124;
    return { ticks, labelWidth, margin: Math.max(safeMinimum, Math.min(safeMaximumWidth, Math.ceil(labelWidth + 10))) };
  }

  function lineChartWidth(items) {
    const itemCount = (Array.isArray(items) ? items : []).filter((item) => normalizedText(item?.label).trim()).length;
    return Math.max(420, itemCount * 74 + 76);
  }

  function lineChartPoints(items, width, { left = 42, right = 18, top = 22, baseline = 196, maximum: requestedMaximum } = {}) {
    const displayItems = Array.isArray(items) ? items.filter((item) => item && Number.isFinite(item.value) && item.value >= 0) : [];
    const plotLeft = Number.isFinite(left) && left >= 0 ? left : 42;
    const plotRight = Number.isFinite(right) && right >= 0 ? right : 18;
    const plotTop = Number.isFinite(top) && top >= 0 ? top : 22;
    const plotBaseline = Math.max(plotTop, Number.isFinite(baseline) && baseline >= 0 ? baseline : 196);
    const chartWidth = Math.max(plotLeft + plotRight, Number.isFinite(width) && width >= 0 ? width : plotLeft + plotRight);
    const maximum = Number.isFinite(requestedMaximum) && requestedMaximum >= 0 ? requestedMaximum : chartValueMaximum(displayItems);
    const span = Math.max(0, chartWidth - plotLeft - plotRight);
    return displayItems.map((item, index) => ({
      ...item,
      x: displayItems.length === 1 ? plotLeft + span / 2 : plotLeft + (span * index) / Math.max(1, displayItems.length - 1),
      y: maximum > 0 ? plotBaseline - (item.value / maximum) * (plotBaseline - plotTop) : plotBaseline
    }));
  }

  function chartStackedTotals(items, series) {
    const sourceItems = Array.isArray(items) ? items : [];
    const sourceSeries = Array.isArray(series) && series.length ? series : [{ values: sourceItems.map((item) => item?.value) }];
    return sourceItems.map((item, itemIndex) => {
      let total = 0;
      let overflow = false;
      sourceSeries.forEach((entry) => {
        const value = nonNegativeFiniteNumber(entry?.values?.[itemIndex]);
        if (!overflow && total > Number.MAX_VALUE - value) {
          overflow = true;
        } else if (!overflow) {
          total += value;
        }
      });
      return { item, itemIndex, total: overflow ? null : total, overflow };
    });
  }

  function formatChartStackTotalDetail(total) {
    if (total?.overflow || !Number.isFinite(total?.total)) return "上限超過";
    const normalized = Number(total.total.toPrecision(15));
    return Number.isFinite(normalized) ? String(normalized) : String(total.total);
  }

  function formatChartStackTotal(total) {
    const detail = formatChartStackTotalDetail(total);
    const readable = detail;
    if (readable === "上限超過" || readable.length <= 10) return readable;
    const [mantissa, exponent] = total.total.toExponential(2).split("e");
    const compactMantissa = mantissa.includes(".") ? mantissa.replace(/0+$/, "").replace(/\.$/, "") : mantissa;
    return `${compactMantissa}e${exponent}`;
  }

  function shouldShowStackTotals(chartValue) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    return chart.chartType === "bar" && chart.appearance.barMode === "stacked" && chart.appearance.showStackTotals;
  }

  function stackedBarSegments(items, series, { left = 52, right = 18, top = 54, baseline = 196, width = 420, mode = "stacked" } = {}) {
    const displayItems = (Array.isArray(items) ? items : []).map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item && normalizedText(item.label).trim());
    const displaySeries = Array.isArray(series) ? series : [];
    const plotLeft = Number.isFinite(left) && left >= 0 ? left : 52;
    const plotRight = Number.isFinite(right) && right >= 0 ? right : 18;
    const plotTop = Number.isFinite(top) && top >= 0 ? top : 54;
    const plotBaseline = Math.max(plotTop, Number.isFinite(baseline) && baseline >= 0 ? baseline : 196);
    const chartWidth = Math.max(plotLeft + plotRight, Number.isFinite(width) && width >= 0 ? width : 420);
    const plotHeight = Math.max(0, plotBaseline - plotTop);
    const percentStacked = mode === "percent-stacked";
    const values = displayItems.flatMap(({ itemIndex }) => displaySeries.map((entry) => nonNegativeFiniteNumber(entry?.values?.[itemIndex])));
    const scaleBase = Math.max(0, ...values);
    const totalsByItemIndex = new Map(chartStackedTotals(items, series).map((entry) => [entry.itemIndex, entry]));
    const groups = displayItems.map(({ item, itemIndex }, displayIndex) => {
      const entries = displaySeries.map((entry, seriesIndex) => ({
        item,
        itemIndex,
        series: entry,
        seriesIndex,
        value: nonNegativeFiniteNumber(entry?.values?.[itemIndex])
      }));
      // 100%積み上げは項目内の構成比だけを比較する。全項目共通の
      // scaleBaseを使うと、別項目の巨大値によって小さい正数が0へ
      // アンダーフローするため、項目内の最大値で安全に縮小する。
      const groupScaleBase = percentStacked ? Math.max(0, ...entries.map((entry) => entry.value)) : scaleBase;
      const scaledTotal = groupScaleBase > 0 ? entries.reduce((total, entry) => total + entry.value / groupScaleBase, 0) : 0;
      const total = totalsByItemIndex.get(itemIndex);
      return { item, itemIndex, displayIndex, entries, groupScaleBase, scaledTotal, total: total?.total ?? null, totalOverflow: total?.overflow === true };
    });
    const maximumScaledTotal = Math.max(0, ...groups.map((group) => group.scaledTotal));
    const plotWidth = Math.max(1, chartWidth - plotLeft - plotRight);
    const groupWidth = plotWidth / Math.max(1, groups.length);
    const barWidth = Math.max(4, Math.min(48, Math.max(12, groupWidth - 20)));
    const segments = groups.flatMap((group) => {
      const x = plotLeft + group.displayIndex * groupWidth + (groupWidth - barWidth) / 2;
      let cumulativeScaled = 0;
      return group.entries.map((entry) => {
        const scaledValue = group.groupScaleBase > 0 ? entry.value / group.groupScaleBase : 0;
        const ratioBase = percentStacked ? group.scaledTotal : maximumScaledTotal;
        const startRatio = ratioBase > 0 ? Math.min(1, cumulativeScaled / ratioBase) : 0;
        cumulativeScaled += scaledValue;
        const endRatio = ratioBase > 0 ? Math.min(1, cumulativeScaled / ratioBase) : 0;
        const y = plotBaseline - endRatio * plotHeight;
        const bottom = plotBaseline - startRatio * plotHeight;
        return {
          ...entry,
          x,
          y,
          width: barWidth,
          height: Math.max(0, bottom - y),
          stackStart: startRatio,
          stackEnd: endRatio,
          percentage: percentStacked && ratioBase > 0 ? (scaledValue / ratioBase) * 100 : 0,
          total: group.total
        };
      });
    });
    return { scaleBase, maximumScaledTotal, groups, segments, mode: percentStacked ? "percent-stacked" : "stacked" };
  }

  function horizontalBarLabel(itemLabel, { maximumWidth = 180, characterWidth = 12, maximumLines = 2 } = {}) {
    return chartLabelLayout(itemLabel, { maximumWidth, characterWidth, maximumLines });
  }

  function horizontalBarLabelWidth(items, { minimum = 94, maximum = 180, characterWidth = 12 } = {}) {
    const labels = Array.isArray(items) ? items.map((item) => normalizedText(item?.label).trim()) : [];
    const longest = Math.max(0, ...labels.map((label) => Array.from(label).length));
    const requested = longest * (Number.isFinite(characterWidth) ? Math.max(1, characterWidth) : 12) + 18;
    return Math.max(minimum, Math.min(maximum, requested));
  }

  function horizontalBarSegments(items, series, { left = 140, right = 62, top = 34, rowHeight = 44, width = 520, mode = "grouped" } = {}) {
    const displayItems = (Array.isArray(items) ? items : []).map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item && normalizedText(item.label).trim());
    const displaySeries = Array.isArray(series) ? series : [];
    const plotLeft = Number.isFinite(left) ? Math.max(0, left) : 140;
    const plotRight = Number.isFinite(right) ? Math.max(0, right) : 62;
    const safeRowHeight = Number.isFinite(rowHeight) ? Math.max(22, rowHeight) : 44;
    const chartWidth = Math.max(plotLeft + plotRight + 1, Number.isFinite(width) ? width : 520);
    const plotWidth = Math.max(1, chartWidth - plotLeft - plotRight);
    const stacked = mode === "stacked" || mode === "percent-stacked";
    const percentStacked = mode === "percent-stacked";
    const values = displayItems.flatMap(({ itemIndex }) => displaySeries.map((entry) => nonNegativeFiniteNumber(entry?.values?.[itemIndex])));
    const scaleBase = Math.max(0, ...values);
    const totalsByItemIndex = new Map(chartStackedTotals(items, series).map((entry) => [entry.itemIndex, entry]));
    const groups = displayItems.map(({ item, itemIndex }, displayIndex) => {
      const entries = displaySeries.map((entry, seriesIndex) => ({ item, itemIndex, series: entry, seriesIndex, value: nonNegativeFiniteNumber(entry?.values?.[itemIndex]) }));
      const groupScaleBase = percentStacked ? Math.max(0, ...entries.map((entry) => entry.value)) : scaleBase;
      const scaledTotal = groupScaleBase > 0 ? entries.reduce((total, entry) => total + entry.value / groupScaleBase, 0) : 0;
      const total = totalsByItemIndex.get(itemIndex);
      return { item, itemIndex, displayIndex, entries, groupScaleBase, scaledTotal, y: top + displayIndex * safeRowHeight, height: safeRowHeight, total: total?.total ?? null, totalOverflow: total?.overflow === true };
    });
    const maximumScaledTotal = Math.max(0, ...groups.map((group) => group.scaledTotal));
    const segments = groups.flatMap((group) => {
      if (!stacked) {
        const gap = 3;
        const barHeight = Math.max(4, Math.min(18, (group.height - gap * Math.max(0, displaySeries.length - 1)) / Math.max(1, displaySeries.length)));
        const usedHeight = barHeight * displaySeries.length + gap * Math.max(0, displaySeries.length - 1);
        const startY = group.y + (group.height - usedHeight) / 2;
        return group.entries.map((entry) => {
          const ratio = scaleBase > 0 ? entry.value / scaleBase : 0;
          return { ...entry, x: plotLeft, y: startY + entry.seriesIndex * (barHeight + gap), width: Math.max(0, Math.min(plotWidth, ratio * plotWidth)), height: barHeight, stackStart: 0, stackEnd: Math.max(0, Math.min(1, ratio)), percentage: 0, total: group.total };
        });
      }
      let cumulativeScaled = 0;
      const barHeight = Math.max(8, Math.min(26, group.height - 12));
      const y = group.y + (group.height - barHeight) / 2;
      return group.entries.map((entry) => {
        const scaledValue = group.groupScaleBase > 0 ? entry.value / group.groupScaleBase : 0;
        const ratioBase = percentStacked ? group.scaledTotal : maximumScaledTotal;
        const startRatio = ratioBase > 0 ? Math.min(1, cumulativeScaled / ratioBase) : 0;
        cumulativeScaled += scaledValue;
        const endRatio = ratioBase > 0 ? Math.min(1, cumulativeScaled / ratioBase) : 0;
        return { ...entry, x: plotLeft + startRatio * plotWidth, y, width: Math.max(0, (endRatio - startRatio) * plotWidth), height: barHeight, stackStart: startRatio, stackEnd: endRatio, percentage: percentStacked && ratioBase > 0 ? (scaledValue / ratioBase) * 100 : 0, total: group.total };
      });
    });
    return { scaleBase, maximumScaledTotal, groups, segments, left: plotLeft, right: plotRight, top, rowHeight: safeRowHeight, width: chartWidth, height: Math.max(0, top + groups.length * safeRowHeight + 30), plotWidth, mode: percentStacked ? "percent-stacked" : stacked ? "stacked" : "grouped" };
  }

  function splitChartBlocks(markdown) {
    const source = String(markdown || "").replace(/\r\n?/g, "\n");
    const lines = source.split("\n");
    const offsets = [];
    let offset = 0;
    lines.forEach((line, index) => { offsets.push(offset); offset += line.length + (index < lines.length - 1 ? 1 : 0); });
    const segments = [];
    let textStart = 0;
    let inCodeFence = false;
    let inImageBlock = false;
    const pushText = (end) => { if (end > textStart) segments.push({ type: "text", text: source.slice(textStart, end), start: textStart, end }); };
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) { inCodeFence = !inCodeFence; return; }
      if (inCodeFence) return;
      if (trimmed === IMAGE_BLOCK_START) { inImageBlock = true; return; }
      if (trimmed === IMAGE_BLOCK_END) { inImageBlock = false; return; }
      if (inImageBlock) return;
      const chart = parseChartBlockLine(line);
      if (!chart) return;
      const start = offsets[index];
      const end = index < lines.length - 1 ? start + line.length + 1 : source.length;
      pushText(start);
      segments.push({ type: "chart", chart, start, end, raw: source.slice(start, end).replace(/\n$/, "") });
      textStart = end;
    });
    pushText(source.length);
    return segments.length ? segments : [{ type: "text", text: source, start: 0, end: source.length }];
  }

  function insertChartBlock(markdown, selectionStart, selectionEnd, chart) {
    const source = String(markdown || "");
    const requestedStart = Math.min(source.length, Math.max(0, Number(selectionStart) || 0));
    const requestedEnd = Math.min(source.length, Math.max(requestedStart, Number(selectionEnd) || requestedStart));
    const existing = splitChartBlocks(source).filter((segment) => segment.type === "chart");
    const boundary = (position) => existing.find((block) => position > block.start && position < block.end)?.end ?? position;
    const start = boundary(requestedStart);
    const end = Math.max(start, boundary(requestedEnd));
    const marker = serializeChartBlock(chart);
    const prefix = start > 0 && source[start - 1] !== "\n" ? "\n" : "";
    const suffix = end < source.length && source[end] !== "\n" ? "\n" : "";
    const insertedText = `${prefix}${marker}${suffix}`;
    return { value: `${source.slice(0, start)}${insertedText}${source.slice(end)}`, selectionStart: start + insertedText.length, selectionEnd: start + insertedText.length, insertedText };
  }

  function replaceChartBlock(markdown, block, chart) {
    const source = String(markdown || "");
    if (!block || block.type !== "chart" || source.slice(block.start, block.start + block.raw.length) !== block.raw) throw new Error("グラフブロックが変更されたため更新できませんでした");
    return `${source.slice(0, block.start)}${chart ? serializeChartBlock(chart) : ""}${source.slice(block.start + block.raw.length)}`;
  }

  function chartBlockPlainText(markdown) {
    return splitChartBlocks(markdown).map((segment) => segment.type === "text"
      ? segment.text
      : [segment.chart.title, segment.chart.unit, ...segment.chart.items.flatMap((item, itemIndex) => [item.label, ...segment.chart.series.map((series) => String(series.values[itemIndex]))])].filter(Boolean).join(" ")).join("");
  }

  const api = {
    CHART_BLOCK_VERSION,
    DEFAULT_CHART_COLOR,
    DEFAULT_CHART_SERIES_NAME,
    CHART_SERIES_COLORS,
    PIE_CHART_COLORS,
    chartCategoryLabels,
    chartBlockPlainText,
    chartDisplaySeries,
    chartLabelLayout,
    chartNumericTicks,
    chartStackedTotals,
    chartTextWidth,
    chartValueMaximum,
    chartValueAxisLayout,
    createChartBlock,
    formatChartStackTotal,
    formatChartStackTotalDetail,
    horizontalBarLabel,
    horizontalBarLabelWidth,
    horizontalBarSegments,
    insertChartBlock,
    lineChartPoints,
    lineChartWidth,
    moveChartItem,
    moveChartSeries,
    nonNegativeFiniteNumber,
    normalizeBarOrientation,
    normalizeChartBlock,
    normalizePieItemColors,
    parseChartBlockLine,
    pieItemColor,
    pieChartSegments,
    replaceChartBlock,
    resolvePieSeries,
    serializeChartBlock,
    shouldShowStackTotals,
    stackedBarSegments,
    splitChartBlocks
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusChartBlockUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
