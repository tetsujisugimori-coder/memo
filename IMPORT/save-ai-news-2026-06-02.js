const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, 'ai-news-2026-06-02.json');
const importDir = 'C:\\Users\\tetsu\\Documents\\Codex\\メモ帳\\IMPORT';
const datedDest = path.join(importDir, 'ai-news-2026-06-02.json');
const latestDest = path.join(importDir, 'ai-news-latest.json');

if (!fs.existsSync(src)) {
  throw new Error(`missing source: ${src}`);
}

fs.mkdirSync(importDir, { recursive: true });
fs.copyFileSync(src, datedDest);
fs.copyFileSync(src, latestDest);

const stat = fs.statSync(src);
console.log(JSON.stringify({
  src,
  srcSize: stat.size,
  importDir,
  datedDest,
  datedExists: fs.existsSync(datedDest),
  latestDest,
  latestExists: fs.existsSync(latestDest)
}, null, 2));
