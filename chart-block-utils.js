(function initChartBlockUtils(globalScope) {
  "use strict";

  const CHART_BLOCK_VERSION = 1;
  const MAX_CHART_ITEMS = 50;
  const MAX_CHART_SERIES = 3;
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

  // Invalid legacy data still falls back safely; editing/serialization validates first.
  function finiteChartNumber(value, fallback = 0) {
    if (!isValidChartNumber(value)) return fallback;
    const number = Number(value);
    return number === 0 ? 0 : number;
  }

  function isValidChartNumber(value) {
    return (typeof value === "number" || typeof value === "string")
      && String(value).trim() !== "" && Number.isFinite(Number(value));
  }

  // TSV is a rectangular table, with one header row and no CSV quoting or formulas.
  function parseChartTsv(text) {
    const fail = (row, column, value, reason) => ({ ok: false, error: { row, column, value, reason } });
    const rows = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
    while (rows.length && rows.at(-1).trim() === "") rows.pop();
    if (!rows.length) return fail(1, 1, "", "見出し行と項目データをTSV（タブ区切り）で貼り付けてください。");
    const header = rows[0].split("\t");
    if (header.length < 2) return fail(1, 2, rows[0], "系列列がありません。表をTSV（タブ区切り）で貼り付けてください。CSVには対応していません。");
    if (header.length - 1 > MAX_CHART_SERIES) return fail(1, MAX_CHART_SERIES + 2, header[MAX_CHART_SERIES + 1], "系列は最大3件です。列を減らしてください。");
    const names = header.slice(1).map((cell) => cell.trim());
    for (let index = 0; index < names.length; index += 1) {
      if (!names[index]) return fail(1, index + 2, header[index + 1], "系列名が空欄です。名前を入力してください。");
    }
    if (rows.length < 2) return fail(2, 1, "", "項目データがありません。1件以上の項目を入力してください。");
    if (rows.length - 1 > MAX_CHART_ITEMS) return fail(MAX_CHART_ITEMS + 2, 1, rows[MAX_CHART_ITEMS + 1].split("\t")[0], "項目は最大50件です。行を減らしてください。");
    const items = [];
    const series = names.map((name) => ({ name, values: [] }));
    for (let index = 1; index < rows.length; index += 1) {
      const cells = rows[index].split("\t");
      if (!rows[index].trim()) return fail(index + 1, 1, "", "表の途中に空行があります。空行を削除してください。");
      if (cells.length !== header.length) {
        const column = cells.length < header.length ? cells.length + 1 : header.length + 1;
        return fail(index + 1, column, cells[column - 1] ?? "", "列数が見出し行と一致しません。空欄を埋め、余分な列を削除してください。");
      }
      const label = cells[0].trim();
      if (!label) return fail(index + 1, 1, cells[0], "項目名が空欄です。名前を入力してください。");
      items.push({ label });
      for (let column = 1; column < cells.length; column += 1) {
        if (!isValidChartNumber(cells[column])) return fail(index + 1, column + 1, cells[column], "有限な数値を入力してください。空欄、カンマ、%、通貨記号、数式には対応していません。");
        series[column - 1].values.push(finiteChartNumber(cells[column]));
      }
    }
    return { ok: true, table: { items, series } };
  }

  // IDs for new positions are supplied by the caller's existing UUID route.
  // This transformation neither mutates inputs nor stores import UI state.
  function replaceChartTable(chartValue, table, newIds) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    const items = table.items.map((item, index) => ({ id: chart.items[index]?.id || newIds.items[index], label: item.label }));
    const series = table.series.map((entry, index) => ({
      id: chart.series[index]?.id || newIds.series[index],
      name: entry.name,
      color: chart.series[index]?.color || CHART_SERIES_COLORS[index],
      values: [...entry.values]
    }));
    return normalizeChartBlock({ ...chart, items, series }, chart.id);
  }

  function chartValidationError(chart) {
    const values = Array.isArray(chart?.series) && chart.series.length
      ? chart.series.flatMap((series) => series?.values || [])
      : (chart?.items || []).map((item) => item.value ?? 0);
    if (values.some((value) => !isValidChartNumber(value))) return "数値は有限な数値を入力してください";
    const chartType = ["bar", "pie", "line", "combo"].includes(chart?.chartType) ? chart.chartType : "bar";
    if (values.some((value) => Number(value) < 0)
      && chartType === "pie") {
      return "この形式は負数に未対応です。棒グラフまたは折れ線に切り替えてください";
    }
    if (chartType === "combo" && (!Array.isArray(chart?.series) || chart.series.length < 2)) {
      return "複合グラフには2系列以上が必要です。系列を追加するか、別の種類に切り替えてください";
    }
    return "";
  }

  function chartValueRange(items) {
    const values = (Array.isArray(items) ? items : []).map((item) => item?.value).filter(Number.isFinite);
    return { minimum: Math.min(0, ...values) || 0, maximum: Math.max(0, ...values) || 0 };
  }

  function chartAxisRange(range) {
    return typeof range === "number" ? chartValueRange([{ value: range }])
      : chartValueRange([{ value: range?.minimum }, { value: range?.maximum }]);
  }

  function chartValueRatio(value, range) {
    const { minimum, maximum } = chartAxisRange(range);
    const scale = Math.max(Math.abs(minimum), maximum);
    if (!scale || !Number.isFinite(value)) return 0;
    // Subtract only after scaling: MAX_VALUE - (-MAX_VALUE) would overflow.
    const low = minimum / scale;
    return Math.max(0, Math.min(1, (value / scale - low) / (maximum / scale - low)));
  }

  function chartBarExtent(value, range, start, end) {
    const zero = start + chartValueRatio(0, range) * (end - start);
    const tip = start + chartValueRatio(value, range) * (end - start);
    return { zero, tip, start: Math.min(zero, tip), size: Math.abs(tip - zero) };
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
      values: Array.from({ length: itemCount }, (_, itemIndex) => finiteChartNumber(sourceValues?.[itemIndex]))
    };
  }

  // Resolve only after series IDs have been normalized; never persist an index.
  function normalizeComboLineSeriesId(value, series) {
    return typeof value === "string" && series.some((entry) => entry.id === value)
      ? value : series.at(-1)?.id || "";
  }

  function formatChartAxisTitle(title, unit) {
    const name = normalizedText(title).trim();
    const suffix = normalizedText(unit).trim();
    return name && suffix ? `${name}（${suffix}）` : name || suffix;
  }

  function chartSeriesUnit(chart, series) {
    const appearance = chart?.appearance || {};
    const rightAxis = chart?.chartType === "combo" && appearance.comboAxisMode === "dual"
      && series?.id === normalizeComboLineSeriesId(appearance.comboLineSeriesId, chart.series || []);
    return normalizedText(rightAxis ? appearance.comboSecondaryUnit : chart?.unit).trim();
  }

  function comboSeriesKinds(chartValue) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    const selected = normalizeComboLineSeriesId(chart.appearance.comboLineSeriesId, chart.series);
    return chart.series.map((series) => ({ series, kind: series.id === selected ? "line" : "bar" }));
  }

  function normalizeChartBlock(value, fallbackId = "chart") {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const id = normalizedText(source.id).trim() || normalizedText(fallbackId).trim() || "chart";
    const sourceItems = Array.isArray(source.items) ? source.items.slice(0, MAX_CHART_ITEMS) : [];
    const usedIds = new Set();
    const items = sourceItems.map((item, index) => normalizeChartItem(item, id, index, usedIds));
    const appearanceSource = source.appearance && typeof source.appearance === "object" && !Array.isArray(source.appearance)
      ? source.appearance : {};
    const appearanceWithoutPieItemColors = { ...appearanceSource };
    delete appearanceWithoutPieItemColors.pieItemColors;
    const legacyValues = sourceItems.map((item) => finiteChartNumber(item?.value));
    const sourceSeries = Array.isArray(source.series) && source.series.length ? source.series.slice(0, MAX_CHART_SERIES) : [
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
      chartType: ["bar", "pie", "line", "combo"].includes(source.chartType) ? source.chartType : "bar",
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
        showDataTable: appearanceSource.showDataTable === true,
        showValues: appearanceSource.showValues !== false,
        showPoints: appearanceSource.showPoints !== false,
        showLegend: appearanceSource.showLegend === true,
        pieLabelMode: ["percentage", "value", "none"].includes(appearanceSource.pieLabelMode)
          ? appearanceSource.pieLabelMode : "percentage",
        pieSeriesId,
        ...(source.chartType === "combo" || Object.hasOwn(appearanceSource, "comboLineSeriesId")
          ? { comboLineSeriesId: normalizeComboLineSeriesId(appearanceSource.comboLineSeriesId, series) } : {}),
        ...(source.chartType === "combo" || Object.hasOwn(appearanceSource, "comboAxisMode") || Object.hasOwn(appearanceSource, "comboSecondaryUnit")
          ? { comboAxisMode: appearanceSource.comboAxisMode === "dual" ? "dual" : "single",
            comboSecondaryUnit: normalizedText(appearanceSource.comboSecondaryUnit).trim() } : {}),
        ...Object.fromEntries(["leftAxisTitle", "rightAxisTitle"].filter((key) => Object.hasOwn(appearanceSource, key))
          .map((key) => [key, normalizedText(appearanceSource[key]).trim()])),
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
    const error = chartValidationError(chart);
    if (error) throw new Error(error);
    return `<!-- memo-nexus:chart-block:${utf8ToHex(JSON.stringify(normalizeChartBlock(chart, chart && chart.id)))} -->`;
  }

  function parseChartBlockLine(line, { normalize = true } = {}) {
    const match = String(line || "").match(CHART_BLOCK_PATTERN);
    if (!match) return null;
    try {
      const source = JSON.parse(hexToUtf8(match[1]));
      return normalize ? normalizeChartBlock(source) : source;
    } catch (error) {
      return null;
    }
  }

  // Display-only text; percentages come from the existing geometry helpers.
  function chartDatumDescription({ item, series, value, unit = "", assignment = "", percentage = null }) {
    const number = Number.isFinite(value) ? String(value === 0 ? 0 : value) : "0";
    const ratio = percentage === null ? "" : `（割合: ${Number.isFinite(percentage) ? percentage : 0}%）`;
    return `${item.label}、${series.name}${assignment ? `（${assignment}）` : ""}: ${number}${unit}${ratio}`;
  }

  function pieChartSegments(items) {
    if (Array.isArray(items) && items.some((item) => item?.value < 0)) return { total: 0, segments: [] };
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

  // Shared row projection: callers choose all series or the displayed pie series.
  function chartTableRows(items, series) {
    return items.map((item, index) => ({
      id: item.id, label: item.label,
      values: series.map((entry) => String(finiteChartNumber(entry.values[index])))
    }));
  }

  // Validate before normalization can hide invalid values or trim control characters.
  function chartToTsv(chartValue) {
    const sourceItems = chartValue?.items || [];
    const sourceSeries = chartValue?.series;
    const checkName = (value, kind, index) => {
      const name = String(value ?? "");
      if (/[\t\r\n]/.test(name)) throw new Error(
        `${kind}${index + 1}「${name}」にタブまたは改行が含まれているためコピーできません`);
      if (!name.trim()) throw new Error(`${kind}${index + 1}の名前が空欄のためコピーできません`);
      return name;
    };
    if (!sourceItems.length || sourceItems.length > MAX_CHART_ITEMS
      || (sourceSeries && (!sourceSeries.length || sourceSeries.length > MAX_CHART_SERIES))) {
      throw new Error("1〜50項目・1〜3系列のデータが必要です");
    }
    const labels = sourceItems.map((item, index) => checkName(item.label, "項目", index));
    const names = sourceSeries?.map((entry, index) => checkName(entry.name, "系列", index));
    const values = sourceSeries ? sourceSeries.map((entry) => entry.values)
      : [sourceItems.map((item) => item.value ?? 0)];
    values.forEach((column, seriesIndex) => sourceItems.forEach((item, itemIndex) => {
      if (!isValidChartNumber(column?.[itemIndex])) throw new Error(
        `項目${itemIndex + 1}「${labels[itemIndex]}」・系列${seriesIndex + 1}の値が有限な数値ではないためコピーできません`);
    }));
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    const items = chart.items.map((item, index) => ({ ...item, label: labels[index] }));
    const series = chart.series.map((entry, index) => ({ ...entry, name: names?.[index] ?? entry.name }));
    return [["項目", ...series.map((entry) => entry.name)],
      ...chartTableRows(items, series).map((row) => [row.label, ...row.values])]
      .map((row) => row.join("\t")).join("\n");
  }

  // Display-only data: preserve saved ordering and finite Number round trips.
  function chartDataTable(chartValue) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    if (chartValidationError(chartValue)) return null;
    const series = chartDisplaySeries(chart);
    const combo = chart.chartType === "combo";
    const dual = combo && chart.appearance.comboAxisMode === "dual";
    return {
      caption: `${chart.title ? `${chart.title}のデータ` : "グラフのデータ"}（元の入力値）`,
      columns: series.map((entry) => {
        const line = combo && entry.id === chart.appearance.comboLineSeriesId;
        return {
          id: entry.id, name: entry.name, color: entry.color,
          kind: combo ? (line ? "折れ線" : "棒") : "",
          axis: combo ? (dual && line ? "右軸" : "左軸") : "",
          unit: chartSeriesUnit(chart, entry)
        };
      }),
      rows: chartTableRows(chart.items, series)
    };
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
    if (!Number.isFinite(value)) return "0";
    if (value === 0) return "0";
    const rounded = Number(value.toPrecision(12));
    return Number.isFinite(rounded) ? String(rounded) : String(value);
  }

  function chartNumericTicks(range, { availableSpace = 140, minimumSpacing = 32, maximumCount = 5 } = {}) {
    const { minimum, maximum } = chartAxisRange(range);
    if (minimum === 0 && maximum === 0) return [{ value: 0, label: "0" }];
    const safeSpace = Number.isFinite(availableSpace) ? Math.max(1, availableSpace) : 140;
    const safeSpacing = Number.isFinite(minimumSpacing) ? Math.max(12, minimumSpacing) : 32;
    const mixed = minimum < 0 && maximum > 0;
    const least = mixed ? 3 : 2;
    const safeCount = Number.isFinite(maximumCount) ? Math.max(least, Math.floor(maximumCount)) : 5;
    const count = Math.max(least, Math.min(safeCount, Math.floor(safeSpace / safeSpacing) + 1));
    const negativeRatio = chartValueRatio(0, { minimum, maximum });
    const negativeSteps = mixed ? Math.max(1, Math.min(count - 2, Math.round((count - 1) * negativeRatio))) : minimum < 0 ? count - 1 : 0;
    const positiveSteps = count - 1 - negativeSteps;
    const values = [0];
    for (let index = 1; index <= negativeSteps; index++) values.push(minimum * (index / negativeSteps));
    for (let index = 1; index <= positiveSteps; index++) values.push(maximum * (index / positiveSteps));
    return [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      // On highly asymmetric ranges the smaller side can be subpixel-sized.
      // Keep the zero tick instead of painting another label over it.
      .filter((value) => !mixed || value === 0
        || (value < 0 ? negativeRatio >= 0.5 : negativeRatio <= 0.5)
        || Math.abs(chartValueRatio(value, { minimum, maximum }) - negativeRatio) * safeSpace >= safeSpacing)
      .map((value) => {
        const scale = range?.valueScale ?? 1;
        const overflow = scale > 1 && Math.abs(value) > Number.MAX_VALUE / scale;
        const label = overflow ? (value < 0 ? "負側上限超過" : "正側上限超過") : formatChartAxisValue(value * scale);
        return { value, label };
      })
      .filter((tick, index, ticks) => tick.value === 0 || (tick.label !== "0"
        && !ticks.some((other) => other.label === tick.label && Math.abs(other.value) > Math.abs(tick.value))));
  }

  function chartValueAxisLayout(maximum, { availableSpace = 140, characterWidth = 12, minimum = 42, minimumSpacing = 32, maximumCount = 5 } = {}) {
    const ticks = chartNumericTicks(maximum, { availableSpace, minimumSpacing, maximumCount });
    const labelWidth = Math.max(...ticks.map((tick) => chartTextWidth(tick.label, { characterWidth })));
    const safeMinimum = Number.isFinite(minimum) ? Math.max(24, minimum) : 42;
    // Numeric ticks keep their full text. Unlike category labels, they cannot be
    // capped without clipping; renderers add this margin to the required plot width.
    return { ticks, labelWidth, margin: Math.max(safeMinimum, Math.ceil(labelWidth + 10)) };
  }

  function lineChartWidth(items) {
    const itemCount = (Array.isArray(items) ? items : []).filter((item) => normalizedText(item?.label).trim()).length;
    return Math.max(420, itemCount * 74 + 76);
  }

  function lineChartPoints(items, width, { left = 42, right = 18, top = 22, baseline = 196, maximum: requestedMaximum, range: requestedRange } = {}) {
    const displayItems = Array.isArray(items) ? items.filter((item) => item && Number.isFinite(item.value)) : [];
    const plotLeft = Number.isFinite(left) && left >= 0 ? left : 42;
    const plotRight = Number.isFinite(right) && right >= 0 ? right : 18;
    const plotTop = Number.isFinite(top) && top >= 0 ? top : 22;
    const plotBaseline = Math.max(plotTop, Number.isFinite(baseline) && baseline >= 0 ? baseline : 196);
    const chartWidth = Math.max(plotLeft + plotRight, Number.isFinite(width) && width >= 0 ? width : plotLeft + plotRight);
    const range = requestedRange || (Number.isFinite(requestedMaximum) ? chartAxisRange(requestedMaximum) : chartValueRange(displayItems));
    const span = Math.max(0, chartWidth - plotLeft - plotRight);
    return displayItems.map((item, index) => ({
      ...item,
      x: displayItems.length === 1 ? plotLeft + span / 2 : plotLeft + (span * index) / Math.max(1, displayItems.length - 1),
      y: plotBaseline - chartValueRatio(item.value, range) * (plotBaseline - plotTop)
    }));
  }

  // Ordinary stacks use a shared scale; percentages use an item-local scale per
  // sign. Saved values are never scaled or clamped; overflowing totals are marked.
  function chartDivergingStacks(items, series, { percent = false } = {}) {
    const sourceItems = Array.isArray(items) ? items : [];
    const sourceSeries = Array.isArray(series) && series.length ? series : [{ values: sourceItems.map((item) => item?.value) }];
    const error = chartValidationError({ items: sourceItems, series: sourceSeries.map((entry) => ({ values: Array.isArray(entry?.values) ? entry.values : [] })) });
    if (error) throw new Error(error);
    const displayItems = sourceItems.map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item && normalizedText(item.label).trim());
    const scaleBase = Math.max(0, ...displayItems.flatMap(({ itemIndex }) => sourceSeries.map((entry) => Math.abs(finiteChartNumber(entry?.values?.[itemIndex])))));
    const groups = displayItems.map(({ item, itemIndex }, displayIndex) => {
      const positive = { side: "positive", total: 0, overflow: false, scaled: 0 };
      const negative = { side: "negative", total: 0, overflow: false, scaled: 0 };
      // Each sign needs its own item-local scale: a tiny negative side must
      // still reach -100% beside a MAX_VALUE positive side (and vice versa).
      const values = sourceSeries.map((entry) => finiteChartNumber(entry?.values?.[itemIndex]));
      positive.scale = percent ? Math.max(0, ...values.filter((value) => value > 0)) : scaleBase;
      negative.scale = percent ? Math.max(0, ...values.filter((value) => value < 0).map(Math.abs)) : scaleBase;
      const entries = sourceSeries.map((series, seriesIndex) => {
        const value = finiteChartNumber(series?.values?.[itemIndex]);
        const side = value < 0 ? negative : positive;
        const scaledStart = side.scaled;
        side.scaled += side.scale > 0 ? value / side.scale : 0;
        if (!side.overflow) {
          if (Math.abs(side.total) > Number.MAX_VALUE - Math.abs(value)) {
            side.total = null;
            side.overflow = true;
          } else side.total += value;
        }
        return { item, itemIndex, series, seriesIndex, value, scaledStart, scaledEnd: side.scaled };
      });
      return { item, itemIndex, displayIndex, entries, positive, negative,
        groupScaleBase: positive.scale, scaledTotal: positive.scaled, total: positive.total, totalOverflow: positive.overflow };
    });
    const range = { minimum: Math.min(0, ...groups.map((group) => group.negative.scaled)), maximum: Math.max(0, ...groups.map((group) => group.positive.scaled)), valueScale: scaleBase };
    if (percent) {
      range.minimum = groups.some((group) => group.negative.scaled < 0) ? -100 : 0;
      // Keep the existing 0..100% axis for all-zero data.
      range.maximum = groups.some((group) => group.positive.scaled > 0) || range.minimum === 0 ? 100 : 0;
      range.valueScale = 1;
    }
    groups.forEach((group) => {
      group.entries = group.entries.map((entry) => {
        const side = entry.value < 0 ? group.negative : group.positive;
        const ratioBase = Math.abs(side.scaled);
        const start = percent ? (ratioBase > 0 ? entry.scaledStart / ratioBase * 100 : 0) : entry.scaledStart;
        const end = percent ? (ratioBase > 0 ? entry.scaledEnd / ratioBase * 100 : 0) : entry.scaledEnd;
        const percentage = percent && ratioBase > 0 ? (entry.value / side.scale) / ratioBase * 100 : 0;
        return { ...entry, stackStart: chartValueRatio(start, range), stackEnd: chartValueRatio(end, range),
          percentage: percentage === 0 ? 0 : percentage, total: side.total,
          totalLabel: group.negative.scaled < 0 ? (entry.value < 0 ? "負側合計" : "正側合計") : "項目合計" };
      });
      group.totals = [group.positive, group.negative]
        .filter((side) => side.overflow || side.total !== 0 || (side === group.positive && group.negative.total === 0))
        .map((side) => ({ ...side, ratio: chartValueRatio(percent ? (side.scaled === 0 ? 0 : Math.sign(side.scaled) * 100) : side.scaled, range), labelPrefix: group.negative.total !== 0 ? (side.side === "positive" ? "正側合計" : "負側合計") : "合計" }));
    });
    return { scaleBase, range, maximumScaledTotal: range.maximum, groups };
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

  function chartValueLabelLayout(value, { x, tip, left, right, top = 24, bottom = 212, occupied = [], hideOnCollision = false }) {
    const text = formatChartStackTotal({ total: value });
    const width = chartTextWidth(text) + 4;
    const center = Math.max(left + width / 2, Math.min(right - width / 2, x));
    const direction = value < 0 ? 1 : -1;
    const preferred = tip + (value < 0 ? 14 : -8);
    const candidates = [preferred, ...Array.from({ length: 12 }, (_, index) => preferred + direction * (index + 1) * 16), ...Array.from({ length: 12 }, (_, index) => preferred - direction * (index + 1) * 16)];
    let y = Math.max(top, Math.min(bottom, preferred));
    let fits = false;
    const ascent = hideOnCollision ? 16 : 12;
    const labelHeight = hideOnCollision ? 20 : 14;
    for (const candidate of candidates) {
      if (candidate < top || candidate > bottom) continue;
      const box = { x: center - width / 2, y: candidate - ascent, width, height: labelHeight };
      if (occupied.every((other) => box.x >= other.x + other.width || box.x + box.width <= other.x || box.y >= other.y + other.height || box.y + box.height <= other.y)) {
        y = candidate;
        fits = true;
        break;
      }
    }
    if (hideOnCollision && (!fits || width > right - left)) return null;
    return { text, x: center, y, box: { x: center - width / 2, y: y - ascent, width, height: labelHeight } };
  }

  function shouldShowStackTotals(chartValue) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    return chart.chartType === "bar" && chart.appearance.barMode === "stacked" && chart.appearance.showStackTotals;
  }

  function stackedBarSegments(items, series, { left = 52, right = 18, top = 54, baseline = 196, width = 420, mode = "stacked" } = {}) {
    const layout = chartDivergingStacks(items, series, { percent: mode === "percent-stacked" });
    const plotLeft = Number.isFinite(left) ? Math.max(0, left) : 52;
    const plotRight = Number.isFinite(right) ? Math.max(0, right) : 18;
    const plotTop = Number.isFinite(top) ? Math.max(0, top) : 54;
    const plotBaseline = Math.max(plotTop, Number.isFinite(baseline) ? baseline : 196);
    const chartWidth = Math.max(plotLeft + plotRight, Number.isFinite(width) ? width : 420);
    const groupWidth = Math.max(1, chartWidth - plotLeft - plotRight) / Math.max(1, layout.groups.length);
    const barWidth = Math.max(4, Math.min(48, Math.max(12, groupWidth - 20)));
    const segments = layout.groups.flatMap((group) => group.entries.map((entry) => {
      const start = plotBaseline - entry.stackStart * (plotBaseline - plotTop);
      const end = plotBaseline - entry.stackEnd * (plotBaseline - plotTop);
      return { ...entry, x: plotLeft + group.displayIndex * groupWidth + (groupWidth - barWidth) / 2,
        y: Math.min(start, end), width: barWidth, height: Math.abs(end - start) };
    }));
    return { ...layout, segments, mode };
  }

  // The same category slots and zero-based extents serve grouped bars and combo.
  function groupedBarLayout(items, series, { left = 52, right = 18, top = 54, baseline = 196, width = 420, range: requestedRange } = {}) {
    const displayItems = (Array.isArray(items) ? items : []).map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => item && normalizedText(item.label).trim());
    const displaySeries = Array.isArray(series) ? series : [];
    const range = requestedRange || chartValueRange(displayItems.flatMap(({ itemIndex }) => displaySeries.map((entry) => ({ value: finiteChartNumber(entry.values?.[itemIndex]) }))));
    const plotWidth = Math.max(1, width - left - right);
    const groupWidth = plotWidth / Math.max(1, displayItems.length);
    const count = Math.max(1, displaySeries.length);
    const gap = 4;
    const barWidth = Math.max(4, Math.min(48, (Math.max(12, groupWidth - 20) - gap * (count - 1)) / count));
    const groups = displayItems.map(({ item, itemIndex }, displayIndex) => {
      const center = left + displayIndex * groupWidth + groupWidth / 2;
      const start = center - (barWidth * count + gap * (count - 1)) / 2;
      const segments = displaySeries.map((entry, seriesIndex) => {
        const value = finiteChartNumber(entry.values?.[itemIndex]);
        const extent = chartBarExtent(value, range, baseline, top);
        return { item, itemIndex, series: entry, value, x: start + seriesIndex * (barWidth + gap),
          y: extent.start, width: barWidth, height: extent.size, tip: extent.tip, zero: extent.zero };
      });
      return { item, itemIndex, center, segments };
    });
    return { range, groupWidth, groups, segments: groups.flatMap((group) => group.segments) };
  }

  // Expand only at render time. Symmetric domains align mixed signs without
  // ever adding magnitudes or expanding an endpoint beyond MAX_VALUE.
  function comboAxisRanges(chartValue) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    const kinds = comboSeriesKinds(chart);
    const rangeOf = (entries) => chartValueRange(chart.items.flatMap((item, index) => item.label
      ? entries.map(({ series }) => ({ value: series.values[index] })) : []));
    const sharedRange = rangeOf(kinds);
    if (chart.appearance.comboAxisMode !== "dual") {
      return { mode: "single", leftRange: sharedRange, rightRange: sharedRange, zeroRatio: chartValueRatio(0, sharedRange) };
    }
    const leftDataRange = rangeOf(kinds.filter(({ kind }) => kind === "bar"));
    const rightDataRange = rangeOf(kinds.filter(({ kind }) => kind === "line"));
    const positive = sharedRange.maximum > 0;
    const negative = sharedRange.minimum < 0;
    const align = (range) => {
      if (!negative) return range;
      // A zero-only axis has no scale: use one unit of empty space so its zero
      // follows the other axis (top for negative-only, center for mixed signs).
      const magnitude = Math.max(-range.minimum, range.maximum) || 1;
      return { minimum: -magnitude, maximum: positive ? magnitude : 0 };
    };
    return { mode: "dual", leftDataRange, rightDataRange,
      leftRange: align(leftDataRange), rightRange: align(rightDataRange), zeroRatio: negative ? (positive ? 0.5 : 1) : 0 };
  }

  function comboValueAxisLayout(range, options = {}) {
    const ticks = chartNumericTicks(range, options).map((tick) => ({ ...tick,
      fullLabel: String(tick.value),
      label: chartTextWidth(tick.label) > 80 ? tick.value.toExponential(2) : tick.label
    }));
    const labelWidth = Math.max(...ticks.map((tick) => chartTextWidth(tick.label)));
    return { ticks, labelWidth, margin: Math.max(42, Math.ceil(labelWidth + 10)) };
  }

  function comboChartLayout(chartValue, options = {}) {
    const chart = normalizeChartBlock(chartValue, chartValue?.id);
    const kinds = comboSeriesKinds(chart);
    const axes = comboAxisRanges(chart);
    const range = axes.leftRange;
    const layout = groupedBarLayout(chart.items, kinds.filter((entry) => entry.kind === "bar").map((entry) => entry.series), { ...options, range });
    const lineSeries = kinds.find((entry) => entry.kind === "line")?.series;
    const points = lineChartPoints(layout.groups.map(({ item, itemIndex }) => ({ ...item, value: lineSeries.values[itemIndex] })), options.width ?? 420, {
      ...options, top: options.top ?? 54, baseline: options.baseline ?? 196, range: axes.rightRange, left: (options.left ?? 52) + layout.groupWidth / 2,
      right: (options.right ?? 18) + layout.groupWidth / 2
    });
    const zero = (options.baseline ?? 196) - axes.zeroRatio * ((options.baseline ?? 196) - (options.top ?? 54));
    return { ...layout, ...axes, zero, kinds, lineSeries, points };
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
    if (stacked) {
      const layout = chartDivergingStacks(items, series, { percent: mode === "percent-stacked" });
      const safeTop = Number.isFinite(top) ? Math.max(0, top) : 34;
      const groups = layout.groups.map((group) => ({ ...group, y: safeTop + group.displayIndex * safeRowHeight, height: safeRowHeight }));
      const segments = groups.flatMap((group) => {
        const barHeight = Math.max(8, Math.min(26, group.height - 12));
        return group.entries.map((entry) => {
          const start = plotLeft + entry.stackStart * plotWidth;
          const end = plotLeft + entry.stackEnd * plotWidth;
          return { ...entry, x: Math.min(start, end), y: group.y + (group.height - barHeight) / 2,
            width: Math.abs(end - start), height: barHeight };
        });
      });
      return { ...layout, groups, segments, left: plotLeft, right: plotRight, top: safeTop, rowHeight: safeRowHeight,
        width: chartWidth, height: safeTop + groups.length * safeRowHeight + 30, plotWidth, mode };
    }
    const values = displayItems.flatMap(({ itemIndex }) => displaySeries.map((entry) => finiteChartNumber(entry?.values?.[itemIndex])));
    const range = chartValueRange(values.map((value) => ({ value })));
    const scaleBase = Math.max(0, ...values);
    const totalsByItemIndex = new Map(chartStackedTotals(items, series).map((entry) => [entry.itemIndex, entry]));
    const groups = displayItems.map(({ item, itemIndex }, displayIndex) => {
      const entries = displaySeries.map((entry, seriesIndex) => ({ item, itemIndex, series: entry, seriesIndex, value: finiteChartNumber(entry?.values?.[itemIndex]) }));
      const groupScaleBase = scaleBase;
      const scaledTotal = groupScaleBase > 0 ? entries.reduce((total, entry) => total + entry.value / groupScaleBase, 0) : 0;
      const total = totalsByItemIndex.get(itemIndex);
      return { item, itemIndex, displayIndex, entries, groupScaleBase, scaledTotal, y: top + displayIndex * safeRowHeight, height: safeRowHeight, total: total?.total ?? null, totalOverflow: total?.overflow === true };
    });
    const maximumScaledTotal = Math.max(0, ...groups.map((group) => group.scaledTotal));
    const segments = groups.flatMap((group) => {
      const gap = 3;
      const barHeight = Math.max(4, Math.min(18, (group.height - gap * Math.max(0, displaySeries.length - 1)) / Math.max(1, displaySeries.length)));
      const usedHeight = barHeight * displaySeries.length + gap * Math.max(0, displaySeries.length - 1);
      const startY = group.y + (group.height - usedHeight) / 2;
      return group.entries.map((entry) => {
        const extent = chartBarExtent(entry.value, range, plotLeft, plotLeft + plotWidth);
        const ratio = chartValueRatio(entry.value, range);
        return { ...entry, x: extent.start, y: startY + entry.seriesIndex * (barHeight + gap), width: extent.size, height: barHeight, stackStart: 0, stackEnd: Math.max(0, Math.min(1, ratio)), percentage: 0, total: group.total };
      });
    });
    return { range, scaleBase, maximumScaledTotal, groups, segments, left: plotLeft, right: plotRight, top, rowHeight: safeRowHeight, width: chartWidth, height: Math.max(0, top + groups.length * safeRowHeight + 30), plotWidth, mode: "grouped" };
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
    MAX_CHART_ITEMS,
    MAX_CHART_SERIES,
    parseChartTsv,
    replaceChartTable,
    formatChartAxisTitle,
    chartSeriesUnit,
    chartDatumDescription,
    comboChartLayout,
    comboAxisRanges,
    comboValueAxisLayout,
    comboSeriesKinds,
    groupedBarLayout,
    normalizeComboLineSeriesId,
    CHART_BLOCK_VERSION,
    DEFAULT_CHART_COLOR,
    DEFAULT_CHART_SERIES_NAME,
    CHART_SERIES_COLORS,
    PIE_CHART_COLORS,
    chartValueLabelLayout,
    chartBarExtent,
    chartValueRange,
    chartValueRatio,
    chartValidationError,
    finiteChartNumber,
    isValidChartNumber,
    chartCategoryLabels,
    chartBlockPlainText,
    chartDisplaySeries,
    chartDataTable,
    chartToTsv,
    chartLabelLayout,
    chartNumericTicks,
    chartDivergingStacks,
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
