import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import {
  analyzeSentiment,
  computeEmotionalArc,
  detectToneDrift,
  formatAllEmotions,
  polarityLabel,
  TONE_LABELS,
  type SentimentResult,
  type ToneDriftAlert,
} from '../../utils/sentimentLexicon.js';
import type { SentimentCache, ChapterSentiment } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

export function registerAnalyzeSentimentTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_analyze_sentiment',
    {
      title: 'Analyze Sentiment & Tone',
      description: 'Phân tích cảm xúc (sentiment), giọng văn (tone), và emotional arc của chương/arc. Phát hiện tone drift giữa các chương.',
      inputSchema: z.object({
        arc: z.string().describe('Arc ID cần phân tích (ví dụ: arc_01)'),
        chapter: z.string().optional().describe('Chương cụ thể (bỏ qua để phân tích toàn bộ Arc)'),
        windowSize: z.number().default(200).describe('Số từ mỗi sliding window cho emotional arc (default 200)'),
        compareToStyleGuide: z.boolean().default(true).describe('So sánh với style_guide.json nếu có'),
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

      const styleGuide = params.compareToStyleGuide
        ? await project.getStyleGuide()
        : null;

      const chapterResults: { ch: string; result: SentimentResult; arcPoints: ReturnType<typeof computeEmotionalArc> }[] = [];

      for (const ch of chaptersToAnalyze) {
        const content = await project.getChapterContent(params.arc, ch);
        if (!content) continue;

        const result = analyzeSentiment(content);
        const arcPoints = computeEmotionalArc(content, params.windowSize);

        chapterResults.push({ ch, result, arcPoints });
      }

      if (chapterResults.length === 0) {
        return errResult(`⚠️ Không đọc được nội dung chương nào trong ${params.arc}`);
      }

      // Detect tone drift
      const driftAlerts: ToneDriftAlert[] = [];
      for (let i = 1; i < chapterResults.length; i++) {
        const drift = detectToneDrift(
          chapterResults[i - 1].ch,
          chapterResults[i].ch,
          chapterResults[i - 1].result,
          chapterResults[i].result,
        );
        if (drift) driftAlerts.push(drift);
      }

      // Build chapter reports
      const chapterReports = chapterResults.map(({ ch, result, arcPoints }) => {
        const toneLabel = TONE_LABELS[result.tone] || result.tone;

        // Emotional arc summary (start → mid → end)
        let arcSummary = '';
        if (arcPoints.length >= 3) {
          const start = arcPoints[0];
          const mid = arcPoints[Math.floor(arcPoints.length / 2)];
          const end = arcPoints[arcPoints.length - 1];
          arcSummary = `\n⚡ Emotional Arc trong chương:\n  Đầu: ${start.polarity.toFixed(2)} (${polarityLabel(start.polarity)}) → Giữa: ${mid.polarity.toFixed(2)} (${polarityLabel(mid.polarity)}) → Cuối: ${end.polarity.toFixed(2)} (${polarityLabel(end.polarity)})`;
        } else if (arcPoints.length > 0) {
          arcSummary = `\n⚡ Polarity xuyên suốt: ${arcPoints.map(p => p.polarity.toFixed(2)).join(' → ')}`;
        }

        return `### Chương: ${ch}
📊 Sentiment: Polarity = ${result.polarity.toFixed(2)} (${polarityLabel(result.polarity)})
🎭 Giọng văn: ${toneLabel}
🔍 Từ cảm xúc: ${result.sentimentWordCount}/${result.totalWords} (${(result.coverage * 100).toFixed(1)}% coverage)

🎨 Phân bổ cảm xúc:
${formatAllEmotions(result.emotions)}
${arcSummary}
`;
      });

      // Overall stats
      const avgPolarity = chapterResults.reduce((sum, { result }) => sum + result.polarity, 0) / chapterResults.length;
      const overallResult = analyzeSentiment(
        (await Promise.all(chaptersToAnalyze.map(ch => project.getChapterContent(params.arc, ch))))
          .filter(Boolean)
          .join('\n\n')
      );
      const overallToneLabel = TONE_LABELS[overallResult.tone] || overallResult.tone;

      // Tone drift report
      const driftReport = driftAlerts.length > 0
        ? `\n## ⚠️ Cảnh báo Tone Drift\n${driftAlerts.map(d => {
            const fromLabel = TONE_LABELS[d.fromTone] || d.fromTone;
            const toLabel = TONE_LABELS[d.toTone] || d.toTone;
            const icon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : '🔵';
            return `${icon} **${d.fromChapter} → ${d.toChapter}**: ${fromLabel} → ${toLabel} (polarity shift: ${d.polarityShift.toFixed(2)}) [${d.severity}]`;
          }).join('\n')}`
        : '\n## ✅ Tone Drift: Giọng văn nhất quán xuyên suốt arc';

      // Style guide comparison
      let styleComparison = '';
      if (styleGuide?.expectedTone) {
        const matches = overallResult.tone === styleGuide.expectedTone ||
          TONE_LABELS[overallResult.tone]?.toLowerCase().includes(styleGuide.expectedTone.toLowerCase());
        styleComparison = `\n## 📜 So sánh với Style Guide\n- **Giọng văn kỳ vọng**: ${styleGuide.expectedTone}\n- **Giọng văn thực tế**: ${overallToneLabel}\n- **Trạng thái**: ${matches ? '✅ Phù hợp' : '⚠️ Không khớp — cân nhắc điều chỉnh'}`;
      }

      // Emotional arc chart (Mermaid xychart)
      const arcChartData = chapterResults.map(({ ch, result }) => ({
        label: ch.replace('ch_', 'Ch'),
        polarity: result.polarity,
      }));

      const mermaidChart = arcChartData.length > 1
        ? `\n## 📈 Đường cong Cảm xúc xuyên Arc (Emotional Arc)\n\n\`\`\`mermaid\nxychart-beta\n  title "Emotional Arc - ${params.arc}"\n  x-axis [${arcChartData.map(d => `"${d.label}"`).join(', ')}]\n  y-axis "Polarity" -1 --> 1\n  line [${arcChartData.map(d => d.polarity.toFixed(2)).join(', ')}]\n\`\`\``
        : '';

      // Save cache
      const cacheData: SentimentCache = {
        arc: params.arc,
        chapters: chapterResults.map(({ ch, result, arcPoints }) => ({
          chapter: ch,
          polarity: result.polarity,
          dominantEmotion: result.dominantEmotion,
          dominantTone: result.tone,
          emotions: result.emotions,
          emotionalArc: arcPoints.map(p => ({
            position: p.position,
            polarity: p.polarity,
            dominantEmotion: p.dominantEmotion,
          })),
          alerts: [],
        })),
        overallPolarity: avgPolarity,
        overallTone: overallResult.tone,
        toneDriftAlerts: driftAlerts.map(d => ({
          fromChapter: d.fromChapter,
          toChapter: d.toChapter,
          fromTone: d.fromTone,
          toTone: d.toTone,
          severity: d.severity,
        })),
        analyzedAt: new Date().toISOString(),
      };
      await project.saveSentimentCache(cacheData);

      return {
        content: [{
          type: 'text' as const,
          text: `# 🎭 Phân tích Cảm xúc & Giọng văn (Sentiment & Tone Analysis) - ${params.arc}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Tổng quan
- 🎭 **Giọng văn chủ đạo**: ${overallToneLabel}
- 📊 **Polarity trung bình**: ${avgPolarity.toFixed(2)} (${polarityLabel(avgPolarity)})
- 🎨 **Cảm xúc nổi bật**: ${overallResult.dominantEmotion.charAt(0).toUpperCase() + overallResult.dominantEmotion.slice(1)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Phân tích từng chương

${chapterReports.join('\n---\n')}
${mermaidChart}
${driftReport}
${styleComparison}
`,
        }],
      };
    }
  );
}
