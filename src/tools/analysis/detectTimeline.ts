import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { TimelineEvent } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

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

function parseAbsoluteDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sinh mã Mermaid Flowchart từ danh sách sự kiện timeline.
 * Hỗ trợ gom nhóm sự kiện theo Subplot / Thread song song.
 */
function generateMermaidTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) {
    return '```mermaid\nflowchart LR\n    Start["Chưa có sự kiện timeline"]\n```';
  }

  const lines: string[] = [
    '```mermaid',
    'flowchart TD',
  ];

  // Gom nhóm theo thread
  const threadMap = new Map<string, TimelineEvent[]>();
  for (const ev of events) {
    const threadName = ev.thread?.trim() || 'Tuyến truyện chính';
    if (!threadMap.has(threadName)) {
      threadMap.set(threadName, []);
    }
    threadMap.get(threadName)!.push(ev);
  }

  let globalIdx = 0;
  const eventNodeIds = new Map<string, string>();

  for (const [threadName, threadEvents] of threadMap) {
    const sorted = [...threadEvents].sort((a, b) => a.relativeOrder - b.relativeOrder);
    const safeSubName = threadName.replace(/["\n\\]/g, "'");

    lines.push(`    subgraph "${safeSubName}"`);

    let prevNodeId: string | null = null;
    for (const e of sorted) {
      globalIdx++;
      const idStr = `evt_${globalIdx}`;
      eventNodeIds.set(e.id, idStr);

      const cleanLabel = e.label.replace(/["\n\\]/g, "'");
      const dateStr = e.absoluteDate ? `📅 ${e.absoluteDate}` : `Thứ tự #${e.relativeOrder}`;
      const chStr = e.chapter ? `<br/>📖 ${e.chapter}` : '';
      const locStr = e.location ? `<br/>📍 ${e.location}` : '';
      const charStr = e.characters.length > 0 ? `<br/>👥 ${e.characters.join(', ')}` : '';

      lines.push(`        ${idStr}["<b>${cleanLabel}</b><br/>${dateStr}${chStr}${locStr}${charStr}"]`);

      if (prevNodeId) {
        lines.push(`        ${prevNodeId} --> ${idStr}`);
      }
      prevNodeId = idStr;
    }

    lines.push('    end');
  }

  lines.push('```');
  return lines.join('\n');
}

export function registerDetectTimelineTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_detect_timeline_conflicts',
    {
      title: 'Detect Timeline Conflicts & Generate Mermaid Parallel Timeline',
      description: 'Phân tích các mốc thời gian tuyệt đối & tương đối, sự kiện, địa điểm và nhân vật để phát hiện mâu thuẫn timeline (như phân thân xuất hiện ở 2 nơi cùng lúc, đảo ngược thứ tự sự kiện). Hỗ trợ các tuyến truyện song song (Threads/Subplots) và xuất biểu đồ Mermaid trực quan.',
      inputSchema: z.object({
        addEvent: z.object({
          label: z.string().describe('Tên sự kiện'),
          description: z.string().optional(),
          chapter: z.string().optional().describe('Chương diễn ra sự kiện'),
          absoluteDate: z.string().optional().describe('Mốc thời gian tuyệt đối (YYYY-MM-DD hoặc in-world date)'),
          relativeOrder: z.number().default(0).describe('Thứ tự tương đối của sự kiện'),
          characters: z.array(z.string()).optional().describe('Danh sách nhân vật tham gia'),
          location: z.string().optional().describe('Địa điểm diễn ra sự kiện'),
          thread: z.string().optional().describe('Tuyến subplot / storyline (ví dụ: "Phe Kháng Chiến", "Cung Đình")'),
        }).optional().describe('Thêm sự kiện timeline mới (nếu cần)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

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
          characters: params.addEvent.characters || [],
          location: params.addEvent.location,
          thread: params.addEvent.thread,
        });
        await project.saveTimeline(timeline);
      }

      const events = timeline.events;

      // Phát hiện mâu thuẫn
      const conflicts: string[] = [];
      const parallelNotes: string[] = [];

      for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
          const evA = events[i];
          const evB = events[j];

          const sameThread = (evA.thread || '') === (evB.thread || '');
          const commonChars = evA.characters.filter(c => evB.characters.map(x => x.toLowerCase()).includes(c.toLowerCase()));

          // 1. Kiểm tra Omnipresence / Phân thân (Cùng 1 nhân vật xuất hiện ở 2 nơi cùng lúc)
          if (commonChars.length > 0) {
            const sameDate = evA.absoluteDate && evB.absoluteDate && evA.absoluteDate === evB.absoluteDate;
            const sameOrder = evA.relativeOrder === evB.relativeOrder && evA.relativeOrder !== 0;

            if ((sameDate || sameOrder) && evA.location && evB.location && evA.location !== evB.location) {
              conflicts.push(
                `🚨 MÂU THUẪN ĐỊA ĐIỂM (Phân Thân): Nhân vật [${commonChars.join(', ')}] tham gia cùng lúc tại "${evA.label}" (📍${evA.location}) và "${evB.label}" (📍${evB.location}).`
              );
            }
          }

          // 2. Mâu thuẫn thứ tự trong cùng 1 Thread hoặc cùng Nhân vật
          if (sameThread || commonChars.length > 0) {
            if (evA.chapter && evB.chapter && evA.chapter !== evB.chapter) {
              const chapterOrder = compareChapter(evA.chapter, evB.chapter);
              if (chapterOrder > 0 && evA.relativeOrder < evB.relativeOrder) {
                conflicts.push(
                  `⚠️ Mâu thuẫn thứ tự chương: "${evA.label}" (${evA.chapter}) xảy ra trước "${evB.label}" (${evB.chapter}) nhưng lại nằm ở chương muộn hơn.`
                );
              }
            }
          }

          // 3. Mâu thuẫn absoluteDate so với relativeOrder
          const absA = parseAbsoluteDate(evA.absoluteDate);
          const absB = parseAbsoluteDate(evB.absoluteDate);
          if (absA && absB) {
            if (absA.getTime() > absB.getTime() && evA.relativeOrder < evB.relativeOrder) {
              conflicts.push(
                `⚠️ Mâu thuẫn ngày: "${evA.label}" (${evA.absoluteDate}) muộn hơn "${evB.label}" (${evB.absoluteDate}) nhưng relativeOrder lại sớm hơn.`
              );
            }
          }

          // Ghi nhận tuyến song song
          if (!sameThread && (evA.relativeOrder === evB.relativeOrder || (absA && absB && absA.getTime() === absB.getTime()))) {
            parallelNotes.push(
              `⚡ Tuyến song song: [${evA.thread || 'Chính'}: "${evA.label}"] ⇆ [${evB.thread || 'Chính'}: "${evB.label}"]`
            );
          }
        }
      }

      const mermaidDiagram = generateMermaidTimeline(events);

      return {
        content: [{
          type: 'text' as const,
          text: `📊 Phân tích Timeline & Tuyến Song Song (Parallel Subplots)
 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 
📅 Tổng số sự kiện: ${events.length}
${conflicts.length > 0 ? '\n❌ Mâu thuẫn phát hiện:\n' + conflicts.join('\n') : '\n✅ Không phát hiện mâu thuẫn thời gian nào!'}
${parallelNotes.length > 0 ? '\n🔀 Sự kiện diễn ra đồng thời (Parallel Threads):\n' + parallelNotes.join('\n') : ''}
 
🎨 Trực quan hóa Timeline (Mermaid Flowchart):
${mermaidDiagram}
 
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        }],
      };
    }
  );
}
