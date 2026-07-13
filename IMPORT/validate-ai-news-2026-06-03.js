const fs = require('fs');
const path = require('path');

const target = path.resolve(__dirname, 'ai-news-2026-06-03.json');
const raw = fs.readFileSync(target, 'utf8');
const parsed = JSON.parse(raw);

if (parsed.title !== 'AI最新ニュース朝刊') throw new Error('title mismatch');
if (parsed.date !== '2026-06-03') throw new Error('date mismatch');
if (!Array.isArray(parsed.items) || parsed.items.length !== 5) throw new Error('items length mismatch');
if (typeof parsed.trendSummary !== 'string' || !parsed.trendSummary) throw new Error('trendSummary missing');

console.log(JSON.stringify({
  ok: true,
  target,
  bytes: Buffer.byteLength(raw),
  items: parsed.items.length
}, null, 2));
