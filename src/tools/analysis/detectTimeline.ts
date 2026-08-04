import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { TimelineEvent } from '../../server/types.js';

/**
 * Sinh mã Mermaid Gantt Chart từ danh sách sự kiện timeline.
 */
function generateMermaidGantt(events: TimelineEvent[]): string {
  if (events.length === 0) return '```mermaid\ngantt\n    title Timeline Truyện\n    dateFormat YYYY-MM-DD\n    section Chưa có sự kiện\n    Khởi đầu : milestone, m1, 2026-01-01, 1d\n```';

  const lines: string[] = [
    '```mermaid',
    'gantt',
    '    title Tiến trình Sự kiện (Timeline)',
    '    dateFormat YYYY-MM-DD',
    '    axisFormat %d/%m',
    '    section Sự kiện chính',
  ];

  // Sắp xếp theo relativeOrder
  const sorted = [...events].sort((a, b) => a.relativeOrder - b.relativeOrder);

  let startDate = new Date('2026-01-01');

  sorted.forEach((e, idx) => {
    const idStr = `evt_${idx + 1}`;
    const dateStr = startDate.toISOString().split('T')[0];
    const duration = '2d';
    const label = e.label.replace(/[:#]/g, '');

    if (idx === 0) {
      lines.push(`    ${label} :active, ${idStr}, ${dateStr}, ${duration}`);
    } else {
      const prevId = `evt_${idx}`;
      lines.push(`    ${label} : ${idStr}, after ${prevId}, ${duration}`);
    }

    // Tăng startDate lên 2 ngày
    startDate = new Date(startDate.getTime() + 2 * 24 * 60 * 60 * 1000);
  });

  lines.push('```');
  return lines.join('\n');
}

export function registerDetectTimelineTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_detect_timeline_conflicts',
    {
      title: 'Detect Timeline Conflicts & Generate Mermaid Gantt',
      description: 'Phân tích các mốc thời gian tuyệt đối & tương đối, sự kiện để phát hiện mâu thuẫn timeline. Xuất Mermaid Gantt Chart trực quan hóa.',
      inputSchema: z.object({
        addEvent: z.object({
          label: z.string().describe('Tên sự kiện'),
          description: z.string().optional(),
          chapter: z.string().optional().describe('Chương diễn ra sự kiện'),
          relativeOrder: z.number().default(0),
        }).optional().describe('Thêm sự kiện timeline mới (nếu cần)'),
      }),
    },
    async (params) => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return {
          content: [{ type: 'text' as const, text: '❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.' }],
        };
      }

      const timeline = await project.getTimeline();

      // Thêm sự kiện nếu truyền vào
      if (params.addEvent) {
        timeline.events.push({
          id: 'evt_' + Date.now().toString(36),
          label: params.addEvent.label,
          description: params.addEvent.description || '',
          chapter: params.addEvent.chapter,
          relativeOrder: params.addEvent.relativeOrder,
          characters: [],
        });
        await project.saveTimeline(timeline);
      }

      const events = timeline.events;

      // Detect conflicts (ví dụ: thứ tự tương đối bị trùng hoặc ngược với thứ tự chương)
      const conflicts: string[] = [];

      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          const evA = events[i];
          const evB = events[j];

          // Trùng relativeOrder
          if (evA.relativeOrder === evB.relativeOrder && evA.relativeOrder !== 0) {
            conflicts.push(`⚠️ Sự kiện "${evA.label}" và "${evB.label}" có cùng mốc thời gian tương đối (${evA.relativeOrder}).`);
          }

          // Thứ tự chương ngược với relativeOrder
          if (evA.chapter && evB.chapter && evA.chapter !== evB.chapter) {
            if (evA.chapter > evB.chapter && evA.relativeOrder < evB.relativeOrder) {
              conflicts.push(`⚠️ Mâu thuẫn thứ tự: "${evA.label}" (${evA.chapter}) xảy ra trước "${evB.label}" (${evB.chapter}) theo mốc thời gian, nhưng lại ở chương muộn hơn.`);
            }
          }
        }
      }

      const mermaidDiagram = generateMermaidGantt(events);

      return {
        content: [{
          type: 'text' as const,
          text: `📊 Phân tích Timeline & Mermaid Gantt Chart

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Tổng số sự kiện: ${events.length}
${conflicts.length > 0 ? '❌ Mâu thuẫn phát hiện:\n' + conflicts.join('\n') : '✅ Không phát hiện mâu thuẫn thời gian nào!'}

🎨 Trực quan hóa (Mermaid Gantt):
${mermaidDiagram}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        }],
      };
    }
  );
}
