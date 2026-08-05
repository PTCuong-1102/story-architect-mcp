import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../server/StoryProject.js';

/**
 * Đăng ký tools quản lý dự án: set/get project path runtime.
 *
 * @param setProject - Hàm thay đổi dự án đích, trả về StoryProject mới
 * @param getProject - Hàm lấy dự án hiện tại (có thể throw nếu chưa thiết lập)
 * @param getCurrentPath - Hàm lấy đường dẫn hiện tại (null nếu chưa thiết lập)
 */
export function registerProjectManagerTools(
  server: McpServer,
  setProject: (projectPath: string) => StoryProject,
  getProject: () => StoryProject | null,
  getCurrentPath: () => string | null,
): void {

  // ─── story_set_project ───
  server.registerTool(
    'story_set_project',
    {
      title: 'Set Story Project Path',
      description: 'Thiết lập hoặc chuyển đổi dự án tiểu thuyết đích. Cho phép thay đổi dự án mà không cần restart MCP server.',
      inputSchema: z.object({
        projectPath: z.string().describe('Đường dẫn đến thư mục dự án tiểu thuyết (tuyệt đối hoặc tương đối so với cwd)'),
      }),
    },
    async (params) => {
      const resolvedPath = path.resolve(params.projectPath);

      // Validate thư mục tồn tại
      try {
        const stat = await fs.stat(resolvedPath);
        if (!stat.isDirectory()) {
          return {
            content: [{
              type: 'text' as const,
              text: `❌ Đường dẫn không phải là thư mục: ${resolvedPath}`,
            }],
          };
        }
      } catch {
        return {
          content: [{
            type: 'text' as const,
            text: `❌ Không tìm thấy thư mục: ${resolvedPath}\n\n💡 Hãy kiểm tra lại đường dẫn hoặc tạo thư mục trước.`,
          }],
        };
      }

      const previousPath = getCurrentPath();
      const project = setProject(resolvedPath);
      const isInitialized = await project.isInitialized();

      let statusInfo = '';
      if (isInitialized) {
        try {
          const config = await project.getConfig();
          const status = await project.getStatus();
          statusInfo = `
📖 Tên truyện: ${config.name}
✍️  Tác giả: ${config.author || '_chưa thiết lập_'}
📚 Thể loại: ${config.genre.length > 0 ? config.genre.join(', ') : '_chưa thiết lập_'}
📝 Số từ: ${status.totalWordCount.toLocaleString()}
📊 Chương: ${status.chapterCount} | Arc: ${status.arcCount} | Nhân vật: ${status.characterCount}
🎯 Tiến độ: ${status.completionPercent}%`;
        } catch {
          statusInfo = '\n⚠️ Không thể đọc metadata dự án.';
        }
      }

      const switchInfo = previousPath
        ? `\n🔄 Đã chuyển từ: ${previousPath}`
        : '';

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Đã thiết lập dự án: ${resolvedPath}
${switchInfo}

📁 Trạng thái: ${isInitialized ? '✅ Đã khởi tạo' : '⚠️ Chưa khởi tạo — hãy gọi `story_init` để thiết lập'}
${statusInfo}`,
        }],
      };
    }
  );

  // ─── story_get_project_info ───
  server.registerTool(
    'story_get_project_info',
    {
      title: 'Get Current Project Info',
      description: 'Xem thông tin dự án tiểu thuyết hiện tại đang được trỏ đến.',
      inputSchema: z.object({}),
    },
    async () => {
      const currentPath = getCurrentPath();

      if (!currentPath) {
        return {
          content: [{
            type: 'text' as const,
            text: `⚠️ Chưa thiết lập dự án nào.

💡 Hãy gọi \`story_set_project\` với đường dẫn đến thư mục dự án tiểu thuyết.

Ví dụ:
  story_set_project({ projectPath: "/path/to/my-novel" })`,
          }],
        };
      }

      const project = getProject();
      if (!project) {
        return {
          content: [{
            type: 'text' as const,
            text: `❌ Lỗi nội bộ: project path đã set nhưng không tạo được instance.`,
          }],
        };
      }

      const isInitialized = await project.isInitialized();

      if (!isInitialized) {
        return {
          content: [{
            type: 'text' as const,
            text: `📁 Dự án hiện tại: ${currentPath}
📋 Trạng thái: ⚠️ Chưa khởi tạo

💡 Gọi \`story_init\` để thiết lập cấu trúc dự án chuẩn.`,
          }],
        };
      }

      try {
        const config = await project.getConfig();
        const status = await project.getStatus();
        const holes = await project.getPlotHoles();
        const foreshadowing = await project.getForeshadowing();

        const openHoles = holes.holes.filter(h => h.status === 'open').length;
        const unfiredSetups = foreshadowing.items.filter(i => i.status === 'planted').length;

        return {
          content: [{
            type: 'text' as const,
            text: `📁 Dự án hiện tại: ${currentPath}
📋 Trạng thái: ✅ Đã khởi tạo

📖 Tên truyện: ${config.name}
✍️  Tác giả: ${config.author || '_chưa thiết lập_'}
📚 Thể loại: ${config.genre.length > 0 ? config.genre.join(', ') : '_chưa thiết lập_'}
🗣️  POV: ${config.pov} | Thì: ${config.tense === 'past' ? 'Quá khứ' : 'Hiện tại'}
🌐 Ngôn ngữ: ${config.language}

📝 Số từ: ${status.totalWordCount.toLocaleString()} / ${config.targetWordCount.toLocaleString()}
📊 Chương: ${status.chapterCount} | Arc: ${status.arcCount} | Nhân vật: ${status.characterCount}
🎯 Tiến độ: ${status.completionPercent}%

🐛 Plot holes mở: ${openHoles}
🔫 Chekhov's guns chưa bắn: ${unfiredSetups}`,
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: `📁 Dự án hiện tại: ${currentPath}
⚠️ Đã khởi tạo nhưng không thể đọc metadata: ${err instanceof Error ? err.message : String(err)}`,
          }],
        };
      }
    }
  );
}
