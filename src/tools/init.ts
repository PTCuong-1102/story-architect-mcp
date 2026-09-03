import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../server/StoryProject.js';
import { requireProject, isToolError } from '../utils/mcpResults.js';

export function registerInitTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_init',
    {
      title: 'Initialize Story Project',
      description: 'Khởi tạo dự án tiểu thuyết mới: tạo cấu trúc thư mục chuẩn (.story/, bible/, manuscript/, outline/...) và metadata ban đầu.',
      inputSchema: z.object({
        name: z.string().min(1).max(200).describe('Tên dự án tiểu thuyết'),
        author: z.string().optional().describe('Tên tác giả'),
        genre: z.array(z.string()).optional().describe('Thể loại: Fantasy, Romance, Sci-Fi...'),
        pov: z.enum(['first', 'third-limited', 'third-omniscient', 'second']).optional().describe('Ngôi kể'),
        tense: z.enum(['past', 'present']).optional().describe('Thì: past hoặc present'),
        language: z.string().optional().describe('Ngôn ngữ chính (vi, en...)'),
        targetWordCount: z.number().optional().describe('Mục tiêu số từ (mặc định 80000)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (await project.isInitialized()) {
        return {
          content: [{
            type: 'text' as const,
            text: `⚠️ Dự án đã được khởi tạo trước đó tại: ${project.projectPath}\nĐể cập nhật cấu hình, hãy chỉnh sửa trực tiếp .story/config.json.`,
          }],
        };
      }

      await project.initializeProject({
        name: params.name,
        author: params.author,
        genre: params.genre,
        pov: params.pov,
        tense: params.tense,
        language: params.language,
        targetWordCount: params.targetWordCount,
      });

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Dự án "${params.name}" đã được khởi tạo thành công!

📁 Cấu trúc thư mục:
├── .cbm/               ← Cache & Knowledge Graph index
├── .story/            ← Metadata & state
│   ├── config.json
│   ├── status.json
│   ├── timeline.json
│   ├── unresolved_holes.json
│   ├── foreshadowing.json
│   ├── relationships.json
│   ├── style_guide.json
│   └── snapshots/
├── bible/
│   ├── characters/    ← Hồ sơ nhân vật
│   ├── world/         ← Worldbuilding
│   └── subplots/      ← Tuyến truyện phụ
├── manuscript/
│   └── arc_01/        ← Bản thảo chính
├── drafts_raw/        ← Nháp
└── outline/
    ├── synopsis.md    ← Tóm tắt tổng thể
    ├── themes.md      ← Chủ đề & Motif
    └── arc_01/        ← Dàn ý từng Arc

📝 Cấu hình:
- POV: ${params.pov || 'third-limited'}
- Thì: ${params.tense || 'past'}
- Ngôn ngữ: ${params.language || 'vi'}
- Mục tiêu: ${params.targetWordCount || 80000} từ

🎯 Bước tiếp theo:
1. Viết synopsis.md (tóm tắt cốt truyện)
2. Tạo hồ sơ nhân vật trong bible/characters/
3. Bắt đầu viết chương đầu tiên: manuscript/arc_01/ch_001.md`,
        }],
      };
    }
  );
}
