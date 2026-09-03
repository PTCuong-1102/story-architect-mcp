import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { generateId } from '../../utils/fileUtils.js';
import type { PlotHole } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

export function registerPlotHoleTools(server: McpServer, getProject: () => StoryProject): void {

  // ─── story_log_plot_hole ───
  server.registerTool(
    'story_log_plot_hole',
    {
      title: 'Log Plot Hole',
      description: 'Ghi nhận một điểm mâu thuẫn hoặc lỗ hổng cốt truyện mới vào hệ thống theo dõi.',
      inputSchema: z.object({
        title: z.string().min(1).max(300).describe('Tên ngắn gọn cho plot hole'),
        description: z.string().min(1).describe('Mô tả chi tiết mâu thuẫn'),
        severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium')
          .describe('Mức độ nghiêm trọng'),
        chapters: z.array(z.string()).optional()
          .describe('Danh sách các chương liên quan (ví dụ: ["arc_01/ch_001", "arc_01/ch_003"])'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const data = await project.getPlotHoles();

      const newHole: PlotHole = {
        id: generateId(),
        title: params.title,
        description: params.description,
        severity: params.severity,
        chapters: params.chapters || [],
        createdAt: new Date().toISOString(),
        status: 'open',
      };

      data.holes.push(newHole);
      await project.savePlotHoles(data);

      const openCount = data.holes.filter(h => h.status === 'open').length;

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Plot hole đã được ghi nhận!

🆔 ID: ${newHole.id}
📝 Tiêu đề: ${newHole.title}
⚠️  Mức độ: ${newHole.severity}
📚 Chương liên quan: ${newHole.chapters.join(', ') || 'N/A'}

📊 Tổng plot holes đang mở: ${openCount}`,
        }],
      };
    }
  );

  // ─── story_resolve_plot_hole ───
  server.registerTool(
    'story_resolve_plot_hole',
    {
      title: 'Resolve Plot Hole',
      description: 'Đánh dấu một plot hole đã được giải quyết hoặc won\'t-fix.',
      inputSchema: z.object({
        id: z.string().describe('ID của plot hole cần resolve'),
        resolution: z.string().describe('Giải thích cách đã giải quyết'),
        status: z.enum(['resolved', 'wont-fix']).default('resolved')
          .describe('Trạng thái mới'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo.');
      }

      const data = await project.getPlotHoles();
      const hole = data.holes.find(h => h.id === params.id);

      if (!hole) {
        const available = data.holes
          .filter(h => h.status === 'open')
          .map(h => `  - ${h.id}: ${h.title} [${h.severity}]`)
          .join('\n');
        return errResult(`❌ Không tìm thấy plot hole: ${params.id}\n\n📋 Các plot hole đang mở:\n${available || '  _Không có._'}`);
      }

      hole.status = params.status;
      hole.resolution = params.resolution;
      hole.resolvedAt = new Date().toISOString();

      await project.savePlotHoles(data);

      const openCount = data.holes.filter(h => h.status === 'open').length;

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Plot hole đã được ${params.status === 'resolved' ? 'giải quyết' : 'đánh dấu won\'t-fix'}!

🆔 ID: ${hole.id}
📝 Tiêu đề: ${hole.title}
💡 Giải pháp: ${params.resolution}

📊 Còn lại ${openCount} plot holes đang mở.`,
        }],
      };
    }
  );
}
