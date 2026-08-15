import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { countWords, averageSentenceLength } from '../../utils/wordCount.js';

export function registerAnalyzeVoiceTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_analyze_voice',
    {
      title: 'Analyze Writing Voice & Drift',
      description: 'Phân tích giọng văn (độ dài câu, vốn từ, POV, Tense) và kiểm tra hiện tượng trôi văn phong (Voice drift) so với style_guide.json.',
      inputSchema: z.object({
        arc: z.string().describe('Arc ID cần phân tích'),
        chapter: z.string().optional().describe('Chương cụ thể cần kiểm tra'),
      }),
    },
    async (params) => {
      const project = getProject();

      if (!await project.isInitialized()) {
        return {
          content: [{ type: 'text' as const, text: '❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.' }],
        };
      }

      const styleGuide = await project.getStyleGuide();
      const chaptersToAnalyze = params.chapter
        ? [params.chapter]
        : await project.listChaptersInArc(params.arc);

      if (chaptersToAnalyze.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `⚠️ Không tìm thấy chương nào trong ${params.arc}` }],
        };
      }

      const reports: string[] = [];
      let totalAvgSentenceLength = 0;
      let chapterCount = 0;

      for (const ch of chaptersToAnalyze) {
        const content = await project.getChapterContent(params.arc, ch);
        if (!content) continue;

        const avgLen = averageSentenceLength(content);
        const words = countWords(content);
        totalAvgSentenceLength += avgLen;
        chapterCount++;

        // Detect POV indicators
        const firstPersonMatches = (content.match(/\b(tôi|ta|mình|bản thân tôi)\b/gi) || []).length;
        const thirdPersonMatches = (content.match(/\b(hắn|nàng|cậu|anh|ông|bà)\b/gi) || []).length;
        const detectedPOV = firstPersonMatches > thirdPersonMatches ? 'Ngôi thứ nhất (First person)' : 'Ngôi thứ ba (Third person)';

        // Detect avoid words
        const foundAvoidWords = styleGuide.avoidWords.filter(w => content.toLowerCase().includes(w.toLowerCase()));

        // Check drift
        const targetLen = styleGuide.avgSentenceLength || 15;
        const lenDiff = Math.abs(avgLen - targetLen);
        const hasDrift = lenDiff > 8;

        reports.push(`### Chương: ${ch}
- **Độ dài câu trung bình**: ${avgLen} từ / câu ${targetLen ? `(Mục tiêu: ~${targetLen})` : ''}
- **POV phát hiện**: ${detectedPOV} (${firstPersonMatches} ngôi 1, ${thirdPersonMatches} ngôi 3)
- **Từ cần tránh phát hiện**: ${foundAvoidWords.length > 0 ? `⚠️ ${foundAvoidWords.join(', ')}` : '✅ Không phát hiện'}
- **Voice Drift**: ${hasDrift ? `⚠️ Phát hiện trôi văn phong! (Độ dài câu chênh lệch ${lenDiff.toFixed(1)} từ so với tiêu chuẩn)` : '✅ Giữ vững văn phong'}
`);
      }

      const overallAvgLen = chapterCount > 0 ? (totalAvgSentenceLength / chapterCount).toFixed(1) : 'N/A';

      return {
        content: [{
          type: 'text' as const,
          text: `# Phân tích Giọng Văn (Voice & Style Audit) - ${params.arc}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📜 Style Guide Tiêu Chuẩn:
- **Giọng văn**: ${styleGuide.voiceDescription || '_Chưa thiết lập_'}
- **Vốn từ**: ${styleGuide.vocabularyLevel}
- **Từ cần tránh**: ${styleGuide.avoidWords.join(', ') || 'Không có'}

📊 Chỉ số tổng thể Arc:
- **Độ dài câu trung bình Arc**: ${overallAvgLen} từ / câu

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${reports.join('\n---\n')}
`,
        }],
      };
    }
  );
}
