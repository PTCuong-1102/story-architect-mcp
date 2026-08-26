import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import { StoryProject } from '../server/StoryProject.js';
import { readTextFile, isSafePathSegment } from '../utils/fileUtils.js';
import { errResult } from '../utils/mcpResults.js';

export function registerGenerateWritingPromptTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_generate_writing_prompt',
    {
      title: 'Generate Optimized Writing Prompt',
      description: 'Đọc chương trước + Dàn ý + Lore + Style Guide + Chekhov Guns → Tạo System Prompt gọt giũa hoàn hảo cho lượt viết tiếp theo.',
      inputSchema: z.object({
        arc: z.string().describe('Arc ID (ví dụ: arc_01)'),
        chapter: z.string().describe('Chapter ID (ví dụ: ch_003)'),
        strategy: z.enum(['continue', 'rewrite', 'expand']).default('continue')
          .describe('Chiến lược viết: continue (viết tiếp), rewrite (viết lại), expand (mở rộng)'),
      }),
    },
    async (params) => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const config = await project.getConfig();
      const styleGuide = await project.getStyleGuide();
      const foreshadowing = await project.getForeshadowing();

      // Read previous chapter content
      const chapters = await project.listChaptersInArc(params.arc);
      let previousContent = '';
      if (chapters.length > 0) {
        const lastCh = chapters[chapters.length - 1];
        const content = await project.getChapterContent(params.arc, lastCh);
        if (content) {
          previousContent = content.length > 1500 ? '...\n' + content.slice(-1500) : content;
        }
      }

      // Read outline
      const outlinePath = path.join(project.outlineDir, params.arc, `${params.chapter}_outline.md`);
      const outline = isSafePathSegment(params.arc) && isSafePathSegment(params.chapter)
        ? await readTextFile(outlinePath)
        : null;
      const outlineText = outline || '_Chưa có dàn ý cho chương này._';

      // Unfired setups
      const unfired = foreshadowing.items
        .filter(i => i.status === 'planted')
        .map(i => `- [${i.importance}] ${i.setup}`)
        .join('\n');

      let strategyInstruction = '';
      switch (params.strategy) {
        case 'continue':
          strategyInstruction = 'Viết nối tiếp mượt mà ngay từ dòng cuối của chương trước.';
          break;
        case 'rewrite':
          strategyInstruction = 'Viết lại chương này với góc nhìn sâu sắc hơn, tăng độ căng thẳng (tension).';
          break;
        case 'expand':
          strategyInstruction = 'Mở rộng chi tiết miêu tả bối cảnh và nội tâm nhân vật.';
          break;
      }

      const promptText = `System Prompt Sáng Tác Tiểu Thuyết:

[BỐI CẢNH DỰ ÁN]
Tên tác phẩm: ${config.name}
Tác giả: ${config.author || 'N/A'}
Thể loại: ${config.genre.join(', ') || 'N/A'}
Ngôi kể (POV): ${config.pov}
Thì: ${config.tense === 'past' ? 'Quá khứ' : 'Hiện tại'}

[QUY CHUẨN GIỌNG VĂN]
${styleGuide.voiceDescription || '_Giữ văn phong mượt mà, cuốn hút._'}
${styleGuide.avoidWords.length > 0 ? `Từ cần tránh: ${styleGuide.avoidWords.join(', ')}` : ''}

[CHI TIẾT CÀI CẮM CẦN GIẢI GỠ (CHEKHOV GUNS)]
${unfired || '_Không có._'}

[ĐOẠN VĂN TRƯỚC ĐÓ]
${previousContent || '_Chương đầu tiên._'}

[DÀN Ý CHƯƠNG MỚI: ${params.chapter}]
${outlineText}

[YÊU CẦU THỰC THI]
Chiến lược: ${params.strategy.toUpperCase()} (${strategyInstruction})
Hãy tạo nên một chương văn học đạt tiêu chuẩn xuất bản!`;

      return {
        content: [{
          type: 'text' as const,
          text: promptText,
        }],
      };
    }
  );
}
