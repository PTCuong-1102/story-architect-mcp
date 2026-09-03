import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { StoryProject } from '../server/StoryProject.js';
import { errResult, requireProject, isToolError } from '../utils/mcpResults.js';
import { computeGodNodes } from '../utils/knowledgeGraph.js';
import { escapeHtml } from '../utils/markdownToHtml.js';

/**
 * Sinh dashboard HTML. Mọi dữ liệu người dùng đều qua escapeHtml
 * để ký tự như < > & trong tên truyện/plot hole không phá vỡ layout.
 */
export function generateDashboardHtml(
  configName: string,
  author: string,
  genre: string[],
  status: any,
  holes: any[],
  guns: any[],
  relationships: any[],
  characters: string[],
  sentimentCache: any
): string {
  const openHoles = holes.filter(h => h.status === 'open');
  const unfiredGuns = guns.filter(g => g.status === 'planted');
  const godNodes = computeGodNodes(relationships, 5);
  const extractedCount = relationships.filter((r: any) => r.provenance === 'extracted').length;
  const inferredCount = relationships.filter((r: any) => r.provenance === 'inferred').length;
  const toneLabel = sentimentCache?.overallTone || 'Chưa phân tích';
  const polarity = sentimentCache?.overallPolarity ?? 0;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(configName)} - Story Architect Dashboard</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-hover: #0284c7;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
      --border: #334155;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); padding: 2rem; line-height: 1.6; }
    .header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-end; }
    .title { font-size: 2rem; color: var(--accent); }
    .meta { color: var(--text-muted); font-size: 0.95rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .card { background-color: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
    .card h3 { font-size: 1.1rem; color: var(--text-muted); margin-bottom: 0.5rem; }
    .card .value { font-size: 2rem; font-weight: bold; color: var(--text); }
    .progress-bar-container { background-color: var(--border); border-radius: 8px; height: 12px; overflow: hidden; margin-top: 0.5rem; }
    .progress-bar { background-color: var(--accent); height: 100%; width: ${status.completionPercent || 0}%; transition: width 0.3s; }
    .section-title { font-size: 1.3rem; margin: 2rem 0 1rem; color: var(--accent); }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-muted); font-weight: 600; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.8rem; font-weight: bold; }
    .badge-danger { background-color: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .badge-warning { background-color: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .badge-success { background-color: rgba(34, 197, 94, 0.2); color: var(--success); }
    .footer { text-align: center; margin-top: 3rem; color: var(--text-muted); font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="title">${escapeHtml(configName)}</h1>
      <p class="meta">Tác giả: <b>${escapeHtml(author || 'Chưa thiết lập')}</b> | Thể loại: <b>${escapeHtml(genre.join(', ') || 'N/A')}</b></p>
    </div>
    <div class="meta">
      Tạo bởi <b>Story Architect MCP</b>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Tổng Số Từ</h3>
      <div class="value">${(status.totalWordCount || 0).toLocaleString()}</div>
      <div class="progress-bar-container">
        <div class="progress-bar"></div>
      </div>
      <p class="meta" style="margin-top: 0.5rem;">Tiến độ: ${status.completionPercent || 0}%</p>
    </div>
    <div class="card">
      <h3>Quy Mô Bản Thảo</h3>
      <div class="value">${status.chapterCount || 0} <span style="font-size: 1rem; color: var(--text-muted);">chương / ${status.arcCount || 0} arc</span></div>
      <p class="meta" style="margin-top: 0.5rem;">Nhân vật: ${characters.length}</p>
    </div>
    <div class="card">
      <h3>Plot Holes Cần Giải Quyết</h3>
      <div class="value" style="color: ${openHoles.length > 0 ? 'var(--danger)' : 'var(--success)'};">${openHoles.length}</div>
      <p class="meta" style="margin-top: 0.5rem;">Tổng số đã ghi: ${holes.length}</p>
    </div>
    <div class="card">
      <h3>Chekhov's Guns Đang Cài</h3>
      <div class="value" style="color: ${unfiredGuns.length > 0 ? 'var(--warning)' : 'var(--text)'};">${unfiredGuns.length}</div>
      <p class="meta" style="margin-top: 0.5rem;">Đã giải quyết: ${guns.length - unfiredGuns.length}</p>
    </div>
  </div>

  <h2 class="section-title">⚠️ Lỗ Hổng Cốt Truyện Đang Mở (Open Plot Holes)</h2>
  <div class="card" style="padding: 0; overflow-x: auto;">
    <table>
      <thead>
        <tr>
          <th>Tiêu đề</th>
          <th>Mức độ</th>
          <th>Chương liên quan</th>
          <th>Mô tả</th>
        </tr>
      </thead>
      <tbody>
        ${openHoles.length > 0 ? openHoles.map(h => `
          <tr>
            <td><b>${escapeHtml(h.title)}</b></td>
            <td><span class="badge ${h.severity === 'critical' || h.severity === 'high' ? 'badge-danger' : 'badge-warning'}">${escapeHtml(h.severity)}</span></td>
            <td>${escapeHtml(h.chapters.join(', ') || 'Toàn bộ')}</td>
            <td>${escapeHtml(h.description)}</td>
          </tr>
        `).join('') : '<tr><td colspan="4" style="text-align: center; color: var(--success); padding: 1.5rem;">🎉 Không có plot hole nào đang mở!</td></tr>'}
      </tbody>
    </table>
  </div>

  <h2 class="section-title">🔫 Chi Tiết Cài Cắm Chưa Kích Hoạt (Unfired Chekhov's Guns)</h2>
  <div class="card" style="padding: 0; overflow-x: auto;">
    <table>
      <thead>
        <tr>
          <th>Chi tiết Setup</th>
          <th>Chương cài</th>
          <th>Mức độ quan trọng</th>
        </tr>
      </thead>
      <tbody>
        ${unfiredGuns.length > 0 ? unfiredGuns.map(g => `
          <tr>
            <td><b>${escapeHtml(g.setup)}</b></td>
            <td><code>${escapeHtml(g.setupChapter)}</code></td>
            <td><span class="badge badge-warning">${escapeHtml(g.importance)}</span></td>
          </tr>
        `).join('') : '<tr><td colspan="3" style="text-align: center; color: var(--success); padding: 1.5rem;">Tất cả chi tiết cài cắm đã được giải gỡ!</td></tr>'}
      </tbody>
    </table>
  </div>

  <h2 class="section-title">🌟 Nhân Vật Trung Tâm (God-Nodes) & Nguồn Gốc Quan Hệ</h2>
  <div class="card" style="padding: 0; overflow-x: auto;">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Nhân vật</th>
          <th>Bậc (số mối quan hệ)</th>
        </tr>
      </thead>
      <tbody>
        ${godNodes.length > 0 ? godNodes.map((g, i) => `
          <tr>
            <td>${i + 1}</td>
            <td><b>${escapeHtml(g.name)}</b></td>
            <td>${g.degree}</td>
          </tr>
        `).join('') : '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Chưa có mối quan hệ nào trong đồ thị.</td></tr>'}
      </tbody>
    </table>
    <p class="meta" style="padding: 1rem 1.5rem;">🏷️ Nguồn gốc cạnh: <b>EXTRACTED</b> (người khẳng định): ${extractedCount} • <b>INFERRED</b> (máy suy ra): ${inferredCount} • <b>LEGACY</b> (dữ liệu cũ): ${relationships.length - extractedCount - inferredCount}</p>
  </div>

  <div class="footer">
    Báo cáo được tạo tự động bởi story-architect-mcp • Ngày tạo: ${new Date().toLocaleString('vi-VN')}
  </div>
</body>
</html>`;
}

export function registerDashboardTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_generate_dashboard',
    {
      title: 'Generate Visual HTML Story Dashboard',
      description: 'Xuất một trang Dashboard trực quan hóa dạng HTML độc lập tại export/dashboard.html, tổng hợp số từ, tiến độ, danh sách plot holes, Chekhov guns và nhân vật.',
      inputSchema: z.object({
        outputPath: z.string().optional().describe('Đường dẫn file HTML xuất ra (mặc định: export/dashboard.html)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;
      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const config = await project.getConfig();
      const status = await project.getStatus();
      const holes = await project.getPlotHoles();
      const guns = await project.getForeshadowing();
      const rels = await project.getRelationships();
      const chars = await project.listCharacters();
      const sentiment = await project.getSentimentCache();

      const exportDir = path.join(project.projectPath, 'export');
      await fs.mkdir(exportDir, { recursive: true });

      const targetPath = params.outputPath || path.join(exportDir, 'dashboard.html');
      const htmlContent = generateDashboardHtml(
        config.name,
        config.author,
        config.genre,
        status,
        holes.holes,
        guns.items,
        rels.relationships,
        chars,
        sentiment
      );

      await fs.writeFile(targetPath, htmlContent, 'utf-8');

      return {
        content: [{
          type: 'text' as const,
          text: `✅ Đã tạo thành công Story Dashboard HTML!

📁 File: \`${targetPath}\`

📊 Thông tin tổng hợp:
- Tác phẩm: ${config.name} (${status.totalWordCount.toLocaleString()} từ)
- Tiến độ: ${status.completionPercent}%
- Plot Holes đang mở: ${holes.holes.filter(h => h.status === 'open').length}
- Chekhov's guns chờ giải quyết: ${guns.items.filter(g => g.status === 'planted').length}

💡 Bạn có thể mở trực tiếp file \`${targetPath}\` bằng trình duyệt web để xem giao diện Dashboard trực quan.`,
        }],
      };
    }
  );
}
