import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { StoryProject } from '../server/StoryProject.js';

/**
 * Đăng ký tất cả MCP Resources vào server.
 */
export function registerResources(server: McpServer, getProject: () => StoryProject): void {

  // ─── story://status ───
  server.registerResource(
    'story-status',
    'story://status',
    { title: 'Story Status', description: 'Trạng thái dự án & word count', mimeType: 'application/json' },
    async () => {
      const project = getProject();
      const status = await project.getStatus();
      return {
        contents: [{
          uri: 'story://status',
          mimeType: 'application/json',
          text: JSON.stringify(status, null, 2),
        }],
      };
    }
  );

  // ─── story://config ───
  server.registerResource(
    'story-config',
    'story://config',
    { title: 'Story Config', description: 'Cấu hình dự án (POV, Tense, Thể loại...)', mimeType: 'application/json' },
    async () => {
      const project = getProject();
      const config = await project.getConfig();
      return {
        contents: [{
          uri: 'story://config',
          mimeType: 'application/json',
          text: JSON.stringify(config, null, 2),
        }],
      };
    }
  );

  // ─── story://timeline ───
  server.registerResource(
    'story-timeline',
    'story://timeline',
    { title: 'Story Timeline', description: 'Timeline tổng thể câu chuyện', mimeType: 'application/json' },
    async () => {
      const project = getProject();
      const timeline = await project.getTimeline();
      return {
        contents: [{
          uri: 'story://timeline',
          mimeType: 'application/json',
          text: JSON.stringify(timeline, null, 2),
        }],
      };
    }
  );

  // ─── story://holes ───
  server.registerResource(
    'story-holes',
    'story://holes',
    { title: 'Plot Holes', description: 'Danh sách plot holes chưa giải quyết', mimeType: 'application/json' },
    async () => {
      const project = getProject();
      const holes = await project.getPlotHoles();
      const openHoles = holes.holes.filter(h => h.status === 'open');
      return {
        contents: [{
          uri: 'story://holes',
          mimeType: 'application/json',
          text: JSON.stringify({ count: openHoles.length, holes: openHoles }, null, 2),
        }],
      };
    }
  );

  // ─── story://foreshadowing ───
  server.registerResource(
    'story-foreshadowing',
    'story://foreshadowing',
    { title: 'Chekhov Guns', description: 'Danh sách các chi tiết cài cắm (Setups chưa Payoff)', mimeType: 'application/json' },
    async () => {
      const project = getProject();
      const data = await project.getForeshadowing();
      const planted = data.items.filter(i => i.status === 'planted');
      return {
        contents: [{
          uri: 'story://foreshadowing',
          mimeType: 'application/json',
          text: JSON.stringify({
            totalItems: data.items.length,
            unfiredCount: planted.length,
            unfiredItems: planted,
            firedItems: data.items.filter(i => i.status === 'fired'),
          }, null, 2),
        }],
      };
    }
  );

  // ─── story://relationships ───
  server.registerResource(
    'story-relationships',
    'story://relationships',
    { title: 'Relationships', description: 'Ma trận quan hệ nhân vật hiện tại', mimeType: 'application/json' },
    async () => {
      const project = getProject();
      const data = await project.getRelationships();
      return {
        contents: [{
          uri: 'story://relationships',
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      };
    }
  );

  // ─── story://bible/characters/{name} (Resource Template) ───
  server.registerResource(
    'character-profile',
    new ResourceTemplate('story://bible/characters/{name}', { list: undefined }),
    { title: 'Character Profile', description: 'Hồ sơ chi tiết nhân vật', mimeType: 'text/markdown' },
    async (uri, params) => {
      const project = getProject();
      const name = params.name as string;
      const character = await project.getCharacter(name);
      if (!character) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Không tìm thấy nhân vật: ${name}`,
          }],
        };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: `# ${name}\n\n${JSON.stringify(character.frontmatter, null, 2)}\n\n${character.content}`,
        }],
      };
    }
  );

  // ─── story://bible/world/{location} (Resource Template) ───
  server.registerResource(
    'world-entry',
    new ResourceTemplate('story://bible/world/{location}', { list: undefined }),
    { title: 'World Entry', description: 'Thông tin bối cảnh/địa danh', mimeType: 'text/markdown' },
    async (uri, params) => {
      const project = getProject();
      const location = params.location as string;
      const content = await project.getWorldEntry(location);
      if (!content) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Không tìm thấy địa danh: ${location}`,
          }],
        };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: content,
        }],
      };
    }
  );

  // ─── story://manuscript/{arc}/{chapter} (Resource Template) ───
  server.registerResource(
    'manuscript-chapter',
    new ResourceTemplate('story://manuscript/{arc}/{chapter}', { list: undefined }),
    { title: 'Manuscript Chapter', description: 'Nội dung bản thảo từng chương', mimeType: 'text/markdown' },
    async (uri, params) => {
      const project = getProject();
      const arc = params.arc as string;
      const chapter = params.chapter as string;
      const content = await project.getChapterContent(arc, chapter);
      if (!content) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Không tìm thấy chương: ${arc}/${chapter}`,
          }],
        };
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'text/markdown',
          text: content,
        }],
      };
    }
  );
}
