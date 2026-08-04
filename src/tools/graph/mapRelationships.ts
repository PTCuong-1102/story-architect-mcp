import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { Relationship } from '../../server/types.js';

export function registerMapRelationshipsTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_map_relationships',
    {
      title: 'Map Character Relationships Graph',
      description: 'Phân tích bản thảo và tự động cập nhật Đồ thị quan hệ nhân vật vào .story/relationships.json.',
      inputSchema: z.object({
        source: z.string().describe('Nhân vật A'),
        target: z.string().describe('Nhân vật B'),
        type: z.enum([
          'ally', 'enemy', 'friend', 'lover', 'rival',
          'family', 'mentor', 'student', 'stranger', 'other'
        ]).describe('Loại mối quan hệ'),
        description: z.string().default('').describe('Mô tả mối quan hệ'),
        chapter: z.string().optional().describe('Chương diễn ra biến động quan hệ'),
      }),
    },
    async (params) => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return {
          content: [{ type: 'text' as const, text: '❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.' }],
        };
      }

      const data = await project.getRelationships();

      // Tìm mối quan hệ xem đã tồn tại chưa
      let rel = data.relationships.find(
        r => (r.source.toLowerCase() === params.source.toLowerCase() && r.target.toLowerCase() === params.target.toLowerCase()) ||
             (r.source.toLowerCase() === params.target.toLowerCase() && r.target.toLowerCase() === params.source.toLowerCase())
      );

      if (rel) {
        // Cập nhật quan hệ hiện có
        const oldType = rel.type;
        rel.type = params.type;
        if (params.description) rel.description = params.description;

        if (params.chapter) {
          rel.evolution.push({
            chapter: params.chapter,
            change: `Đổi quan hệ từ ${oldType} sang ${params.type}: ${params.description || ''}`,
            newType: params.type,
          });
        }
      } else {
        // Tạo quan hệ mới
        const newRel: Relationship = {
          source: params.source,
          target: params.target,
          type: params.type,
          description: params.description || '',
          startChapter: params.chapter,
          evolution: params.chapter ? [{
            chapter: params.chapter,
            change: `Khởi tạo mối quan hệ: ${params.type}`,
            newType: params.type,
          }] : [],
        };
        data.relationships.push(newRel);
      }

      await project.saveRelationships(data);

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Đã cập nhật đồ thị quan hệ nhân vật!

👥 ${params.source} ↔ ${params.target}
🤝 Mối quan hệ: ${params.type}
📝 Mô tả: ${params.description || 'N/A'}
${params.chapter ? `📖 Ghi nhận tại chương: ${params.chapter}` : ''}

📊 Tổng số mối quan hệ trong đồ thị: ${data.relationships.length}`,
        }],
      };
    }
  );
}
