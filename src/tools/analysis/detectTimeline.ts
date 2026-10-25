import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { TimelineEvent } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';
import { compareNatural, generateId } from '../../utils/fileUtils.js';
import { invalidateIndex } from '../../utils/knowledgeGraph.js';

/** So sánh hai chuỗi chương theo thứ tự tự nhiên (dùng chung với StoryProject). */
function compareChapter(a: string, b: string): number {
  return compareNatural(a, b);
}

/**
 * relativeOrder = 0 nghĩa là "chưa đặt" (giá trị default của schema),
 * không phải thứ tự thật. Mọi so sánh thứ tự phải bỏ qua khi gặp 0,
 * nếu không sẽ báo "song song"/"mâu thuẫn" giả hàng loạt.
 */
function hasOrder(e: TimelineEvent): boolean {
  return (e.relativeOrder ?? 0) !== 0;
}

/**
 * v0.5.0 — Parse ngày tuyệt đối, chuẩn hóa ngày-trần (YYYY-MM-DD → local
 * midnight) để "2025-01-01" khớp "2025-01-01 00:00" khi so sánh conflict.
 * In-world date (vd "Năm 340 Cá Huyết") không parse được → trả null,
 * chỉ lưu hiển thị, không tham gia phát hiện mâu thuẫn ngày.
 */
export function parseAbsoluteDate(value?: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    // Thuần ngày → local midnight (khớp dai với "... 00:00")
    d = new Date(`${trimmed}T00:00:00`);
  } else if (/^\d{4}-\d{2}-\d{2} /.test(trimmed)) {
    // "YYYY-MM-DD HH:mm" → local time (new Date hiểu space như UTC quanh region)
    d = new Date(trimmed.replace(' ', 'T'));
  } else {
    d = new Date(trimmed);
  }
  // In-world date (vd "Năm 340 Huyết Nhung") parse lỗi → null: chỉ lưu hiển thị.
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Làm sạch text để nhúng vào node Mermaid `["..."]`.
 * Các ký tự `[]{}"` và `\n` phá vỡ cú pháp flowchart (kể cả trong chuỗi
 * trích dẫn), nên được thay thế; `<br/>`, `<b>`, emoji và `-->`, `|`, `&`
 * trong trích dẫn vẫn an toàn nên giữ nguyên. Cắt ngắn nhãn quá dài
 * để node không phình mất cân đối.
 */
export function sanitizeMermaidLabel(text: string, maxLen = 140): string {
  const cleaned = text
    .replace(/\\/g, '')
    .replace(/"/g, "'")
    .replace(/\r?\n/g, ' ')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 1).trimEnd() + '…' : cleaned;
}

/** ID node ổn định theo event.id (thay vì đếm thứ tự render). */
function stableNodeId(eventId: string, used: Set<string>): string {
  const base = 'n_' + (String(eventId ?? '').replace(/[^A-Za-z0-9_]/g, '') || 'evt');
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}_${n++}`;
  used.add(candidate);
  return candidate;
}

/**
 * Sinh mã Mermaid Flowchart từ danh sách sự kiện timeline.
 * Hỗ trợ gom nhóm sự kiện theo Subplot / Thread song song.
 */
export function generateMermaidTimeline(events: TimelineEvent[]): string {
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

  const usedNodeIds = new Set<string>();
  const eventNodeIds = new Map<string, string>();

  for (const [threadName, threadEvents] of threadMap) {
    // v0.5.0: sort thông minh trong thread — relativeOrder (khi cả hai đặt,
    // ≠0) ra trước; thiếu order thì rớt về parsed date, rồi thứ tự chương tự nhiên.
    const sorted = [...threadEvents].sort((a, b) => {
      const oa = hasOrder(a), ob = hasOrder(b);
      if (oa && ob && a.relativeOrder !== b.relativeOrder) return a.relativeOrder - b.relativeOrder;
      const da = parseAbsoluteDate(a.absoluteDate);
      const dbb = parseAbsoluteDate(b.absoluteDate);
      if (da && dbb && da.getTime() !== dbb.getTime()) return da.getTime() - dbb.getTime();
      if (a.chapter && b.chapter) return compareNatural(a.chapter, b.chapter);
      return a.relativeOrder - b.relativeOrder;
    });
    const safeSubName = sanitizeMermaidLabel(threadName, 60);

    lines.push(`    subgraph "${safeSubName}"`);

    let prevNodeId: string | null = null;
    for (const e of sorted) {
      const idStr = stableNodeId(e.id, usedNodeIds);
      eventNodeIds.set(e.id, idStr);

      const cleanLabel = sanitizeMermaidLabel(e.label);
      const dateStr = e.absoluteDate ? `📅 ${sanitizeMermaidLabel(e.absoluteDate, 40)}` : `Thứ tự #${e.relativeOrder}`;
      const chStr = e.chapter ? `<br/>📖 ${sanitizeMermaidLabel(e.chapter, 60)}` : '';
      const locStr = e.location ? `<br/>📍 ${sanitizeMermaidLabel(e.location, 60)}` : '';
      const charStr = e.characters.length > 0 ? `<br/>👥 ${sanitizeMermaidLabel(e.characters.join(', '), 100)}` : '';

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
          label: z.string().min(1).max(300).describe('Tên sự kiện'),
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

      // Thêm sự kiện nếu truyền vào (mutate-in-lock — không mất event khi
      // hai tool call song song cùng thêm event timeline)
      let addedEventNote = '';
      if (params.addEvent) {
        await project.updateTimeline(cur => ({
          ...cur,
          events: [...cur.events, {
            id: 'evt_' + generateId(),
            label: params.addEvent!.label,
            description: params.addEvent!.description || '',
            chapter: params.addEvent!.chapter,
            absoluteDate: params.addEvent!.absoluteDate,
            relativeOrder: params.addEvent!.relativeOrder,
            characters: params.addEvent!.characters || [],
            location: params.addEvent!.location,
            thread: params.addEvent!.thread,
          }],
        }));
        // Timeline đổi → graph cache cũ
        await invalidateIndex(project);
        // v0.5.0: phản hồi rõ absoluteDate có tham gia conflict detection không
        if (params.addEvent.absoluteDate) {
          const parsed = parseAbsoluteDate(params.addEvent.absoluteDate);
          addedEventNote = parsed
            ? `\n📅 absoluteDate "${params.addEvent.absoluteDate}" (định dạng chuẩn — tham gia phát hiện mâu thuẫn ngày).`
            : `\nℹ️ absoluteDate "${params.addEvent.absoluteDate}" là in-world date (không parse được) — chỉ lưu hiển thị, không tham gia check mâu thuẫn. Dùng ISO (YYYY-MM-DD) nếu muốn check.`;
        }
      }

      const timeline = await project.getTimeline();
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
            // v0.5.0: so ngày qua parsed date (khớp "2025-01-01" ≡ "2025-01-01 00:00")
            const absA0 = parseAbsoluteDate(evA.absoluteDate);
            const absB0 = parseAbsoluteDate(evB.absoluteDate);
            const sameDate = (absA0 && absB0 && absA0.getTime() === absB0.getTime())
              || (!!evA.absoluteDate && evA.absoluteDate === evB.absoluteDate);
            const sameOrder = evA.relativeOrder === evB.relativeOrder && evA.relativeOrder !== 0;

            if ((sameDate || sameOrder) && evA.location && evB.location && evA.location !== evB.location) {
              conflicts.push(
                `🚨 MÂU THUẪN ĐỊA ĐIỂM (Phân Thân): Nhân vật [${commonChars.join(', ')}] tham gia cùng lúc tại "${evA.label}" (📍${evA.location}) và "${evB.label}" (📍${evB.location}).`
              );
            }
          }

          // 2. Mâu thuẫn thứ tự trong cùng 1 Thread hoặc cùng Nhân vật.
          // So dấu hai chiều (trước đây chỉ check một chiều nên miss ~50%
          // tùy thứ tự lưu events); bỏ qua khi order chưa đặt (= 0).
          if ((sameThread || commonChars.length > 0) && hasOrder(evA) && hasOrder(evB)) {
            if (evA.chapter && evB.chapter && evA.chapter !== evB.chapter) {
              const chapterOrder = compareChapter(evA.chapter, evB.chapter);
              const orderDiff = evA.relativeOrder - evB.relativeOrder;
              if (chapterOrder !== 0 && orderDiff !== 0 && Math.sign(chapterOrder) !== Math.sign(orderDiff)) {
                conflicts.push(
                  `⚠️ Mâu thuẫn thứ tự: "${evA.label}" (${evA.chapter}, thứ tự #${evA.relativeOrder}) vs "${evB.label}" (${evB.chapter}, thứ tự #${evB.relativeOrder}) — thứ tự chương và relativeOrder ngược nhau.`
                );
              }
            }
          }

          // 3. Mâu thuẫn absoluteDate so với relativeOrder (hai chiều, bỏ qua order 0)
          const absA = parseAbsoluteDate(evA.absoluteDate);
          const absB = parseAbsoluteDate(evB.absoluteDate);
          if (absA && absB && hasOrder(evA) && hasOrder(evB)) {
            const dateDiff = absA.getTime() - absB.getTime();
            const orderDiff = evA.relativeOrder - evB.relativeOrder;
            if (dateDiff !== 0 && orderDiff !== 0 && Math.sign(dateDiff) !== Math.sign(orderDiff)) {
              conflicts.push(
                `⚠️ Mâu thuẫn ngày: "${evA.label}" (${evA.absoluteDate}) vs "${evB.label}" (${evB.absoluteDate}) — thứ tự ngày và relativeOrder ngược nhau.`
              );
            }
          }

          // 4. (v0.5.0) Mâu thuẫn ngày ↔ chương: cùng thread hoặc cùng nhân vật,
          // hai sự kiện có cả ngày lẫn chương nhưng dấu ngược nhau — LLM hay
          // ghi event "sau" ở chương trước. Bỏ qua khi một trong hai thiếu.
          if (absA && absB && evA.chapter && evB.chapter && (sameThread || commonChars.length > 0)) {
            const dateDiff2 = absA.getTime() - absB.getTime();
            const chapterOrder2 = compareChapter(evA.chapter, evB.chapter);
            if (dateDiff2 !== 0 && chapterOrder2 !== 0 && Math.sign(dateDiff2) !== Math.sign(chapterOrder2)) {
              conflicts.push(
                `⚠️ Mâu thuẫn ngày/chương: "${evA.label}" (📅${evA.absoluteDate} tại ${evA.chapter}) vs "${evB.label}" (📅${evB.absoluteDate} tại ${evB.chapter}) — ngày xảy ra ngược thứ tự chương. Lưu ý: nếu là hồi tưởng (flashback) chủ ý thì bỏ qua cảnh báo này.`
              );
            }
          }

          // Ghi nhận tuyến song song: chỉ khi cả hai đã đặt order (≠ 0)
          // hoặc trùng absoluteDate thật sự.
          if (!sameThread && ((hasOrder(evA) && hasOrder(evB) && evA.relativeOrder === evB.relativeOrder) || (absA && absB && absA.getTime() === absB.getTime()))) {
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
 
📅 Tổng số sự kiện: ${events.length}${addedEventNote}
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
