/**
 * Smoke test toàn bộ MCP surface (21 tools + 6 resources + 3 templates + 5 prompts)
 * qua InMemoryTransport THẬT của SDK — tái hiện đúng đường đi của client thực.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { McpServer, InMemoryTransport, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';

import { StoryProject } from '../src/server/StoryProject.js';
import { registerResources } from '../src/resources/index.js';
import { registerPrompts } from '../src/prompts/index.js';
import { registerProjectManagerTools } from '../src/tools/projectManager.js';
import { registerInitTool } from '../src/tools/init.js';
import { registerExportTool } from '../src/tools/export.js';
import { registerScanMessyProjectTool } from '../src/tools/rescue/scanMessyProject.js';
import { registerAutoRefactorTool } from '../src/tools/rescue/autoRefactorStructure.js';
import { registerSnapshotTools } from '../src/tools/rescue/snapshot.js';
import { registerPlotHoleTools } from '../src/tools/management/plotHoles.js';
import { registerStatsTool } from '../src/tools/management/stats.js';
import { registerForeshadowingTools } from '../src/tools/management/foreshadowing.js';
import { registerExtractEntitiesTool } from '../src/tools/graph/extractEntities.js';
import { registerMapRelationshipsTool } from '../src/tools/graph/mapRelationships.js';
import { registerQueryContextTool } from '../src/tools/graph/queryContext.js';
import { registerDetectTimelineTool } from '../src/tools/analysis/detectTimeline.js';
import { registerAnalyzePacingTool } from '../src/tools/analysis/analyzePacing.js';
import { registerAnalyzeVoiceTool } from '../src/tools/analysis/analyzeVoice.js';
import { registerGenerateWritingPromptTool } from '../src/tools/generatePrompt.js';

const ROOT = '/tmp/opencode/smoke-e2e';

// ─── Mini JSON-RPC client ───
class MiniClient {
  private nextId = 1;
  private pending = new Map<number, (v: any) => void>();
  notifications: any[] = [];
  constructor(private t: any) {
    t.onmessage = (msg: any) => {
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const res = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        res(msg);
      } else {
        this.notifications.push(msg);
      }
    };
  }
  request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`TIMEOUT ${method}`));
      }, 20000);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.t.send({ jsonrpc: '2.0', id, method, params }).catch((e: Error) => { clearTimeout(timer); reject(e); });
    });
  }
  notify(method: string, params?: any) {
    return this.t.send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }
}

const results: { name: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }[] = [];
function report(name: string, status: 'PASS' | 'FAIL' | 'WARN', detail = '') {
  results.push({ name, status, detail });
}

async function call(client: MiniClient, toolName: string, args: any): Promise<{ text: string; isError: boolean; raw: any }> {
  const resp = await client.request('tools/call', { name: toolName, arguments: args });
  if (resp.error) {
    return { text: JSON.stringify(resp.error), isError: true, raw: resp };
  }
  const r = resp.result ?? {};
  const text = (r.content || []).map((c: any) => c.text || '').join('\n');
  return { text, isError: !!r.isError, raw: r };
}

async function main() {
  // ─── Seed dữ liệu mẫu ───
  await fs.rm(ROOT, { recursive: true, force: true });
  const novelDir = path.join(ROOT, 'novel');
  const p = new StoryProject(novelDir);
  await p.initializeProject({ name: 'Truyện Kiểm Thử', author: 'Tác Giả', genre: ['Fantasy'], targetWordCount: 50000 });

  const ch1 = `"Ngươi là ai?" Hắn gào lên, tay nắm chặt thanh kiếm.\nGió cuốn qua Thanh Vân Sơn, máu thơm thoang thoảng.\nNàng bước ra từ bóng tối, ánh mắt nguy hiểm.\n\n"Hắn đã giết sư phụ ta!" Nàng hét lớn.\nChém! Một nhát đao vung tới, vỡ tan đá đen.\nHắn chạy trốn vào rừng sâu, tim đập dữ dội.`;
  const ch2 = `Nàng ngồi bên hồ, nhớ về ngày xưa.\n"Mình phải mạnh mẽ hơn," nàng tự nhủ với bản thân tôi.\nMặt nước phẳng lặng như gương, im ắng kỳ lạ.\n\nĐêm xuống, sao trời lấp lánh trên đỉnh Cửu Long Thần Đỉnh.\nMột tiếng động bất ngờ vang lên từ hang động.\n"Nàng có nghe thấy không?" hắn thì thầm, sợ hãi.`;
  await fs.writeFile(path.join(novelDir, 'manuscript/arc_01/ch_001.md'), ch1);
  await fs.writeFile(path.join(novelDir, 'manuscript/arc_01/ch_002.md'), ch2);
  await fs.mkdir(path.join(novelDir, 'manuscript/arc_02'), { recursive: true });
  await fs.writeFile(path.join(novelDir, 'manuscript/arc_02/ch_001.md'), 'Cao trào arc hai. "Đấu đi!" Kiếm chém xuống, chết!');

  await fs.writeFile(path.join(novelDir, 'bible/characters/linh_hon.md'), `---\nname: "Linh Hồn"\nrole: "protagonist"\naliases:\n  - "LHS"\ngoals:\n  - "Trả thù sư phụ"\n---\n\n# Linh Hồn\n\nNữ chính bí ẩn, sử dụng kiếm pháp Thanh Vân.`);
  await fs.writeFile(path.join(novelDir, 'bible/world/thanh_van_son.md'), `---\nname: "Thanh Vân Sơn"\ntype: "location"\n---\n\n# Thanh Vân Sơn\n\nNgọn núi nơi môn phái sinh sống, bị thiêu rụi năm trước.`);

  await fs.mkdir(path.join(novelDir, 'outline/arc_01'), { recursive: true });
  await fs.writeFile(path.join(novelDir, 'outline/arc_01/ch_003_outline.md'), '# Chương 3\n- Linh Hồn tìm thấy manh mối\n- Đối đầu Hắc Long lần đầu');

  await p.saveStyleGuide({ voiceDescription: 'Sảng văn cổ trang, câu ngắn', avoidWords: ['rất là'] } as any);
  await p.saveTimeline({
    events: [
      { id: 'evt_1', label: 'Môn phái bị diệt', description: '', chapter: 'arc_01/ch_001', relativeOrder: 1, characters: [] },
      { id: 'evt_2', label: 'Linh Hồn khởi hành', description: '', chapter: 'arc_01/ch_002', relativeOrder: 2, characters: [] },
      { id: 'evt_3', label: 'Sự kiện tương lai', description: '', chapter: 'arc_02/ch_001', absoluteDate: '2027-05-01', relativeOrder: 5, characters: [] },
    ],
  } as any);

  // Thư mục messy để test scan/refactor
  const messyDir = path.join(ROOT, 'messy');
  await fs.mkdir(messyDir, { recursive: true });
  await fs.writeFile(path.join(messyDir, 'ch_001.txt'), Array(600).fill('nội dung chương viết dở').join(' '));
  await fs.writeFile(path.join(messyDir, 'ch_001_copy.txt'), Array(600).fill('nội dung chương viết dở').join(' '));
  await fs.writeFile(path.join(messyDir, 'character_card.md'), '# Nhân vật\n- Tên: A');
  await fs.writeFile(path.join(messyDir, 'notes.txt'), 'ý tưởng nhỏ');

  // ─── Dựng server đúng như index.ts ───
  let currentProject: StoryProject | null = null;
  const getProject = (): StoryProject => {
    if (!currentProject) throw new Error('Chưa thiết lập dự án. Hãy gọi tool story_set_project trước.');
    return currentProject;
  };
  const setProject = (pp: string): StoryProject => { currentProject = new StoryProject(path.resolve(pp)); return currentProject; };
  const getCurrentPath = (): string | null => currentProject?.projectPath ?? null;

  const server = new McpServer({ name: 'story-architect-mcp', version: '0.1.0-smoke' });
  registerResources(server, getProject);
  registerPrompts(server, getProject);
  registerProjectManagerTools(server, setProject, () => currentProject, getCurrentPath);
  registerInitTool(server, getProject);
  registerExportTool(server, getProject);
  registerScanMessyProjectTool(server, getProject);
  registerAutoRefactorTool(server, getProject);
  registerSnapshotTools(server, getProject);
  registerPlotHoleTools(server, getProject);
  registerStatsTool(server, getProject);
  registerForeshadowingTools(server, getProject);
  registerExtractEntitiesTool(server, getProject);
  registerMapRelationshipsTool(server, getProject);
  registerQueryContextTool(server, getProject);
  registerDetectTimelineTool(server, getProject);
  registerAnalyzePacingTool(server, getProject);
  registerAnalyzeVoiceTool(server, getProject);
  registerGenerateWritingPromptTool(server, getProject);

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new MiniClient(clientT);
  await server.connect(serverT);

  // Handshake
  const versions = (SUPPORTED_PROTOCOL_VERSIONS as unknown as string[]) ?? [];
  const initResp = await client.request('initialize', {
    protocolVersion: versions[versions.length - 1] || '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke-client', version: '0.0.1' },
  });
  if (initResp.error) report('initialize handshake', 'FAIL', JSON.stringify(initResp.error));
  else report('initialize handshake', 'PASS', `protocol=${initResp.result?.protocolVersion}`);
  await client.notify('notifications/initialized');

  // tools/list
  let listedNames: string[] = [];
  try {
    const tl = await client.request('tools/list', {});
    if (tl.error) throw new Error(JSON.stringify(tl.error));
    listedNames = (tl.result?.tools || []).map((t: any) => t.name);
    report('tools/list', listedNames.length === 21 ? 'PASS' : 'WARN', `${listedNames.length} tools`);
  } catch (e: any) { report('tools/list', 'FAIL', e.message); }

  const extractId = (text: string): string | null => (text.match(/ID: (\S+)/) || [])[1] || null;
  const okText = (t: string) => !t.includes('❌') && !t.includes('⚠️') ? '' : '';

  let holeId: string | null = null;
  let setupId: string | null = null;
  let snapId: string | null = null;

  // ══════════ TOOLS ══════════
  {
    const r = await call(client, 'story_set_project', { projectPath: novelDir });
    r.isError || r.text.includes('❌') ? report('story_set_project', 'FAIL', r.text.slice(0, 200)) : report('story_set_project', 'PASS');
  }
  {
    // init trên thư mục TRỐNG mới (novel đã init nên sẽ trả cảnh báo)
    const emptyDir = path.join(ROOT, 'brand-new');
    await fs.mkdir(emptyDir, { recursive: true });
    await call(client, 'story_set_project', { projectPath: emptyDir });
    const r = await call(client, 'story_init', { name: 'Truyện Mới', author: 'A', genre: ['Xianxia'], pov: 'third-limited', tense: 'past', language: 'vi', targetWordCount: 100000 });
    r.isError || r.text.includes('❌') ? report('story_init (fresh)', 'FAIL', r.text.slice(0, 300)) : report('story_init (fresh)', 'PASS');
    await call(client, 'story_set_project', { projectPath: novelDir });
    const again = await call(client, 'story_init', { name: 'X' });
    again.isError || !again.text.includes('đã được khởi tạo trước đó') ? report('story_init (already)', 'WARN', again.text.slice(0, 120)) : report('story_init (already)', 'PASS');
  }
  {
    const r = await call(client, 'story_get_project_info', {});
    r.isError || r.text.includes('❌') ? report('story_get_project_info', 'FAIL', r.text.slice(0, 300)) : report('story_get_project_info', 'PASS');
  }
  {
    const r = await call(client, 'story_stats', {});
    r.isError || r.text.includes('❌') ? report('story_stats', 'FAIL', r.text.slice(0, 400)) : report('story_stats', 'PASS');
  }
  {
    const r = await call(client, 'story_log_plot_hole', { title: 'Tuổi không khớp', description: 'Nhân vật A 16 tuổi nhưng chương 1 nói 18.', severity: 'high', chapters: ['arc_01/ch_001'] });
    holeId = extractId(r.text);
    r.isError || !holeId ? report('story_log_plot_hole', 'FAIL', r.text.slice(0, 300)) : report('story_log_plot_hole', 'PASS');
  }
  {
    const r = await call(client, 'story_resolve_plot_hole', { id: holeId, resolution: 'Đã sửa lại tuổi thành 18 thống nhất.', status: 'resolved' });
    r.isError || r.text.includes('❌') ? report('story_resolve_plot_hole', 'FAIL', r.text.slice(0, 300)) : report('story_resolve_plot_hole', 'PASS');
  }
  {
    const r = await call(client, 'story_log_setup', { setup: 'Áo bào rách của sư phụ', setupChapter: 'arc_01/ch_001', setupLine: 'tấm áo bạc màu', importance: 'major' });
    setupId = extractId(r.text);
    r.isError || !setupId ? report('story_log_setup', 'FAIL', r.text.slice(0, 300)) : report('story_log_setup', 'PASS');
  }
  {
    const r = await call(client, 'story_list_unfired', {});
    r.isError || r.text.includes('❌') ? report('story_list_unfired', 'FAIL', r.text.slice(0, 200)) : report('story_list_unfired', 'PASS');
  }
  {
    const r = await call(client, 'story_log_payoff', { id: setupId, payoff: 'Nàng mặc lại tấm áo trong trận quyết đấu.', payoffChapter: 'arc_02/ch_001' });
    r.isError || r.text.includes('❌') ? report('story_log_payoff', 'FAIL', r.text.slice(0, 300)) : report('story_log_payoff', 'PASS');
  }
  {
    const dry = await call(client, 'story_extract_entities_to_bible', { arc: 'arc_01', chapter: 'ch_001', confirm: false });
    const exec = await call(client, 'story_extract_entities_to_bible', { arc: 'arc_01', chapter: 'ch_001', confirm: true });
    (dry.isError || exec.isError) ? report('story_extract_entities_to_bible', 'FAIL', (dry.text + exec.text).slice(0, 300)) : report('story_extract_entities_to_bible', 'PASS');
  }
  {
    const auto = await call(client, 'story_map_relationships', { minChapters: 2 });
    const manual = await call(client, 'story_map_relationships', { source: 'Linh Hồn', target: 'Thanh Vân Sơn', type: 'ally', description: 'Quê hương', chapter: 'arc_01/ch_002' });
    (auto.isError || manual.isError) ? report('story_map_relationships', 'FAIL', (auto.text + manual.text).slice(0, 400)) : report('story_map_relationships', 'PASS', auto.text.includes('không tìm thấy cặp') ? 'auto-scan: no pair' : '');
  }
  {
    const r = await call(client, 'story_query_context', { query: 'Linh Hồn Thanh Vân Sơn' });
    r.isError || r.text.includes('❌') ? report('story_query_context', 'FAIL', r.text.slice(0, 400)) : report('story_query_context', 'PASS');
  }
  {
    const r1 = await call(client, 'story_detect_timeline_conflicts', {});
    const r2 = await call(client, 'story_detect_timeline_conflicts', { addEvent: { label: 'Về thôn cũ', chapter: 'arc_02/ch_001', absoluteDate: '2026-03-10', relativeOrder: 3 } });
    (r1.isError || r2.isError) ? report('story_detect_timeline_conflicts', 'FAIL', (r1.text + r2.text).slice(0, 400)) : report('story_detect_timeline_conflicts', 'PASS', r1.text.includes('mermaid') ? 'flowchart timeline ok' : 'no mermaid?');
  }
  {
    const r = await call(client, 'story_analyze_pacing', { arc: 'arc_01' });
    r.isError || r.text.includes('❌') ? report('story_analyze_pacing', 'FAIL', r.text.slice(0, 400)) : report('story_analyze_pacing', 'PASS');
  }
  {
    const r = await call(client, 'story_analyze_voice', { arc: 'arc_01' });
    r.isError || r.text.includes('❌') ? report('story_analyze_voice', 'FAIL', r.text.slice(0, 500)) : report('story_analyze_voice', 'PASS');
  }
  {
    const r = await call(client, 'story_scan_messy_project', { path: messyDir });
    r.isError || r.text.includes('❌') ? report('story_scan_messy_project', 'FAIL', r.text.slice(0, 500)) : report('story_scan_messy_project', 'PASS');
  }
  {
    const preview = await call(client, 'story_auto_refactor_structure', { projectPath: messyDir, confirm: false });
    const exec = await call(client, 'story_auto_refactor_structure', { projectPath: messyDir, confirm: true });
    (preview.isError || exec.isError) ? report('story_auto_refactor_structure', 'FAIL', (preview.text + exec.text).slice(0, 500)) : report('story_auto_refactor_structure', 'PASS');
  }
  {
    const r = await call(client, 'story_snapshot', { label: 'smoke', description: 'snapshot kiểm thử' });
    snapId = extractId(r.text);
    r.isError || !snapId ? report('story_snapshot', 'FAIL', r.text.slice(0, 300)) : report('story_snapshot', 'PASS');
  }
  {
    const prev = await call(client, 'story_rollback', { snapshotId: snapId, confirm: false });
    const exec = await call(client, 'story_rollback', { snapshotId: snapId, confirm: true });
    (prev.isError || exec.isError || !exec.text.includes('Rollback hoàn tất')) ? report('story_rollback', 'FAIL', (prev.text + exec.text).slice(0, 400)) : report('story_rollback', 'PASS');
  }
  {
    const r = await call(client, 'story_generate_writing_prompt', { arc: 'arc_01', chapter: 'ch_003', strategy: 'continue' });
    r.isError || r.text.includes('❌') ? report('story_generate_writing_prompt', 'FAIL', r.text.slice(0, 400)) : report('story_generate_writing_prompt', 'PASS');
  }
  for (const fmt of ['markdown_single', 'html', 'epub', 'docx']) {
    const r = await call(client, 'story_export', { format: fmt });
    r.isError || r.text.includes('❌') ? report(`story_export (${fmt})`, 'FAIL', r.text.slice(0, 300)) : report(`story_export (${fmt})`, 'PASS');
  }

  // ══════════ RESOURCES ══════════
  try {
    const rl = await client.request('resources/list', {});
    const uris: string[] = (rl.result?.resources || []).map((r: any) => r.uri);
    report('resources/list', uris.length === 6 ? 'PASS' : 'WARN', `${uris.length} static`);
    for (const uri of uris) {
      const rr = await client.request('resources/read', { uri });
      rr.error ? report(`read ${uri}`, 'FAIL', JSON.stringify(rr.error).slice(0, 250))
        : report(`read ${uri}`, 'PASS');
    }
    const tpl = await client.request('resources/templates/list', {});
    const tplUris: string[] = (tpl.result?.resourceTemplates || []).map((r: any) => r.uriTemplate);
    report('resources/templates/list', tplUris.length === 3 ? 'PASS' : 'WARN', `${tplUris.length} templates`);
    for (const [uri, label] of [
      ['story://bible/characters/linh_hon', 'char'],
      ['story://bible/world/thanh_van_son', 'world'],
      ['story://manuscript/arc_01/ch_001', 'chapter'],
    ] as const) {
      const rr = await client.request('resources/read', { uri });
      rr.error ? report(`template ${label}`, 'FAIL', JSON.stringify(rr.error).slice(0, 250))
        : report(`template ${label}`, 'PASS');
    }
  } catch (e: any) { report('resources', 'FAIL', e.message); }

  // ══════════ PROMPTS ══════════
  try {
    const pl = await client.request('prompts/list', {});
    const names: string[] = (pl.result?.prompts || []).map((p2: any) => p2.name);
    report('prompts/list', names.length === 5 ? 'PASS' : 'WARN', `${names.length} prompts`);
    const cases: Record<string, any> = {
      'write-next-chapter': { arguments: { arc: 'arc_01', chapter: 'ch_003' } },
      'character-deep-dive': { arguments: { name: 'Linh Hồn' } },
      'continuity-audit': { arguments: { arc: 'arc_01' } },
      'rescue-project': {}, // KHÔNG truyền args — test optional/default path
      'brainstorm-scene': { arguments: { arc: 'arc_01', chapter: 'ch_002' } },
    };
    for (const [name, params] of Object.entries(cases)) {
      const pr = await client.request('prompts/get', { name, ...params });
      pr.error ? report(`prompt ${name}`, 'FAIL', JSON.stringify(pr.error).slice(0, 300))
        : report(`prompt ${name}`, 'PASS');
    }
  } catch (e: any) { report('prompts', 'FAIL', e.message); }

  // ══════════ Báo cáo ══════════
  console.log('\n════════ SMOKE REPORT ════════');
  let fail = 0, warn = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✔' : r.status === 'WARN' ? '▲' : '✖';
    if (r.status === 'FAIL') fail++;
    if (r.status === 'WARN') warn++;
    console.log(`${icon} [${r.status}] ${r.name}${r.detail ? ' — ' + r.detail.replace(/\n/g, ' | ').slice(0, 220) : ''}`);
  }
  console.log(`════════ ${results.length} checks: ${fail} FAIL, ${warn} WARN ════════`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('SMOKE CRASH:', e); process.exit(2); });
