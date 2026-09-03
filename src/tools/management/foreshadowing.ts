import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { generateId } from '../../utils/fileUtils.js';
import type { ForeshadowingItem } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

export function registerForeshadowingTools(server: McpServer, getProject: () => StoryProject): void {

  // ─── story_log_setup ───
  server.registerTool(
    'story_log_setup',
    {
      title: 'Log Setup (Chekhov Gun)',
      description: 'Đánh dấu một chi tiết cài cắm mới (Chekhov\'s Gun) — một setup sẽ cần được payoff sau này.',
      inputSchema: z.object({
        setup: z.string().min(1).describe('Mô tả chi tiết cài cắm'),
        setupChapter: z.string().min(1).max(64).describe('Chương đặt chi tiết cài cắm (ví dụ: arc_01/ch_002)'),
        setupLine: z.string().optional().describe('Trích dẫn dòng cài cắm'),
        importance: z.enum(['minor', 'moderate', 'major']).default('moderate')
          .describe('Mức độ quan trọng'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo.');
      }

      const data = await project.getForeshadowing();

      const newItem: ForeshadowingItem = {
        id: generateId(),
        setup: params.setup,
        setupChapter: params.setupChapter,
        setupLine: params.setupLine,
        status: 'planted',
        importance: params.importance,
        createdAt: new Date().toISOString(),
      };

      data.items.push(newItem);
      await project.saveForeshadowing(data);

      const plantedCount = data.items.filter(i => i.status === 'planted').length;

      return {
        content: [{
          type: 'text' as const,
          text: `🌱 Chi tiết cài cắm đã được ghi nhận!

🆔 ID: ${newItem.id}
📝 Setup: ${newItem.setup}
📖 Chương: ${newItem.setupChapter}
⭐ Quan trọng: ${newItem.importance}
${newItem.setupLine ? `💬 Trích dẫn: "${newItem.setupLine}"` : ''}

🎯 Tổng "khẩu súng Chekhov" chưa bắn: ${plantedCount}`,
        }],
      };
    }
  );

  // ─── story_log_payoff ───
  server.registerTool(
    'story_log_payoff',
    {
      title: 'Log Payoff (Chekhov Gun)',
      description: 'Đánh dấu một chi tiết cài cắm đã được giải gỡ (payoff) — "khẩu súng Chekhov đã bắn".',
      inputSchema: z.object({
        id: z.string().describe('ID của chi tiết cài cắm cần payoff'),
        payoff: z.string().describe('Mô tả cách chi tiết đã được giải gỡ'),
        payoffChapter: z.string().describe('Chương giải gỡ (ví dụ: arc_01/ch_010)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo.');
      }

      const data = await project.getForeshadowing();
      const item = data.items.find(i => i.id === params.id);

      if (!item) {
        const available = data.items
          .filter(i => i.status === 'planted')
          .map(i => `  - ${i.id}: ${i.setup} [${i.importance}] (${i.setupChapter})`)
          .join('\n');
        return errResult(`❌ Không tìm thấy: ${params.id}\n\n🌱 Chi tiết chưa giải gỡ:\n${available || '  _Không có._'}`);
      }

      item.status = 'fired';
      item.payoff = params.payoff;
      item.payoffChapter = params.payoffChapter;
      item.firedAt = new Date().toISOString();

      await project.saveForeshadowing(data);

      const plantedCount = data.items.filter(i => i.status === 'planted').length;

      return {
        content: [{
          type: 'text' as const,
          text: `🎆 Chekhov's Gun đã bắn!

🆔 ID: ${item.id}
🌱 Setup: ${item.setup} (${item.setupChapter})
🎯 Payoff: ${params.payoff} (${params.payoffChapter})

📊 Còn lại ${plantedCount} chi tiết chưa giải gỡ.`,
        }],
      };
    }
  );

  // ─── story_list_unfired ───
  server.registerTool(
    'story_list_unfired',
    {
      title: 'List Unfired Chekhov Guns',
      description: 'Liệt kê tất cả các "khẩu súng Chekhov chưa bắn" — chi tiết đã cài cắm nhưng chưa được giải gỡ.',
      inputSchema: z.object({}),
    },
    async () => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo.');
      }

      const data = await project.getForeshadowing();
      const planted = data.items.filter(i => i.status === 'planted');

      if (planted.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: '✅ Không có chi tiết cài cắm nào chưa giải gỡ. Tuyệt vời!',
          }],
        };
      }

      const major = planted.filter(i => i.importance === 'major');
      const moderate = planted.filter(i => i.importance === 'moderate');
      const minor = planted.filter(i => i.importance === 'minor');

      const formatItem = (i: ForeshadowingItem) =>
        `  🆔 ${i.id}\n  📝 ${i.setup}\n  📖 Cài ở: ${i.setupChapter}\n  ${i.setupLine ? `💬 "${i.setupLine}"` : ''}\n`;

      let report = `🎯 Chekhov's Guns chưa bắn: ${planted.length}\n\n`;

      if (major.length > 0) {
        report += `🔴 MAJOR (${major.length}):\n${major.map(formatItem).join('\n')}\n`;
      }
      if (moderate.length > 0) {
        report += `🟡 MODERATE (${moderate.length}):\n${moderate.map(formatItem).join('\n')}\n`;
      }
      if (minor.length > 0) {
        report += `🟢 MINOR (${minor.length}):\n${minor.map(formatItem).join('\n')}\n`;
      }

      return {
        content: [{ type: 'text' as const, text: report }],
      };
    }
  );
}
