const fs = require('fs');

const workFile = 'C:\\Users\\tetsu\\Documents\\Codex\\2026-05-27\\6-00-ai\\ai-news-2026-06-02.json';
const importDir = 'C:\\Users\\tetsu\\Documents\\Codex\\メモ帳\\IMPORT';
const memoryPath = 'C:\\Users\\tetsu\\.codex\\automations\\ai\\memory.md';

const payload = {
  workFile,
  workFileExists: fs.existsSync(workFile),
  workFileSize: fs.existsSync(workFile) ? fs.statSync(workFile).size : null,
  importDir,
  importDirExists: fs.existsSync(importDir),
  importEntries: fs.existsSync(importDir) ? fs.readdirSync(importDir).slice(0, 20) : [],
  memoryPath,
  memoryExists: fs.existsSync(memoryPath),
  memoryPreview: fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8').slice(0, 4000) : null
};

console.log(JSON.stringify(payload, null, 2));
