import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { countWords } from '../../utils/wordCount.js';

export function registerQueryContextTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_query_context',
    {
      title: 'Query Context Budget',
      description: 'Trích xuất và tổng hợp Context Budget tối ưu nhất (Lore + Character Profiles + Timeline + Foreshadowing + Plot Holes) theo ngân sách token.',
      inputSchema: z.object({
        query: z.string().describe('Chủ đề hoặc từ khóa cần lấy context (ví dụ: "Tiêu Viêm Thanh Vân Sơn")'),
        budgetTokens: z.number().default(2000).describe('Ngân sách token tối đa cho context (mặc định 2000 tokens ~ 1500 từ)'),
      }),
    },
    async (params) => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return {
          content: [{ type: 'text' as const, text: '❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.' }],
        };
      }

      const config = await project.getConfig();
      const styleGuide = await project.getStyleGuide();
      const holes = await project.getPlotHoles();
      const foreshadowing = await project.getForeshadowing();
      const relationships = await project.getRelationships();

      const queryLower = params.query.toLowerCase();

      // Collect matching character profiles
      const characters = await project.listCharacters();
      const matchedCharacters: string[] = [];

      for (const charName of characters) {
        if (queryLower.includes(charName.toLowerCase()) || charName.toLowerCase().includes(queryLower)) {
          const profile = await project.getCharacter(charName);
          if (profile) {
            matchedCharacters.push(`### Nhân vật: ${charName}\n${profile.content}`);
          }
        }
      }

      // Collect matching world entries
      const worldEntries = await project.listWorldEntries();
      const matchedWorld: string[] = [];

      for (const entryName of worldEntries) {
        if (queryLower.includes(entryName.toLowerCase()) || entryName.toLowerCase().includes(queryLower)) {
          const entry = await project.getWorldEntry(entryName);
          if (entry) {
            matchedWorld.push(`### Bối cảnh: ${entryName}\n${entry}`);
          }
        }
      }

      // Unfired Chekhov Guns
      const unfiredGuns = foreshadowing.items
        .filter(i => i.status === 'planted')
        .map(i => `- [${i.importance}] ${i.setup} (cài ở ${i.setupChapter})`)
        .join('\n');

      // Open Plot Holes
      const openHoles = holes.holes
        .filter(h => h.status === 'open')
        .map(h => `- [${h.severity}] ${h.title}: ${h.description}`)
        .join('\n');

      // Assemble context blocks
      const contextBlocks: string[] = [];

      contextBlocks.push(`# Context Budget cho Query: "${params.query}"\n`);
      contextBlocks.push(`## Quy chuẩn dự án\n- Tên truyện: ${config.name}\n- POV: ${config.pov} | Thì: ${config.tense}\n- Phong cách: ${styleGuide.voiceDescription || 'N/A'}\n`);

      if (matchedCharacters.length > 0) {
        contextBlocks.push(`## Hồ sơ nhân vật liên quan\n${matchedCharacters.join('\n\n')}\n`);
      }

      if (matchedWorld.length > 0) {
        contextBlocks.push(`## Thế giới & Bối cảnh liên quan\n${matchedWorld.join('\n\n')}\n`);
      }

      if (unfiredGuns) {
        contextBlocks.push(`## Chekhov's Guns chưa bắn\n${unfiredGuns}\n`);
      }

      if (openHoles) {
        contextBlocks.push(`## Plot Holes đang mở\n${openHoles}\n`);
      }

      let assembledText = contextBlocks.join('\n');
      const estimatedWords = countWords(assembledText);
      const estimatedTokens = Math.round(estimatedWords * 1.33);

      // Truncate if exceeds token budget
      if (estimatedTokens > params.budgetTokens) {
        const maxWords = Math.round(params.budgetTokens / 1.33);
        const words = assembledText.split(/\s+/);
        assembledText = words.slice(0, maxWords).join(' ') + '\n\n_[Đã cắt giảm để vừa ngân sách token]_';
      }

      return {
        content: [{
          type: 'text' as const,
          text: assembledText,
        }],
      };
    }
  );
}
