import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { TimelineEvent } from '../../server/types.js';
import { errResult } from '../../utils/mcpResults.js';

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
 * Sinh mã Mermaid Flowchart từ danh sách sự kiện timeline.
 * Ưu tiên absoluteDate khi có; sắp xếp theo relativeOrder.
 */
function generateMermaidTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) {
    return '```mermaid\nflowchart LR\n    Start["Chưa có sự kiện timeline"]\n```';
  }

  const lines: string[] = [
    '```mermaid',
    'flowchart LR',
  ];

  // Sắp xếp theo relativeOrder
  const sorted = [...events].sort((a, b) => a.relativeOrder - b.relativeOrder);

  sorted.forEach((e, idx) => {
    const idStr = `evt_${idx + 1}`;
    const cleanLabel = e.label.replace(/["\n]/g, "'");
    const dateStr = e.absoluteDate ? `📅 ${e.absoluteDate}` : `Thứ tự #${e.relativeOrder}`;
    const chStr = e.chapter ? `<br/>📖 ${e.chapter}` : '';
    lines.push(`    ${idStr}["<b>${cleanLabel}</b><br/>${dateStr}${chStr}"]`);

    if (idx > 0) {
      const prevId = `evt_${idx}`;
      lines.push(`    ${prevId} --> ${idStr}`);
    }
  });

  lines.push('```');
  return lines.join('\n');
}

export function registerDetectTimelineTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_detect_timeline_conflicts',
    {
      title: 'Detect Timeline Conflicts & Generate Mermaid Timeline',
      description: 'Phân tích các mốc thời gian tuyệt đối & tương đối, sự kiện để phát hiện mâu thuẫn timeline. Xuất Mermaid Flowchart trực quan hóa.',
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
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
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

      const mermaidDiagram = generateMermaidTimeline(events);

      return {
        content: [{
          type: 'text' as const,
          text: `📊 Phân tích Timeline & Mermaid Flowchart
 
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 
 📅 Tổng số sự kiện: ${events.length}
 ${conflicts.length > 0 ? '❌ Mâu thuẫn phát hiện:\n' + conflicts.join('\n') : '✅ Không phát hiện mâu thuẫn thời gian nào!'}
 
 🎨 Trực quan hóa (Mermaid Flowchart):
 ${mermaidDiagram}
 
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        }],
      };
    }
  );
}
