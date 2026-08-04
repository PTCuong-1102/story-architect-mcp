import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';

export function registerStatsTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_stats',
    {
      title: 'Story Statistics',
      description: 'Thống kê tổng số từ (word count), tốc độ viết (writing velocity), phần trăm hoàn thành mục tiêu, và chi tiết từng arc/chương.',
      inputSchema: z.object({}),
    },
    async () => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return {
          content: [{ type: 'text' as const, text: '❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.' }],
        };
      }

      const config = await project.getConfig();
      const status = await project.getStatus();
      const holes = await project.getPlotHoles();
      const foreshadowing = await project.getForeshadowing();
      const relationships = await project.getRelationships();

      const arcs = await project.listArcs();
      const arcDetails: string[] = [];

      for (const arc of arcs) {
        const chapters = await project.listChaptersInArc(arc);
        let arcWordCount = 0;
        const chapterDetails: string[] = [];

        for (const ch of chapters) {
          const content = await project.getChapterContent(arc, ch);
          const { countWords } = await import('../../utils/wordCount.js');
          const words = content ? countWords(content) : 0;
          arcWordCount += words;
          chapterDetails.push(`    ${ch}: ${words.toLocaleString()} từ`);
        }

        arcDetails.push(
          `  📖 ${arc} (${chapters.length} chương, ${arcWordCount.toLocaleString()} từ)\n${chapterDetails.join('\n')}`
        );
      }

      const progress = status.completionPercent;
      const barLength = 20;
      const filled = Math.round((progress / 100) * barLength);
      const progressBar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

      const plantedCount = foreshadowing.items.filter(i => i.status === 'planted').length;
      const firedCount = foreshadowing.items.filter(i => i.status === 'fired').length;

      const openHoles = holes.holes.filter(h => h.status === 'open').length;
      const resolvedHoles = holes.holes.filter(h => h.status === 'resolved').length;

      return {
        content: [{
          type: 'text' as const,
          text: `📊 Thống kê dự án: ${config.name}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Tiến độ:
  ${progressBar} ${progress}%
  ${status.totalWordCount.toLocaleString()} / ${config.targetWordCount.toLocaleString()} từ

📚 Cấu trúc:
  Arcs: ${status.arcCount}
  Chương: ${status.chapterCount}
  Nhân vật: ${status.characterCount}

${arcDetails.length > 0 ? '📖 Chi tiết:\n' + arcDetails.join('\n\n') : '  _Chưa có nội dung._'}

🎯 Chekhov's Gun:
  🌱 Đã cài cắm (chưa giải gỡ): ${plantedCount}
  🎆 Đã giải gỡ: ${firedCount}

🕳️  Plot Holes:
  🔴 Đang mở: ${openHoles}
  ✅ Đã giải quyết: ${resolvedHoles}

👥 Quan hệ nhân vật: ${relationships.relationships.length}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        }],
      };
    }
  );
}
