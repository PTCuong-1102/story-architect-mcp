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
      const recorded = await project.recordWritingProgress();
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

      // Writing velocity: trung bình số từ viết được mỗi ngày (theo writingLog)
      let velocityPerDay = 0;
      if (recorded.writingLog.length > 0) {
        const totalWritten = recorded.writingLog.reduce((sum, e) => sum + e.wordsWritten, 0);
        const distinctDays = new Set(recorded.writingLog.map(e => e.date)).size;
        velocityPerDay = distinctDays > 0 ? totalWritten / distinctDays : 0;
      }

      // Ngày hoàn thành ước tính dựa trên velocity
      let estimatedCompletion = 'N/A (chưa đủ dữ liệu)';
      const remaining = Math.max(0, config.targetWordCount - status.totalWordCount);
      if (velocityPerDay > 0 && remaining > 0) {
        const daysNeeded = Math.ceil(remaining / velocityPerDay);
        const completionDate = new Date();
        completionDate.setDate(completionDate.getDate() + daysNeeded);
        estimatedCompletion = completionDate.toISOString().slice(0, 10)
          + ` (cần ~${daysNeeded} ngày, ${Math.round(velocityPerDay)} từ/ngày)`;
      } else if (remaining === 0) {
        estimatedCompletion = '✅ Đã đạt mục tiêu!';
      }

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

🚀 Tốc độ viết (velocity): ${Math.round(velocityPerDay)} từ/ngày
📅 Ước tính hoàn thành: ${estimatedCompletion}
${recorded.lastWrittenAt ? `🕐 Lần ghi nhận cuối: ${recorded.lastWrittenAt}` : ''}

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
