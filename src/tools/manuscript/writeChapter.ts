import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { createSnapshot } from '../rescue/snapshot.js';
import { countWords } from '../../utils/wordCount.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

export function registerManuscriptAuthoringTools(
  server: McpServer,
  getProject: () => StoryProject
): void {

  // ─── story_write_chapter ───
  server.registerTool(
    'story_write_chapter',
    {
      title: 'Write or Update Chapter Draft',
      description: 'Lưu hoặc cập nhật nội dung chương truyện vào manuscript/<arc>/<chapter>.md. Tự động snapshot backup an toàn nếu sửa chương cũ và ghi nhận tiến độ viết.',
      inputSchema: z.object({
        arc: z.string().describe('Tên Arc (ví dụ: "arc_01")'),
        chapter: z.string().describe('Tên Chapter (ví dụ: "ch_001")'),
        content: z.string().describe('Nội dung văn bản chương (Markdown)'),
        title: z.string().optional().describe('Tiêu đề chương (ví dụ: "Khởi Đầu Định Mệnh")'),
        autoSnapshot: z.boolean().default(true).describe('Tự động tạo snapshot backup trước khi ghi đè chương đã có'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;
      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const existingContent = await project.getChapterContent(params.arc, params.chapter);
      let snapshotNote = '';

      // Tự động tạo snapshot nếu file đã có nội dung và autoSnapshot = true
      if (existingContent && params.autoSnapshot) {
        try {
          const snapshot = await createSnapshot(
            project,
            'pre-chapter-write',
            `Backup trước khi ghi đè ${params.arc}/${params.chapter}`
          );
          snapshotNote = `\n📸 Đã tự động tạo snapshot an toàn: \`${snapshot.id}\``;
        } catch {
          // Bỏ qua lỗi snapshot nếu có
        }
      }

      try {
        const result = await project.writeChapter(
          params.arc,
          params.chapter,
          params.content,
          params.title
        );

        const status = await project.getStatus();

        return {
          content: [{
            type: 'text' as const,
            text: `✅ ${result.isNew ? 'Đã tạo chương mới' : 'Đã cập nhật chương'}: \`${params.arc}/${params.chapter}\`
${snapshotNote}

📊 Thống kê chương:
- Số từ chương này: ${result.wordCount.toLocaleString()} từ
- Tổng số từ toàn bộ tác phẩm: ${status.totalWordCount.toLocaleString()} từ
- Vị trí lưu: \`${result.path}\`

💡 Gợi ý bước tiếp theo:
- Dùng \`story_analyze_pacing\` để kiểm tra nhịp điệu và tỷ lệ thoại/hành động.
- Dùng \`story_extract_entities_to_bible\` để trích xuất thực thể mới vào Bible.`,
          }],
        };
      } catch (err) {
        return errResult(`❌ Lỗi khi ghi chương: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── story_append_scene ───
  server.registerTool(
    'story_append_scene',
    {
      title: 'Append Scene to Chapter',
      description: 'Nối thêm một phân cảnh (scene) vào cuối chương truyện hiện có mà không làm mất nội dung trước đó.',
      inputSchema: z.object({
        arc: z.string().describe('Tên Arc (ví dụ: "arc_01")'),
        chapter: z.string().describe('Tên Chapter (ví dụ: "ch_001")'),
        content: z.string().describe('Nội dung phân cảnh cần nối thêm'),
        sceneHeading: z.string().optional().describe('Tiêu đề phân cảnh (nếu có, ví dụ: "Cuộc Gặp Dưới Mưa")'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;
      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      try {
        const result = await project.appendChapterScene(
          params.arc,
          params.chapter,
          params.content,
          params.sceneHeading
        );

        const status = await project.getStatus();

        return {
          content: [{
            type: 'text' as const,
            text: `✅ Đã nối thêm phân cảnh vào: \`${params.arc}/${params.chapter}\`

📊 Thống kê:
- Tổng số từ chương sau khi nối: ${result.totalWordCount.toLocaleString()} từ
- Tổng số từ toàn bộ tác phẩm: ${status.totalWordCount.toLocaleString()} từ
- Vị trí lưu: \`${result.path}\``,
          }],
        };
      } catch (err) {
        return errResult(`❌ Lỗi khi nối phân cảnh: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── story_read_chapter ───
  server.registerTool(
    'story_read_chapter',
    {
      title: 'Read Chapter Content & Metadata',
      description: 'Đọc toàn bộ nội dung của một chương truyện, kèm thống kê số từ và danh sách tiêu đề phân cảnh.',
      inputSchema: z.object({
        arc: z.string().describe('Tên Arc (ví dụ: "arc_01")'),
        chapter: z.string().describe('Tên Chapter (ví dụ: "ch_001")'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;
      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const content = await project.getChapterContent(params.arc, params.chapter);
      if (content === null) {
        return errResult(`❌ Không tìm thấy chương \`${params.arc}/${params.chapter}\`.`);
      }

      const wordCount = countWords(content);
      const headings = content
        .split('\n')
        .filter(line => line.startsWith('#'))
        .map(line => line.trim());

      return {
        content: [{
          type: 'text' as const,
          text: `# Bản thảo: ${params.arc} / ${params.chapter} (${wordCount.toLocaleString()} từ)

${headings.length > 0 ? `📑 Các tiêu đề / phân cảnh:\n${headings.map(h => '  - ' + h).join('\n')}\n\n---\n` : ''}
${content}`,
        }],
      };
    }
  );
}
