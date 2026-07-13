const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, 'ai-news-2026-05-29.json');
const dir = 'C:\\Users\\tetsu\\Documents\\Codex\\メモ帳\\IMPORT';

fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, path.join(dir, 'ai-news-2026-05-29.json'));
fs.copyFileSync(src, path.join(dir, 'ai-news-latest.json'));

console.log('SAVED');
