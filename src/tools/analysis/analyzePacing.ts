import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { countWords } from '../../utils/wordCount.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

/**
 * Phân tích pacing của một chương: Action / Dialogue / Description balance & Tension score.
 */
function analyzeChapterPacing(content: string): {
  dialoguePercent: number;
  actionPercent: number;
  descriptionPercent: number;
  tensionScore: number;
  beats: string[];
} {
  const lines = content.split('\n').filter(l => {
    const t = l.trim();
    // Bỏ dòng trống, heading và hr (---) — hr bắt đầu bằng - nhưng không phải thoại
    return t.length > 0 && !t.startsWith('#') && !/^(-{3,}|\*{3,}|_{3,})$/.test(t);
  });
  const totalLines = lines.length || 1;

  let dialogueLines = 0;
  let actionLines = 0;
  let descriptionLines = 0;

  // Tension keywords (tiếng Việt & Anh). Từ đơn match theo token đã gọt
  // dấu câu (để "máu," vẫn khớp); cụm nhiều từ match theo ranh giới từ.
  const tensionKeywords = [
    'chém', 'đánh', 'giết', 'chết', 'máu', 'bùng nổ', 'gào', 'hét', 'kiếm', 'đao',
    'bất ngờ', 'sợ', 'hãi', 'nguy hiểm', 'vực', 'vỡ', 'nổ', 'fight', 'kill', 'blood',
    'sword', 'fear', 'danger', 'shout', 'run', 'chạy', 'đuổi', 'trốn'
  ];
  const singleKeywords = new Set(tensionKeywords.filter(k => !k.includes(' ')));
  const phraseKeywords = tensionKeywords.filter(k => k.includes(' '));
  const stripEdge = (w: string): string =>
    w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

  let tensionHits = 0;
  const totalWords = countWords(content) || 1;

  for (const line of lines) {
    // Thoại: chứa quote CJK/" hoặc mở đầu bằng gạch ngang (kể cả "—Hắn nói")
    const isDialogue = /[""「」『』]|^[-–—]/.test(line.trim());
    const tokens = line.toLowerCase().split(/\s+/).map(stripEdge).filter(t => t.length > 0);
    const padded = ` ${tokens.join(' ')} `;
    const matchedSingles = new Set(tokens.filter(t => singleKeywords.has(t)));
    const matchedPhrases = phraseKeywords.filter(p => padded.includes(` ${p} `));

    if (isDialogue) {
      dialogueLines++;
    } else if (matchedSingles.size > 0 || matchedPhrases.length > 0) {
      actionLines++;
    } else {
      descriptionLines++;
    }

    // Mỗi keyword khác nhau chỉ tính 1 hit/dòng — tránh "nổ" đếm đè "bùng nổ"
    tensionHits += matchedSingles.size + matchedPhrases.length;
  }

  const dialoguePercent = Math.round((dialogueLines / totalLines) * 100);
  const actionPercent = Math.round((actionLines / totalLines) * 100);
  const descriptionPercent = Math.max(0, 100 - dialoguePercent - actionPercent);

  // Tension score (1-100)
  const tensionDensity = tensionHits / (totalWords / 100);
  const tensionScore = Math.min(100, Math.round(tensionDensity * 20));

  // Beats breakdown
  const beatCount = Math.max(3, Math.min(5, Math.ceil(totalLines / 10)));
  const chunkSize = Math.ceil(lines.length / beatCount);
  const beats: string[] = [];

  for (let i = 0; i < beatCount; i++) {
    const chunk = lines.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length > 0) {
      const summary = chunk[0].length > 80 ? chunk[0].slice(0, 80) + '...' : chunk[0];
      beats.push(`Beat ${i + 1}: "${summary}"`);
    }
  }

  return {
    dialoguePercent,
    actionPercent,
    descriptionPercent,
    tensionScore,
    beats,
  };
}

export function registerAnalyzePacingTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_analyze_pacing',
    {
      title: 'Analyze Pacing & Tension Curve',
      description: 'Đo lường tỷ lệ Action / Dialogue / Description, đường cong căng thẳng (Tension curve) và cấu trúc nhịp cảnh (Scene beats).',
      inputSchema: z.object({
        arc: z.string().min(1).max(64).describe('Arc ID (ví dụ: arc_01)'),
        chapter: z.string().optional().describe('Chương cụ thể (bỏ qua để phân tích toàn bộ Arc)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const chaptersToAnalyze = params.chapter
        ? [params.chapter]
        : await project.listChaptersInArc(params.arc);

      if (chaptersToAnalyze.length === 0) {
        return errResult(`⚠️ Không tìm thấy chương nào trong ${params.arc}`);
      }

      const results: string[] = [];
      const tensionPoints: number[] = [];

      for (const ch of chaptersToAnalyze) {
        const content = await project.getChapterContent(params.arc, ch);
        if (!content) continue;

        const pacing = analyzeChapterPacing(content);
        tensionPoints.push(pacing.tensionScore);

        // Tension bar
        const filled = Math.round(pacing.tensionScore / 5);
        const tensionBar = '🔥'.repeat(Math.min(10, Math.ceil(filled / 2))) || '❄️';

        results.push(`### Chương: ${ch}
📊 Tỷ lệ:
  🗣️  Thoại (Dialogue):    ${pacing.dialoguePercent}%
  ⚔️  Hành động (Action):  ${pacing.actionPercent}%
  🏞️  Miêu tả (Description): ${pacing.descriptionPercent}%

⚡ Mức độ căng thẳng (Tension): ${pacing.tensionScore}/100 ${tensionBar}

🥁 Nhịp cảnh (Scene Beats):
${pacing.beats.map(b => '  - ' + b).join('\n')}
`);
      }

      // Đường cong căng thẳng tổng thể
      const tensionCurveStr = tensionPoints
        .map((score, i) => `Chương ${i + 1}: ${'█'.repeat(Math.round(score / 5))} (${score})`)
        .join('\n');

      return {
        content: [{
          type: 'text' as const,
          text: `# Phân tích Nhịp Truyện (Pacing Analysis) - ${params.arc}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Đường cong căng thẳng (Tension Curve):
${tensionCurveStr}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${results.join('\n---\n')}
`,
        }],
      };
    }
  );
}
