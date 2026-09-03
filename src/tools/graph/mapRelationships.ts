import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { Relationship } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

/**
 * Tự phân tích bản thảo: đếm tần suất hai nhân vật cùng xuất hiện trong một chương.
 * Trả về danh sách các cặp có co-occurrence đạt ngưỡng trở lên.
 */
async function autoDetectCooccurrences(
  project: StoryProject,
  minChapters = 2
): Promise<{ a: string; b: string; chapters: number }[]> {
  const characters = await project.listCharacters();
  const arcs = await project.listArcs();
  if (characters.length < 2 || arcs.length === 0) return [];

  // Chuẩn hóa tên để so khớp
  const norm = (s: string) => s.toLowerCase().trim();

  // Map: pair key "a|b" (đã sort) → số chương cùng xuất hiện
  const pairCount = new Map<string, number>();

  for (const arc of arcs) {
    const chapters = await project.listChaptersInArc(arc);
    for (const ch of chapters) {
      const content = await project.getChapterContent(arc, ch);
      if (!content) continue;
      const lower = content.toLowerCase();

      const present = characters.filter(c => lower.includes(norm(c)));
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const key = [present[i], present[j]].sort().join('|');
          pairCount.set(key, (pairCount.get(key) || 0) + 1);
        }
      }
    }
  }

  const results: { a: string; b: string; chapters: number }[] = [];
  for (const [key, count] of pairCount.entries()) {
    if (count >= minChapters) {
      const [a, b] = key.split('|');
      results.push({ a, b, chapters: count });
    }
  }
  return results;
}

export function registerMapRelationshipsTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_map_relationships',
    {
      title: 'Map Character Relationships Graph',
      description: 'Phân tích bản thảo và tự động cập nhật Đồ thị quan hệ nhân vật vào .story/relationships.json. Nếu bỏ trống source/target sẽ tự quét toàn bộ manuscript để phát hiện các cặp nhân vật đồng xuất hiện.',
      inputSchema: z.object({
        source: z.string().optional().describe('Nhân vật A (bỏ trống để chạy chế độ tự quét)'),
        target: z.string().optional().describe('Nhân vật B (bỏ trống để chạy chế độ tự quét)'),
        type: z.enum([
          'ally', 'enemy', 'friend', 'lover', 'rival',
          'family', 'mentor', 'student', 'stranger', 'other'
        ]).optional().describe('Loại mối quan hệ'),
        description: z.string().default('').describe('Mô tả mối quan hệ'),
        chapter: z.string().optional().describe('Chương diễn ra biến động quan hệ'),
        minChapters: z.number().default(2).describe('Ngưỡng số chương đồng xuất hiện (chế độ tự quét)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const data = await project.getRelationships();

      // ─── Chế độ tự quét: không truyền source/target ───
      if (!params.source && !params.target) {
        const cooccurrences = await autoDetectCooccurrences(project, params.minChapters);

        if (cooccurrences.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `🔍 Đã quét toàn bộ manuscript nhưng không tìm thấy cặp nhân vật nào đồng xuất hiện đủ ${params.minChapters} chương.

💡 Hãy tạo hồ sơ nhân vật trong bible/characters/ trước (dùng story_extract_entities_to_bible), hoặc giảm minChapters.`,
            }],
          };
        }

        let created = 0;
        let updated = 0;
        const report: string[] = [];

        for (const pair of cooccurrences) {
          const rel = data.relationships.find(
            r => (r.source.toLowerCase() === pair.a.toLowerCase() && r.target.toLowerCase() === pair.b.toLowerCase()) ||
                 (r.source.toLowerCase() === pair.b.toLowerCase() && r.target.toLowerCase() === pair.a.toLowerCase())
          );

          if (rel) {
            // Chỉ ghi nhận thêm mốc phát triển, không ghi đè loại quan hệ thủ công
            if (params.chapter) {
              rel.evolution.push({
                chapter: params.chapter,
                change: `Tiếp tục đồng xuất hiện (tự quét): ${pair.chapters} chương`,
              });
            }
            updated++;
            report.push(`  🔄 ${pair.a} ↔ ${pair.b}: đã có quan hệ [${rel.type}] — ghi nhận thêm (${pair.chapters} chương đồng xuất hiện)`);
          } else {
            const newRel: Relationship = {
              source: pair.a,
              target: pair.b,
              type: 'other',
              description: `Đồng xuất hiện trong ${pair.chapters} chương (phát hiện tự động)`,
              evolution: [{
                chapter: params.chapter || 'auto-scan',
                change: `Phát hiện đồng xuất hiện qua ${pair.chapters} chương`,
                newType: 'other',
              }],
            };
            data.relationships.push(newRel);
            created++;
            report.push(`  ➕ ${pair.a} ↔ ${pair.b}: tạo mới [other] (${pair.chapters} chương đồng xuất hiện)`);
          }
        }

        await project.saveRelationships(data);

        return {
          content: [{
            type: 'text' as const,
            text: `✅ Đã tự quét manuscript và cập nhật đồ thị quan hệ!

🔍 Tìm thấy ${cooccurrences.length} cặp đồng xuất hiện (ngưỡng ${params.minChapters} chương):
${report.join('\n')}

📊 Kết quả: tạo mới ${created} | cập nhật ${updated}
📊 Tổng số mối quan hệ trong đồ thị: ${data.relationships.length}

💡 Các quan hệ tạo tự động có type = "other". Dùng chế độ thủ công (truyền source/target/type) để gán loại quan hệ chính xác.`,
          }],
        };
      }

      // ─── Chế độ thủ công (bắt buộc có source/target/type) ───
      if (!params.source || !params.target || !params.type) {
        return errResult('❌ Chế độ thủ công cần đủ: source, target và type. Hoặc bỏ trống source/target để chạy chế độ tự quét manuscript.');
      }

      // Tìm mối quan hệ xem đã tồn tại chưa
      let rel = data.relationships.find(
        r => (r.source.toLowerCase() === params.source!.toLowerCase() && r.target.toLowerCase() === params.target!.toLowerCase()) ||
             (r.source.toLowerCase() === params.target!.toLowerCase() && r.target.toLowerCase() === params.source!.toLowerCase())
      );

      if (rel) {
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
