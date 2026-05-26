#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function main() {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath) {
    console.error("Usage: node build-ai-news-json.js <input.md|txt|json> [output.json]");
    process.exit(1);
  }

  const sourceText = fs.readFileSync(inputPath, "utf8");
  const payload = parseNewsSource(sourceText, path.basename(inputPath));
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  if (outputPath) {
    fs.writeFileSync(outputPath, json, "utf8");
    console.log(`Wrote ${outputPath}`);
    return;
  }

  process.stdout.write(json);
}

function parseNewsSource(text, fileName) {
  const fencedJson = extractJsonCodeBlock(text);
  if (fencedJson) {
    return normalizeNewsPayload(JSON.parse(fencedJson));
  }

  const trimmed = text.trim();
  if (/^[\[{]/.test(trimmed)) {
    return normalizeNewsPayload(JSON.parse(trimmed));
  }

  return parseMarkdownNews(text, fileName);
}

function extractJsonCodeBlock(text) {
  const match = text.match(/(?:^|\n)```json[ \t]*\n([\s\S]*?)\n```/i);
  return match ? match[1].trim() : "";
}

function parseMarkdownNews(text, fileName) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const items = [];
  let current = null;
  let trendLines = [];
  let inTrend = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#+\s*全体傾向/.test(line) || /^全体傾向[：:]/.test(line)) {
      inTrend = true;
      const rest = line.replace(/^#+\s*全体傾向[：:]?\s*/, "");
      if (rest) trendLines.push(rest);
      continue;
    }

    if (inTrend) {
      trendLines.push(stripBullet(line));
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      current = {
        heading,
        points: [],
        whyImportant: "",
        sourceLabel: "",
        sourceUrl: ""
      };
      items.push(current);
      continue;
    }

    if (!current) continue;

    if (/^(なぜ重要か|重要性)[：:]/.test(line)) {
      current.whyImportant = line.replace(/^(なぜ重要か|重要性)[：:]\s*/, "");
      continue;
    }

    if (/^(情報源リンク|source url|url|link)[：:]/i.test(line)) {
      current.sourceUrl = line.replace(/^(情報源リンク|source url|url|link)[：:]\s*/i, "");
      continue;
    }

    if (/^(情報源|source)[：:]/i.test(line)) {
      const value = line.replace(/^(情報源|source)[：:]\s*/i, "");
      const urlMatch = value.match(/https?:\/\/\S+/);
      if (urlMatch) {
        current.sourceUrl = urlMatch[0];
        current.sourceLabel = value.replace(urlMatch[0], "").replace(/[()]/g, "").trim();
      } else {
        current.sourceLabel = value;
      }
      continue;
    }

    current.points.push(stripBullet(line));
  }

  const date = extractDate(text) || todayStampDashed();
  return normalizeNewsPayload({
    title: "AI最新ニュース朝刊",
    date,
    items,
    trendSummary: trendLines.join(" ").trim() || buildFallbackTrend(items),
    sourceFile: fileName
  });
}

function parseHeading(line) {
  const match = line.match(/^\d+\.\s+(?:\*\*)?(.+?)(?:\*\*)?$/);
  return match ? match[1].trim() : "";
}

function stripBullet(line) {
  return line.replace(/^[-*・]\s*/, "").trim();
}

function extractDate(text) {
  const match = text.match(/(20\d{2})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
  if (!match) return "";

  const [, yyyy, mm, dd] = match;
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function buildFallbackTrend(items) {
  if (!items.length) return "";
  return `${items.length}件のAIニュースを整理した朝刊です。`;
}

function todayStampDashed() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function normalizeNewsPayload(payload) {
  const root = Array.isArray(payload) ? { items: payload } : (payload || {});
  const rawItems = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.newsItems)
      ? root.newsItems
      : Array.isArray(root.articles)
        ? root.articles
        : [];

  return {
    title: root.title || root.headline || root.name || root["見出し"] || "AI最新ニュース朝刊",
    date: root.date || root.publishedAt || root.day || root["日付"] || todayStampDashed(),
    items: rawItems.map(normalizeNewsItem).filter((item) => item.heading),
    trendSummary: root.trendSummary || root.summary || root.overview || root["全体傾向"] || ""
  };
}

function normalizeNewsItem(item) {
  const points = []
    .concat(item.points || [])
    .concat(item.summary ? [item.summary] : [])
    .concat(item.keyPoints || [])
    .concat(item.details || [])
    .concat(item["要点"] || [])
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  return {
    heading: String(item.heading || item.title || item.headline || item["見出し"] || "").trim(),
    points,
    whyImportant: String(item.whyImportant || item.importance || item.why || item["なぜ重要か"] || "").trim(),
    sourceLabel: String(item.sourceLabel || item.source || item["情報源"] || "").trim(),
    sourceUrl: String(item.sourceUrl || item.url || item.link || item["情報源リンク"] || "").trim()
  };
}

main();
