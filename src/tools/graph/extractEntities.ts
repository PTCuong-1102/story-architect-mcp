import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../../server/StoryProject.js';
import { readTextFile, exists } from '../../utils/fileUtils.js';

/**
 * Trích xuất tên riêng dạng Title Case hoặc Capitalized words từ văn bản.
 */
function extractCapitalizedTerms(text: string): { names: string[]; locations: string[] } {
  // Loại bỏ Markdown markup
  const cleaned = text.replace(/^#{1,6}\s+/gm, '').replace(/[*_~`]/g, '');

  // Match các cụm từ viết hoa tiếng Việt / Anh (ví dụ: "Tiêu Viêm", "Thanh Vân Sơn", "Cửu Long Thần Đỉnh")
  const words = cleaned.split(/\s+/);
  const capitalizedChunks: string[] = [];
  let currentChunk: string[] = [];

  const ignoreWords = new Set([
    'Trên', 'Dưới', 'Trong', 'Ngoài', 'Khi', 'Nếu', 'Nhưng', 'Tuy', 'Vì', 'Do', 'Và', 'Hoặc',
    'Chương', 'Arc', 'Phần', 'Tập', 'Hồi', 'Theo', 'Sau', 'Trước', 'Tại', 'Với', 'Một', 'Hai',
    'Ba', 'Bốn', 'Năm', 'Sáu', 'Bảy', 'Tám', 'Chín', 'Mười', 'Đã', 'Đang', 'Sẽ', 'Cậu', 'Anh',
    'Cô', 'Hắn', 'Nàng', 'Ông', 'Bà', 'Ta', 'Tôi', 'Ngươi', 'Bí', 'Mật', 'Cấm', 'Địa'
  ]);

  for (const word of words) {
    const cleanWord = word.replace(/^[^\w\u00C0-\u024F\u1EA0-\u1EF9]+|[^\w\u00C0-\u024F\u1EA0-\u1EF9]+$/g, '');
    if (cleanWord.length > 1 && /^[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĐẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ]/.test(cleanWord)) {
      if (!ignoreWords.has(cleanWord)) {
        currentChunk.push(cleanWord);
        continue;
      }
    }
    if (currentChunk.length > 0) {
      capitalizedChunks.push(currentChunk.join(' '));
      currentChunk = [];
    }
  }
  if (currentChunk.length > 0) {
    capitalizedChunks.push(currentChunk.join(' '));
  }

  // Đếm tần suất
  const freqMap = new Map<string, number>();
  for (const chunk of capitalizedChunks) {
    if (chunk.length > 2) {
      freqMap.set(chunk, (freqMap.get(chunk) || 0) + 1);
    }
  }

  // Phân loại đơn giản
  const names: string[] = [];
  const locations: string[] = [];

  for (const [term, freq] of freqMap.entries()) {
    if (freq >= 1) {
      if (term.includes('Sơn') || term.includes('Đỉnh') || term.includes('Thành') || term.includes('Động') || term.includes('Cung') || term.includes('Vực') || term.includes('Cấm')) {
        locations.push(term);
      } else {
        names.push(term);
      }
    }
  }

  return { names, locations };
}

export function registerExtractEntitiesTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_extract_entities_to_bible',
    {
      title: 'Extract Entities to Bible',
      description: 'Phân tích văn bản chương, tự động phát hiện nhân vật và địa danh, tạo đề xuất hoặc tự động tạo các file Markdown trong bible/ với YAML frontmatter chuẩn.',
      inputSchema: z.object({
        arc: z.string().describe('Arc ID (ví dụ: arc_01)'),
        chapter: z.string().describe('Chapter ID (ví dụ: ch_001)'),
        confirm: z.boolean().default(false).describe('false = preview/đề xuất, true = ghi file vào bible/'),
      }),
    },
    async (params) => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return {
          content: [{ type: 'text' as const, text: '❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.' }],
        };
      }

      const content = await project.getChapterContent(params.arc, params.chapter);
      if (!content) {
        return {
          content: [{ type: 'text' as const, text: `❌ Không tìm thấy chương: ${params.arc}/${params.chapter}` }],
        };
      }

      const { names, locations } = extractCapitalizedTerms(content);
      const existingCharacters = await project.listCharacters();
      const existingWorld = await project.listWorldEntries();

      // Filter non-existing
      const newCharacters = names.filter(n => !existingCharacters.map(c => c.toLowerCase()).includes(n.toLowerCase()));
      const newLocations = locations.filter(l => !existingWorld.map(w => w.toLowerCase()).includes(l.toLowerCase()));

      if (!params.confirm) {
        const charReport = newCharacters.length > 0
          ? newCharacters.map(n => `  👤 ${n} → sẽ tạo bible/characters/${n.toLowerCase().replace(/\s+/g, '_')}.md`).join('\n')
          : '  _Không có nhân vật mới._';

        const locReport = newLocations.length > 0
          ? newLocations.map(l => `  📍 ${l} → sẽ tạo bible/world/${l.toLowerCase().replace(/\s+/g, '_')}.md`).join('\n')
          : '  _Không có địa danh mới._';

        return {
          content: [{
            type: 'text' as const,
            text: `🔍 DRY-RUN: Phân tích thực thể từ ${params.arc}/${params.chapter}

👥 Nhân vật đề xuất mới (${newCharacters.length}):
${charReport}

📍 Bối cảnh / Địa danh đề xuất mới (${newLocations.length}):
${locReport}

⚠️ Để tự động tạo các file Markdown này với YAML frontmatter chuẩn, hãy gọi lại với confirm: true.`,
          }],
        };
      }

      // EXECUTE WRITE
      let createdChars = 0;
      let createdWorld = 0;

      const charDir = path.join(project.bibleDir, 'characters');
      const worldDir = path.join(project.bibleDir, 'world');
      await fs.mkdir(charDir, { recursive: true });
      await fs.mkdir(worldDir, { recursive: true });

      for (const name of newCharacters) {
        const fileName = `${name.toLowerCase().replace(/\s+/g, '_')}.md`;
        const filePath = path.join(charDir, fileName);
        if (!await exists(filePath)) {
          const charContent = `---
name: "${name}"
role: "supporting"
aliases: []
firstAppearance: "${params.arc}/${params.chapter}"
---

# ${name}

## Tổng quan
_Mô tả tổng quan về nhân vật ${name}._

## Tính cách & Động lực
- **Tính cách**: _Chưa cập nhật_
- **Mục tiêu**: _Chưa cập nhật_

## Lịch sử xuất hiện
- Xuất hiện lần đầu tại chương: \`${params.arc}/${params.chapter}\`
`;
          await fs.writeFile(filePath, charContent, 'utf-8');
          createdChars++;
        }
      }

      for (const loc of newLocations) {
        const fileName = `${loc.toLowerCase().replace(/\s+/g, '_')}.md`;
        const filePath = path.join(worldDir, fileName);
        if (!await exists(filePath)) {
          const locContent = `---
name: "${loc}"
type: "location"
relatedCharacters: []
---

# ${loc}

## Mô tả
_Mô tả địa danh / bối cảnh ${loc}._

## Chi tiết & Lịch sử
- Được đề cập lần đầu tại chương: \`${params.arc}/${params.chapter}\`
`;
          await fs.writeFile(filePath, locContent, 'utf-8');
          createdWorld++;
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Đã tạo các thực thể mới vào Bible thành công!

📊 Kết quả:
- Nhân vật mới đã tạo: ${createdChars} trong \`bible/characters/\`
- Bối cảnh mới đã tạo: ${createdWorld} trong \`bible/world/\`

💡 Các file Markdown đều chứa YAML frontmatter chuẩn hóa cho hệ thống Knowledge Graph nội bộ.`,
        }],
      };
    }
  );
}
