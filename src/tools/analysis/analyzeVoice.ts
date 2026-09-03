import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { countWords, averageSentenceLength } from '../../utils/wordCount.js';
import {
  analyzeSentiment,
  formatAllEmotions,
  polarityLabel,
  TONE_LABELS,
  type SentimentResult,
  type ToneCategory,
} from '../../utils/sentimentLexicon.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

export function registerAnalyzeVoiceTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_analyze_voice',
    {
      title: 'Analyze Writing Voice & Drift',
      description: 'Phân tích giọng văn (độ dài câu, vốn từ, POV, Tense, cảm xúc chủ đạo) và kiểm tra hiện tượng trôi văn phong (Voice drift) so với style_guide.json.',
      inputSchema: z.object({
        arc: z.string().describe('Arc ID cần phân tích'),
        chapter: z.string().optional().describe('Chương cụ thể cần kiểm tra'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const styleGuide = await project.getStyleGuide();
      const chaptersToAnalyze = params.chapter
        ? [params.chapter]
        : await project.listChaptersInArc(params.arc);

      if (chaptersToAnalyze.length === 0) {
        return errResult(`⚠️ Không tìm thấy chương nào trong ${params.arc}`);
      }

      const reports: string[] = [];
      let totalAvgSentenceLength = 0;
      let chapterCount = 0;
      const chapterTones: { ch: string; tone: string; polarity: number }[] = [];

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

        // Sentiment analysis integration
        const sentiment: SentimentResult = analyzeSentiment(content);
        const toneLabel = TONE_LABELS[sentiment.tone] || sentiment.tone;
        chapterTones.push({ ch, tone: sentiment.tone, polarity: sentiment.polarity });

        reports.push(`### Chương: ${ch}
- **Độ dài câu trung bình**: ${avgLen} từ / câu ${targetLen ? `(Mục tiêu: ~${targetLen})` : ''}
- **POV phát hiện**: ${detectedPOV} (${firstPersonMatches} ngôi 1, ${thirdPersonMatches} ngôi 3)
- **Từ cần tránh phát hiện**: ${foundAvoidWords.length > 0 ? `⚠️ ${foundAvoidWords.join(', ')}` : '✅ Không phát hiện'}
- **Voice Drift**: ${hasDrift ? `⚠️ Phát hiện trôi văn phong! (Độ dài câu chênh lệch ${lenDiff.toFixed(1)} từ so với tiêu chuẩn)` : '✅ Giữ vững văn phong'}

🎭 **Cảm xúc chủ đạo**: ${sentiment.dominantEmotion.charAt(0).toUpperCase() + sentiment.dominantEmotion.slice(1)} | **Giọng văn**: ${toneLabel} | **Polarity**: ${sentiment.polarity.toFixed(2)} (${polarityLabel(sentiment.polarity)})
${formatAllEmotions(sentiment.emotions)}
`);
      }

      const overallAvgLen = chapterCount > 0 ? (totalAvgSentenceLength / chapterCount).toFixed(1) : 'N/A';

      // Tone consistency check
      let toneConsistency = '';
      if (chapterTones.length > 1) {
        const uniqueTones = new Set(chapterTones.map(t => t.tone));
        if (uniqueTones.size === 1) {
          toneConsistency = `\n✅ **Tone Consistency**: Giọng văn nhất quán xuyên suốt (${TONE_LABELS[chapterTones[0].tone as ToneCategory] || chapterTones[0].tone})`;
        } else {
          toneConsistency = `\n⚠️ **Tone Consistency**: Phát hiện ${uniqueTones.size} giọng văn khác nhau:
${chapterTones.map(t => `  - ${t.ch}: ${TONE_LABELS[t.tone as ToneCategory] || t.tone}`).join('\n')}`;
        }
      }

      // Style guide tone comparison
      let styleGuideComparison = '';
      if (styleGuide.expectedTone && chapterTones.length > 0) {
        const mostCommonTone = chapterTones.reduce((acc, t) => {
          acc[t.tone] = (acc[t.tone] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const dominant = Object.entries(mostCommonTone).sort((a, b) => b[1] - a[1])[0][0];
        const dominantLabel = TONE_LABELS[dominant as keyof typeof TONE_LABELS] || dominant;
        const expected = styleGuide.expectedTone.toLowerCase();
        const matches = dominant === expected || dominantLabel.toLowerCase().includes(expected);
        styleGuideComparison = `\n📜 **So sánh Style Guide**: Kỳ vọng "${styleGuide.expectedTone}" → Thực tế "${dominantLabel}" ${matches ? '✅' : '⚠️ Không khớp'}`;
      }

      return {
        content: [{
          type: 'text' as const,
          text: `# Phân tích Giọng Văn (Voice & Style Audit) - ${params.arc}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📜 Style Guide Tiêu Chuẩn:
- **Giọng văn**: ${styleGuide.voiceDescription || '_Chưa thiết lập_'}
- **Vốn từ**: ${styleGuide.vocabularyLevel}
- **Từ cần tránh**: ${styleGuide.avoidWords.join(', ') || 'Không có'}
${styleGuide.expectedTone ? `- **Giọng văn kỳ vọng**: ${styleGuide.expectedTone}` : ''}
${styleGuide.expectedEmotionalArc ? `- **Emotional Arc kỳ vọng**: ${styleGuide.expectedEmotionalArc}` : ''}

📊 Chỉ số tổng thể Arc:
- **Độ dài câu trung bình Arc**: ${overallAvgLen} từ / câu
${toneConsistency}
${styleGuideComparison}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${reports.join('\n---\n')}
`,
        }],
      };
    }
  );
}
