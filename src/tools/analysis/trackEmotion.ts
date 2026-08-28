import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  analyzeSentiment,
  formatAllEmotions,
  polarityLabel,
  TONE_LABELS,
} from '../../utils/sentimentLexicon.js';

/**
 * Tool nhẹ: phân tích sentiment cho một đoạn text bất kỳ.
 * Không yêu cầu project context — hữu ích khi Agent đang viết draft
 * và muốn nhanh chóng kiểm tra giọng văn.
 */
export function registerTrackEmotionTool(server: McpServer): void {
  server.registerTool(
    'story_track_emotion',
    {
      title: 'Quick Emotion Tracker',
      description: 'Phân tích nhanh cảm xúc và giọng văn của một đoạn text. Không cần context dự án — chỉ cần đưa vào đoạn văn cần kiểm tra.',
      inputSchema: z.object({
        text: z.string().describe('Đoạn văn bản cần phân tích cảm xúc'),
      }),
    },
    async (params) => {
      if (!params.text.trim()) {
        return {
          content: [{ type: 'text' as const, text: '⚠️ Đoạn text trống, không thể phân tích.' }],
        };
      }

      const result = analyzeSentiment(params.text);
      const toneLabel = TONE_LABELS[result.tone] || result.tone;

      // Truncate text preview
      const preview = params.text.length > 100
        ? params.text.slice(0, 100) + '...'
        : params.text;

      return {
        content: [{
          type: 'text' as const,
          text: `# 🎭 Quick Emotion Tracker

> _"${preview}"_

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 **Polarity**: ${result.polarity.toFixed(2)} (${polarityLabel(result.polarity)})
🎭 **Giọng văn**: ${toneLabel}
🎨 **Cảm xúc chủ đạo**: ${result.dominantEmotion.charAt(0).toUpperCase() + result.dominantEmotion.slice(1)}
🔍 **Từ cảm xúc**: ${result.sentimentWordCount}/${result.totalWords} (${(result.coverage * 100).toFixed(1)}% coverage)

📊 Phân bổ cảm xúc:
${formatAllEmotions(result.emotions)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`,
        }],
      };
    }
  );
}
