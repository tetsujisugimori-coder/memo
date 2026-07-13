const fs = require('fs');
const path = require('path');

const memoryPath = 'C:\\Users\\tetsu\\.codex\\automations\\ai\\memory.md';
const now = '2026-06-02';
const runTime = '2026-06-02 22:00 JST';
const entry = [
  `- ${now}: 最新AI朝刊を作成。`,
  `  - 除外した既出テーマ: NVIDIA Alpamayo 2 Super、NVIDIA Isaac GR00T Reference Humanoid Robot、OpenAI Frontier Governance Framework、OpenAI第三者評価プレイブック、Google Gemini API Managed Agents。`,
  `  - 今回の主要5件: AnthropicのIPO非公開申請、OpenAIのコンテンツ真正性強化、Google Gemini Daily BriefとSpark、MicrosoftのCAISI/AISI評価連携、MetaのIncognito Chat。`,
  `  - 生成ファイル: ${path.resolve(__dirname, 'ai-news-2026-06-02.json')}`,
  `  - IMPORT保存結果: フォルダ自動作成は成功。C:\\Users\\tetsu\\Documents\\Codex\\メモ帳\\IMPORT への ai-news-2026-06-02.json / ai-news-latest.json のコピーは EPERM で失敗。`,
  `  - 実行時刻: ${runTime}`
].join('\n') + '\n';

fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
const prev = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : '';
fs.writeFileSync(memoryPath, prev + entry, 'utf8');
console.log(memoryPath);
