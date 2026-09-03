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
  const lines = content.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#'));
  const totalLines = lines.length || 1;

  let dialogueLines = 0;
  let actionLines = 0;
  let descriptionLines = 0;

  // Tension keywords (tiếng Việt & Anh)
  const tensionKeywords = [
    'chém', 'đánh', 'giết', 'chết', 'máu', 'bùng nổ', 'gào', 'hét', 'kiếm', 'đao',
    'bất ngờ', 'sợ', 'hãi', 'nguy hiểm', 'vực', 'vỡ', 'nổ', 'fight', 'kill', 'blood',
    'sword', 'fear', 'danger', 'shout', 'run', 'chạy', 'đuổi', 'trốn'
  ];

  let tensionHits = 0;
  const totalWords = countWords(content) || 1;

  for (const line of lines) {
    const isDialogue = /[""「」『』]|^[-–—]\s/.test(line.trim());
    if (isDialogue) {
      dialogueLines++;
    } else {
      // Kiêm tra có động từ mạnh/hành động không
      const words = line.toLowerCase().split(/\s+/);
      const hasActionWord = words.some(w => tensionKeywords.includes(w));
      if (hasActionWord) {
        actionLines++;
      } else {
        descriptionLines++;
      }
    }

    // Đếm tension keywords
    const lowerLine = line.toLowerCase();
    for (const kw of tensionKeywords) {
      if (lowerLine.includes(kw)) tensionHits++;
    }
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
        arc: z.string().describe('Arc ID (ví dụ: arc_01)'),
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
