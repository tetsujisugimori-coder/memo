const fs = require('fs');
const path = require('path');

const memoryPath = 'C:\\Users\\tetsu\\.codex\\automations\\ai\\memory.md';
const now = '2026-05-29';
const content = [
  `- ${now}: 最新AI朝刊を作成。`,
  `  - 主要5件: Anthropicの650億ドル調達、Google I/O 2026のGemini Omni/SynthID拡張、OpenAIの選挙安全策、OpenAIのコンテンツ真正性強化、Microsoft-EYの10億ドル超投資。`,
  `  - 生成ファイル: ${path.resolve(__dirname, 'ai-news-2026-05-29.json')}`,
  `  - 保存先指定の C:\\Users\\tetsu\\Documents\\Codex\\メモ帳\\IMPORT への直接保存は、この実行環境の書き込み制限で失敗。チャット本文とローカル生成JSONは完成。`,
  `  - 実行時刻: ${new Date().toISOString()}`
].join('\n') + '\n';

fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
fs.writeFileSync(memoryPath, content, 'utf8');
console.log(memoryPath);
