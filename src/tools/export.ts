import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../server/StoryProject.js';

export function registerExportTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_export',
    {
      title: 'Export Story Manuscript',
      description: 'Đóng gói và xuất bản toàn bộ tác phẩm thành file markdown hoàn chỉnh kèm mục lục và thông tin tác giả.',
      inputSchema: z.object({
        format: z.enum(['markdown_single']).default('markdown_single')
          .describe('Định dạng xuất: markdown_single (hiện tại hỗ trợ)'),
        includeOutline: z.boolean().default(false)
          .describe('Bao gồm dàn ý trong file xuất'),
        outputPath: z.string().optional()
          .describe('Đường dẫn file xuất (mặc định: <project>/export/<name>.md)'),
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
      const status = await project.getStatus();
      const arcs = await project.listArcs();

      const parts: string[] = [];

      parts.push(`# ${config.name}\n`);
      if (config.author) parts.push(`**Tác giả**: ${config.author}\n`);
      parts.push(`**Thể loại**: ${config.genre.join(', ') || 'N/A'}\n`);
      parts.push(`**Tổng số từ**: ${status.totalWordCount.toLocaleString()}\n`);
      parts.push('---\n');

      parts.push('## Mục lục\n');
      for (const arc of arcs) {
        const chapters = await project.listChaptersInArc(arc);
        parts.push(`### ${arc.replace(/_/g, ' ').toUpperCase()}\n`);
        for (const ch of chapters) {
          const displayName = ch.replace(/_/g, ' ').replace(/^ch /, 'Chương ');
          parts.push(`- [${displayName}](#${ch})\n`);
        }
      }
      parts.push('\n---\n');

      for (const arc of arcs) {
        parts.push(`\n# ${arc.replace(/_/g, ' ').toUpperCase()}\n`);
        const chapters = await project.listChaptersInArc(arc);

        for (const ch of chapters) {
          const content = await project.getChapterContent(arc, ch);
          if (content) {
            parts.push(`\n## ${ch.replace(/_/g, ' ').replace(/^ch /, 'Chương ')} {#${ch}}\n`);
            parts.push(content);
            parts.push('\n');
          }
        }
      }

      const fullDocument = parts.join('\n');

      const outputDir = path.join(project.projectPath, 'export');
      await fs.mkdir(outputDir, { recursive: true });
      const fileName = config.name.toLowerCase().replace(/\s+/g, '_') + '.md';
      const outputPath = params.outputPath || path.join(outputDir, fileName);

      await fs.writeFile(outputPath, fullDocument, 'utf-8');

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Đã xuất bản thảo thành công!

📄 File: ${outputPath}
📊 Thống kê:
- Tổng số từ: ${status.totalWordCount.toLocaleString()}
- Số arc: ${arcs.length}
- Số chương: ${status.chapterCount}
- Định dạng: ${params.format}`,
        }],
      };
    }
  );
}
