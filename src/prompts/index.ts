import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../server/StoryProject.js';
import { readTextFile } from '../utils/fileUtils.js';
import * as path from 'node:path';

/**
 * Đăng ký tất cả MCP Prompts vào server.
 */
export function registerPrompts(server: McpServer, getProject: () => StoryProject): void {

  // ─── write-next-chapter ───
  server.registerPrompt(
    'write-next-chapter',
    {
      title: 'Write Next Chapter',
      description: 'Tự động gom Lore + Chương liền trước + Dàn ý chương mới + Style Guide → Prompt tối ưu để viết chương tiếp theo',
      argsSchema: z.object({
        arc: z.string().describe('Arc ID, ví dụ: arc_01'),
        chapter: z.string().describe('Chapter ID tiếp theo, ví dụ: ch_003'),
      }),
    },
    async ({ arc, chapter }) => {
      const project = getProject();
      const config = await project.getConfig();
      const styleGuide = await project.getStyleGuide();
      const foreshadowing = await project.getForeshadowing();

      const chapters = await project.listChaptersInArc(arc);

      let previousChapterContent = '';
      if (chapters.length > 0) {
        const lastChapter = chapters[chapters.length - 1];
        const content = await project.getChapterContent(arc, lastChapter);
        if (content) {
          previousChapterContent = content.length > 2000
            ? '...\n' + content.slice(-2000)
            : content;
        }
      }

      const outlinePath = path.join(project.outlineDir, arc, `${chapter}_outline.md`);
      const outlineContent = await readTextFile(outlinePath) || '_Chưa có dàn ý cho chương này._';

      const unfiredSetups = foreshadowing.items
        .filter(i => i.status === 'planted')
        .map(i => `- [${i.importance}] ${i.setup} (cài ở ${i.setupChapter})`)
        .join('\n');

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `# Viết chương ${chapter} - ${arc}

## Thông tin dự án
- **Tên truyện**: ${config.name}
- **Tác giả**: ${config.author}
- **Thể loại**: ${config.genre.join(', ')}
- **POV**: ${config.pov}
- **Thì**: ${config.tense === 'past' ? 'Quá khứ' : 'Hiện tại'}
- **Ngôn ngữ**: ${config.language}

## Quy chuẩn giọng văn (Style Guide)
${styleGuide.voiceDescription || '_Chưa thiết lập._'}
${styleGuide.narrativeStyle ? `\n- Phong cách kể: ${styleGuide.narrativeStyle}` : ''}
${styleGuide.dialogueStyle ? `\n- Phong cách thoại: ${styleGuide.dialogueStyle}` : ''}
${styleGuide.avoidWords.length > 0 ? `\n- Tránh dùng: ${styleGuide.avoidWords.join(', ')}` : ''}

## Nội dung chương trước (cuối cùng)
${previousChapterContent || '_Đây là chương đầu tiên._'}

## Dàn ý chương mới
${outlineContent}

## Chi tiết cài cắm chưa giải gỡ (Chekhov's Guns chưa bắn)
${unfiredSetups || '_Không có._'}

---

**Yêu cầu**: Hãy viết chương ${chapter} dựa trên dàn ý và bối cảnh trên. Giữ đúng giọng văn, POV, và thì đã thiết lập. Nếu phù hợp, hãy giải gỡ một hoặc nhiều chi tiết cài cắm đã liệt kê.`,
            },
          },
        ],
      };
    }
  );

  // ─── character-deep-dive ───
  server.registerPrompt(
    'character-deep-dive',
    {
      title: 'Character Deep Dive',
      description: 'Tổng hợp hồ sơ nhân vật từ Bible + toàn bộ các cảnh xuất hiện trong Manuscript',
      argsSchema: z.object({
        name: z.string().describe('Tên nhân vật'),
      }),
    },
    async ({ name }) => {
      const project = getProject();
      const character = await project.getCharacter(name);
      const relationships = await project.getRelationships();

      const relatedRels = relationships.relationships.filter(
        r => r.source.toLowerCase() === name.toLowerCase() || r.target.toLowerCase() === name.toLowerCase()
      );

      const relsText = relatedRels.length > 0
        ? relatedRels.map(r => `- ${r.source} ↔ ${r.target}: ${r.type} — ${r.description}`).join('\n')
        : '_Chưa có quan hệ nào được ghi nhận._';

      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Phân tích sâu nhân vật: ${name}

## Hồ sơ nhân vật (Bible)
${character ? character.content : '_Chưa có hồ sơ nhân vật trong bible/characters/._'}

## Metadata
${character ? JSON.stringify(character.frontmatter, null, 2) : '_N/A_'}

## Quan hệ nhân vật
${relsText}

---

**Yêu cầu**: Hãy phân tích toàn diện nhân vật ${name}: tính cách, động lực, arc phát triển, mâu thuẫn nội tâm, và đề xuất hướng phát triển tiếp theo.`,
          },
        }],
      };
    }
  );

  // ─── continuity-audit ───
  server.registerPrompt(
    'continuity-audit',
    {
      title: 'Continuity Audit',
      description: 'Quét toàn bộ Arc để phát hiện mâu thuẫn timeline, lặp từ & mâu thuẫn thiết lập',
      argsSchema: z.object({
        arc: z.string().describe('Arc ID cần audit, ví dụ: arc_01'),
      }),
    },
    async ({ arc }) => {
      const project = getProject();
      const chapters = await project.listChaptersInArc(arc);
      const timeline = await project.getTimeline();
      const holes = await project.getPlotHoles();

      const chapterSummaries: string[] = [];
      for (const ch of chapters) {
        const content = await project.getChapterContent(arc, ch);
        if (content) {
          const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
          chapterSummaries.push(`### ${ch}\n${preview}\n`);
        }
      }

      const arcEvents = timeline.events.filter(e => e.chapter?.startsWith(arc + '/') || (e.chapter && chapters.includes(e.chapter)));

      const openHoles = holes.holes
        .filter(h => h.status === 'open')
        .map(h => `- [${h.severity}] ${h.title}: ${h.description}`)
        .join('\n');

      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Kiểm tra tính liên tục: ${arc}

## Các chương trong Arc (${chapters.length} chương)
${chapterSummaries.join('\n') || '_Chưa có chương nào._'}

## Timeline Events
${JSON.stringify(arcEvents, null, 2)}

## Plot Holes đã biết (chưa giải quyết)
${openHoles || '_Không có._'}

---

**Yêu cầu**: Hãy phân tích kỹ toàn bộ nội dung arc này để phát hiện:
1. Mâu thuẫn timeline (thứ tự sự kiện, tuổi tác, thời gian)
2. Mâu thuẫn thiết lập (thông tin về nhân vật/bối cảnh không nhất quán)
3. Từ ngữ lặp lại quá nhiều
4. Lỗ hổng cốt truyện mới chưa được ghi nhận
Trình bày kết quả dưới dạng bảng với mức độ nghiêm trọng.`,
          },
        }],
      };
    }
  );

  // ─── rescue-project ───
  server.registerPrompt(
    'rescue-project',
    {
      title: 'Rescue Project',
      description: 'Workflow từng bước giúp quét, phân loại, preview và tái cấu trúc thư mục lộn xộn',
      argsSchema: z.object({
        projectPath: z.string().describe('Đường dẫn đến thư mục dự án lộn xộn'),
      }),
    },
    async ({ projectPath }) => {
      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Giải cứu dự án tiểu thuyết

**Đường dẫn**: ${projectPath}

## Quy trình Rescue (thực hiện từng bước):

### Bước 1: Quét dự án
Gọi tool \`story_scan_messy_project\` với path = "${projectPath}" để phát hiện tất cả các tệp, phân loại chúng.

### Bước 2: Xem preview
Gọi tool \`story_auto_refactor_structure\` với \`confirm: false\` để xem danh sách các thao tác sẽ thực hiện.

### Bước 3: Xác nhận với người dùng
Hiển thị bảng preview cho người dùng xem trước khi thực hiện.

### Bước 4: Thực hiện
Sau khi người dùng đồng ý, gọi \`story_auto_refactor_structure\` với \`confirm: true\`.
Hệ thống sẽ tự động tạo snapshot trước khi di chuyển file.

### Bước 5: Khởi tạo metadata
Gọi \`story_init\` nếu chưa có thư mục \`.story/\` để tạo cấu hình dự án.

---

**Yêu cầu**: Thực hiện quy trình trên từng bước. Dừng lại và hỏi người dùng sau mỗi bước quan trọng.`,
          },
        }],
      };
    }
  );

  // ─── brainstorm-scene ───
  server.registerPrompt(
    'brainstorm-scene',
    {
      title: 'Brainstorm Scene',
      description: 'Dựa trên bối cảnh hiện tại & outline, gợi ý 3-5 hướng triển khai cảnh tiếp theo',
      argsSchema: z.object({
        arc: z.string().describe('Arc ID'),
        chapter: z.string().describe('Chapter ID hiện tại'),
      }),
    },
    async ({ arc, chapter }) => {
      const project = getProject();
      const config = await project.getConfig();
      const content = await project.getChapterContent(arc, chapter);
      const foreshadowing = await project.getForeshadowing();

      const unfired = foreshadowing.items
        .filter(i => i.status === 'planted')
        .slice(0, 5)
        .map(i => `- ${i.setup}`)
        .join('\n');

      const outlinePath = path.join(project.outlineDir, arc, `${chapter}_outline.md`);
      const outline = await readTextFile(outlinePath) || '_Không có dàn ý._';

      return {
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Brainstorm cảnh tiếp theo

## Truyện: ${config.name} (${config.genre.join(', ')})

## Nội dung hiện tại (cuối chương ${chapter})
${content ? (content.length > 1500 ? '...\n' + content.slice(-1500) : content) : '_Chương trống._'}

## Dàn ý
${outline}

## Chi tiết cài cắm có thể sử dụng
${unfired || '_Không có._'}

---

**Yêu cầu**: Đề xuất 3-5 hướng triển khai cảnh tiếp theo, mỗi hướng gồm:
1. **Tóm tắt** (2-3 câu)
2. **Xung đột chính** trong cảnh
3. **Nhân vật liên quan**
4. **Đóng góp vào cốt truyện tổng thể**
5. **Mức độ phù hợp** (★★★★★)

Sắp xếp từ phương án được khuyến nghị nhất đến ít nhất.`,
          },
        }],
      };
    }
  );
}
