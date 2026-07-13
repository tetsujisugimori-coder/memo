const fs = require('fs');
const path = require('path');

const memoryPath = 'C:\\Users\\tetsu\\.codex\\automations\\ai\\memory.md';
const now = '2026-06-03';
const runTime = '2026-06-03 06:02 JST';
const entry = [
  `- ${now}: 最新AI朝刊を作成。`,
  `  - 除外した既出テーマ: Anthropic大型調達、Claude Opus 4.8、Gemini常時稼働型アプリ更新、OpenAIのコンテンツ真正性対策、OpenAIの選挙安全策、Microsoft Copilot Studioのcomputer-using agents GA、NVIDIA Alpamayo 2 Super、NVIDIA Isaac GR00T Reference Humanoid Robot、OpenAI Frontier Governance Framework、OpenAI第三者評価プレイブック、Google Gemini API Managed Agents、AnthropicのIPO非公開申請、Google Gemini Daily BriefとSpark、MicrosoftのCAISI/AISI評価連携、MetaのIncognito Chat。`,
  `  - 今回の主要5件: OpenAIの役割別Codex拡張、Anthropic Project Glasswing拡大、Mayo ClinicとMicrosoftの医療特化フロンティアAI、NVIDIA Jetsonの物理エージェント基盤、Google Gemini for Science。`,
  `  - 生成ファイル: ${path.resolve(__dirname, 'ai-news-2026-06-03.json')}`,
  `  - IMPORT保存結果: C:\\Users\\tetsu\\Documents\\Codex\\メモ帳\\IMPORT は存在確認済み。ai-news-2026-06-03.json / ai-news-latest.json へのコピーはアクセス拒否で失敗。`,
  `  - 実行時刻: ${runTime}`
].join('\n') + '\n';

fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
const prev = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : '';
fs.writeFileSync(memoryPath, prev + entry, 'utf8');
console.log(memoryPath);
