import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import { countWords } from '../../utils/wordCount.js';
import { loadOrBuildIndex, searchEntities, expandRelationships, findShortestPath, provenanceTag } from '../../utils/knowledgeGraph.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';

export function registerQueryContextTool(server: McpServer, getProject: () => StoryProject): void {
  server.registerTool(
    'story_query_context',
    {
      title: 'Query Context Budget',
      description: 'Trích xuất và tổng hợp Context Budget tối ưu nhất bằng Knowledge Graph (Bible + Relationships + Timeline) kết hợp ngân sách token. Truyền from+to để hỏi đường liên hệ ngắn nhất giữa hai nhân vật.',
      inputSchema: z.object({
        query: z.string().describe('Chủ đề hoặc từ khóa cần lấy context (ví dụ: "Tiêu Viêm Thanh Vân Sơn")'),
        budgetTokens: z.number().default(2000).describe('Ngân sách token tối đa cho context (mặc định 2000 tokens ~ 1500 từ)'),
        maxDepth: z.number().default(2).describe('Độ sâu mở rộng quan hệ nhân vật (BFS) trong đồ thị'),
        rebuildIndex: z.boolean().default(false).describe('Buộc build lại index .cbm/index.json từ dữ liệu mới nhất'),
        from: z.string().optional().describe('Nhân vật xuất phát cho truy vấn đường đi (đi kèm to)'),
        to: z.string().optional().describe('Nhân vật đích cho truy vấn đường đi (đi kèm from)'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;

      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const config = await project.getConfig();
      const styleGuide = await project.getStyleGuide();
      const holes = await project.getPlotHoles();
      const foreshadowing = await project.getForeshadowing();

      // ─── Knowledge Graph: tìm thực thể + mở rộng quan hệ ───
      const index = await loadOrBuildIndex(project, params.rebuildIndex);

      // ─── Chế độ đường đi: from + to → đường ngắn nhất giữa hai nhân vật ───
      if (params.from && params.to) {
        const path = findShortestPath(index, params.from, params.to);
        if (!path) {
          const known = [...new Set(index.relationships.flatMap(r => [r.source, r.target]))].sort();
          return errResult(`❌ Không tìm thấy đường liên hệ giữa "${params.from}" và "${params.to}".\n\n💡 Kiểm tra tên nhân vật (phân biệt hoa/thường không quan trọng, chấp nhận alias). Các nhân vật đang có trong đồ thị: ${known.join(', ') || 'N/A'}`);
        }
        const hops = path.edges.length;
        const hopLines = path.edges.map((e, i) => {
          const hopDesc = e.description ? ` — ${e.description}` : '';
          return `${i + 1}. ${path.nodes[i]} --[${e.type}, ${provenanceTag(e.provenance)}]--> ${path.nodes[i + 1]}${hopDesc}`;
        });
        const inferredCount = path.edges.filter(e => provenanceTag(e.provenance) === 'INFERRED').length;
        return {
          content: [{
            type: 'text' as const,
            text: `🛤️ Đường liên hệ ngắn nhất: ${path.nodes[0]} → ${path.nodes[path.nodes.length - 1]} (${hops} hop${hops !== 1 ? 's' : ''})\n\n${hopLines.join('\n')}\n\n🏷️ Nguồn gốc cạnh: EXTRACTED = người khẳng định, INFERRED = máy suy ra từ đồng xuất hiện, LEGACY = dữ liệu cũ.${inferredCount > 0 ? `\n⚠️ ${inferredCount}/${hops} cạnh là INFERRED — nên xác minh trước khi dùng cho quyết định cốt truyện.` : ''}`,
          }],
        };
      }
      if ((params.from && !params.to) || (!params.from && params.to)) {
        return errResult('❌ Truy vấn đường đi cần cả hai tham số: from và to (ví dụ: from="Tiêu Viêm", to="Na Lan").');
      }

      const matches = searchEntities(index, params.query).slice(0, 5);

      const matchedCharacters = matches.filter(m => m.kind === 'character');
      const matchedWorld = matches.filter(m => m.kind === 'world').map(m => m.name);

      const { edges, relatedNames } = expandRelationships(
        index,
        matchedCharacters.map(m => m.name),
        params.maxDepth
      );

      // ─── Gom context ───
      const contextBlocks: string[] = [];

      contextBlocks.push(`# Context Budget cho Query: "${params.query}"\n`);
      contextBlocks.push(`## Quy chuẩn dự án\n- Tên truyện: ${config.name}\n- POV: ${config.pov} | Thì: ${config.tense}\n- Phong cách: ${styleGuide.voiceDescription || 'N/A'}\n`);

      if (matchedCharacters.length > 0) {
        const parts: string[] = [];
        for (const m of matchedCharacters) {
          const profile = m.ref ? await project.getCharacter(m.ref) : null;
          parts.push(`### Nhân vật: ${m.name}\n${profile?.content || '_Chưa có hồ sơ._'}`);
        }
        contextBlocks.push(`## Hồ sơ nhân vật liên quan\n${parts.join('\n\n')}\n`);
      }

      if (matchedWorld.length > 0) {
        const parts: string[] = [];
        for (const entryName of matchedWorld) {
          const entry = await project.getWorldEntry(entryName);
          parts.push(`### Bối cảnh: ${entryName}\n${entry || '_Chưa có thông tin._'}`);
        }
        contextBlocks.push(`## Thế giới & Bối cảnh liên quan\n${parts.join('\n\n')}\n`);
      }

      // Mở rộng đồ thị: các quan hệ và nhân vật liên quan qua BFS
      if (edges.length > 0) {
        const edgeText = edges
          .map(e => `- ${e.source} ↔ ${e.target}: ${e.type} [${provenanceTag(e.provenance)}]${e.description ? ` — ${e.description}` : ''}`)
          .join('\n');
        contextBlocks.push(`## Đồ thị quan hệ (mở rộng độ sâu ${params.maxDepth})\n${edgeText}\n_Nhãn nguồn gốc: EXTRACTED = người khẳng định, INFERRED = máy suy ra, LEGACY = dữ liệu cũ._\n`);
        if (relatedNames.length > 0) {
          contextBlocks.push(`## Nhân vật liên quan khác\n${relatedNames.map(n => `- ${n}`).join('\n')}\n`);
        }
      }

      const unfiredGuns = foreshadowing.items
        .filter(i => i.status === 'planted')
        .map(i => `- [${i.importance}] ${i.setup} (cài ở ${i.setupChapter})`)
        .join('\n');
      if (unfiredGuns) {
        contextBlocks.push(`## Chekhov's Guns chưa bắn\n${unfiredGuns}\n`);
      }

      const openHoles = holes.holes
        .filter(h => h.status === 'open')
        .map(h => `- [${h.severity}] ${h.title}: ${h.description}`)
        .join('\n');
      if (openHoles) {
        contextBlocks.push(`## Plot Holes đang mở\n${openHoles}\n`);
      }

      let assembledText = contextBlocks.join('\n');
      const estimatedTokens = Math.round(countWords(assembledText) * 1.33);

      // Cắt giảm nếu vượt ngân sách token
      if (estimatedTokens > params.budgetTokens) {
        const maxWords = Math.round(params.budgetTokens / 1.33);
        const words = assembledText.split(/\s+/);
        assembledText = words.slice(0, maxWords).join(' ') + '\n\n_[Đã cắt giảm để vừa ngân sách token]_';
      }

      return {
        content: [{
          type: 'text' as const,
          text: assembledText,
        }],
      };
    }
  );
}
