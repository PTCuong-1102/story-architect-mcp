import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { TimelineEvent } from '../../server/types.js';

/** Trích các thành phần số từ chuỗi (ví dụ "arc_01/ch_002" → [1, 2]). */
function numericParts(s: string): number[] {
  return (s.toLowerCase().match(/\d+/g) || []).map(Number);
}

/** So sánh hai chuỗi chương theo thứ tự tự nhiên (1 < 2 < 10, arc_1 < arc_2). */
function compareChapter(a: string, b: string): number {
  const pa = numericParts(a);
  const pb = numericParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return a.localeCompare(b);
}

const BASE_DATE = '2026-01-01';
const STEP_MS = 2 * 24 * 60 * 60 * 1000;

function parseAbsoluteDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sinh mã Mermaid Gantt Chart từ danh sách sự kiện timeline.
 * Ưu tiên absoluteDate khi có; nếu không sẽ xếp theo relativeOrder từ BASE_DATE.
 */
function generateMermaidGantt(events: TimelineEvent[]): string {
  if (events.length === 0) {
    return '```mermaid\ngantt\n    title Timeline Truyện\n    dateFormat YYYY-MM-DD\n    section Chưa có sự kiện\n    Khởi đầu : milestone, m1, 2026-01-01, 1d\n```';
  }

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

  let cursor = new Date(BASE_DATE);

  sorted.forEach((e, idx) => {
    const idStr = `evt_${idx + 1}`;
    const label = e.label.replace(/[:#]/g, '');
    const duration = '2d';

    // Nếu có absoluteDate hợp lệ → đặt đúng mốc đó
    const abs = parseAbsoluteDate(e.absoluteDate);

    if (idx === 0 || abs) {
      const dateStr = abs
        ? abs.toISOString().split('T')[0]
        : cursor.toISOString().split('T')[0];
      lines.push(`    ${label} :active, ${idStr}, ${dateStr}, ${duration}`);
    } else {
      const prevId = `evt_${idx}`;
      lines.push(`    ${label} : ${idStr}, after ${prevId}, ${duration}`);
    }

    cursor = new Date(cursor.getTime() + STEP_MS);
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
          absoluteDate: z.string().optional().describe('Mốc thời gian tuyệt đối (YYYY-MM-DD hoặc ISO)'),
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
          absoluteDate: params.addEvent.absoluteDate,
          relativeOrder: params.addEvent.relativeOrder,
          characters: [],
        });
        await project.saveTimeline(timeline);
      }

      const events = timeline.events;

      // Detect conflicts
      const conflicts: string[] = [];

      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          const evA = events[i];
          const evB = events[j];

          // Trùng relativeOrder
          if (evA.relativeOrder === evB.relativeOrder && evA.relativeOrder !== 0) {
            conflicts.push(`⚠️ Sự kiện "${evA.label}" và "${evB.label}" có cùng mốc thời gian tương đối (${evA.relativeOrder}).`);
          }

          // Thứ tự chương ngược với relativeOrder (so sánh tự nhiên)
          if (evA.chapter && evB.chapter && evA.chapter !== evB.chapter) {
            const chapterOrder = compareChapter(evA.chapter, evB.chapter);
            if (chapterOrder > 0 && evA.relativeOrder < evB.relativeOrder) {
              conflicts.push(`⚠️ Mâu thuẫn thứ tự: "${evA.label}" (${evA.chapter}) theo mốc thời gian xảy ra trước "${evB.label}" (${evB.chapter}), nhưng lại nằm ở chương muộn hơn.`);
            }
          }

          // Mâu thuẫn absoluteDate so với relativeOrder
          const absA = parseAbsoluteDate(evA.absoluteDate);
          const absB = parseAbsoluteDate(evB.absoluteDate);
          if (absA && absB) {
            if (absA.getTime() > absB.getTime() && evA.relativeOrder < evB.relativeOrder) {
              conflicts.push(`⚠️ "${evA.label}" (${evA.absoluteDate}) có ngày muộn hơn "${evB.label}" (${evB.absoluteDate}) nhưng thứ tự tương đối lại sớm hơn.`);
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
