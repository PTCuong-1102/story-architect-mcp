/**
 * Adversarial smoke: các kiểu input lỗi/edge case mà MCP client thật (LLM) thường gửi.
 * Mục tiêu: tool KHÔNG được crash — phải trả về message sạch hoặc InvalidParams chuẩn.
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';

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

const ROOT = '/tmp/opencode/smoke-edge';

class MiniClient {
  private nextId = 1;
  private pending = new Map<number, (v: any) => void>();
  constructor(private t: any) {
    t.onmessage = (msg: any) => {
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const res = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        res(msg);
      }
    };
  }
  request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`TIMEOUT ${method}`)), 15000);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.t.send({ jsonrpc: '2.0', id, method, params }).catch((e: Error) => { clearTimeout(timer); reject(e); });
    });
  }
}

const results: { name: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }[] = [];
function report(name: string, status: 'PASS' | 'FAIL' | 'WARN', detail = '') {
  results.push({ name, status, detail });
}

/** Gọi tool và phân loại kết quả:
 *  - CLEAN_ERROR: JSON-RPC error có message rõ ràng (invalid params...) → chấp nhận được
 *  - isError result → chấp nhận được nếu message ngắn gọn (không stack trace)
 *  - CRASH: timeout, exception lạ, hoặc text chứa stack trace */
function classify(resp: any): { verdict: 'PASS' | 'FAIL' | 'WARN'; detail: string } {
  if (!resp) return { verdict: 'FAIL', detail: 'no response' };
  if (resp.error) {
    const msg = resp.error.message || JSON.stringify(resp.error);
    return { verdict: msg.length < 300 ? 'PASS' : 'WARN', detail: `[${resp.error.code}] ${msg.slice(0, 180)}` };
  }
  const r = resp.result ?? {};
  const text = (r.content || []).map((c: any) => c.text || '').join('\n');
  if (r.isError) {
    const hasStack = /\n\s+at\s/.test(text);
    return hasStack
      ? { verdict: 'FAIL', detail: 'isError với STACK TRACE lộ ra: ' + text.slice(0, 160).replace(/\n/g, '|') }
      : { verdict: 'PASS', detail: 'isError: ' + text.slice(0, 140).replace(/\n/g, '|') };
  }
  return { verdict: 'PASS', detail: text.slice(0, 120).replace(/\n/g, '|') };
}

async function main() {
  await fs.rm(ROOT, { recursive: true, force: true });
  const novelDir = path.join(ROOT, 'novel');
  const p = new StoryProject(novelDir);
  await p.initializeProject({ name: 'Edge Novel', targetWordCount: 10000 });
  await fs.writeFile(path.join(novelDir, 'manuscript/arc_01/ch_001.md'), '"Chào," hắn nói.\nHắn chém một nhát.');

  let currentProject: StoryProject | null = null;
  const getProject = (): StoryProject => {
    if (!currentProject) throw new Error('Chưa thiết lập dự án. Hãy gọi tool story_set_project trước.');
    return currentProject;
  };

  const server = new McpServer({ name: 'edge', version: '0' });
  registerResources(server, getProject);
  registerPrompts(server, getProject);
  registerProjectManagerTools(server, (pp) => { currentProject = new StoryProject(path.resolve(pp)); return currentProject; }, () => currentProject, () => currentProject?.projectPath ?? null);
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

  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new MiniClient(ct);
  await server.connect(st);
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'edge', version: '0' },
  });

  async function t(name: string, tool: string, args: any) {
    try {
      const resp = await client.request('tools/call', { name: tool, arguments: args });
      const v = classify(resp);
      report(name, v.verdict, v.detail);
    } catch (e: any) {
      report(name, 'FAIL', 'EXCEPTION: ' + e.message.slice(0, 160));
    }
  }

  // ─── Nhóm 1: gọi tool khi CHƯA set project (getProject throw) ───
  await t('no-project: get_project_info', 'story_get_project_info', {});
  await t('no-project: stats', 'story_stats', {});
  await t('no-project: log_plot_hole', 'story_log_plot_hole', { title: 'x', description: 'y' });
  await t('no-project: list_unfired', 'story_list_unfired', {});

  // ─── Nhóm 2: thiếu field bắt buộc ───
  await t('missing-required: log_plot_hole rỗng', 'story_log_plot_hole', {});
  await t('missing-required: init không name', 'story_init', {});
  await t('missing-required: pacing không arc', 'story_analyze_pacing', {});
  await t('missing-required: generatePrompt thiếu cả hai', 'story_generate_writing_prompt', { strategy: 'rewrite' });

  // ─── Nhóm 3: NULL cho field optional (LLM hay gửi) ───
  // set project trước để đi tới logic thật
  await t('setup: set_project', 'story_set_project', { projectPath: novelDir });
  await t('null-optional: log_plot_hole severity/chapters=null', 'story_log_plot_hole', { title: 'Lỗ hổng null', description: 'mô tả', severity: null, chapters: null });
  await t('null-optional: log_setup setupLine/importance=null', 'story_log_setup', { setup: 's', setupChapter: 'arc_01/ch_001', setupLine: null, importance: null });
  await t('null-optional: map_relationships type/description=null', 'story_map_relationships', { source: 'A', target: 'B', type: null, description: null });
  await t('null-optional: extract_entities confirm=null', 'story_extract_entities_to_bible', { arc: 'arc_01', chapter: 'ch_001', confirm: null });
  await t('null-optional: query_context budgetTokens=null/maxDepth/rebuild=null', 'story_query_context', { query: 'q', budgetTokens: null, maxDepth: null, rebuildIndex: null });
  await t('null-optional: detect_timeline addEvent=null', 'story_detect_timeline_conflicts', { addEvent: null });
  await t('null-optional: snapshot label=null', 'story_snapshot', { label: null, description: null });
  await t('null-optional: export outputPath/includeOutline=null', 'story_export', { format: 'markdown_single', outputPath: null, includeOutline: null });

  // ─── Nhóm 4: SAI KIỂU dữ liệu ───
  await t('wrong-type: query budgetTokens="2000" (string)', 'story_query_context', { query: 'q', budgetTokens: '2000' });
  await t('wrong-type: scan detectDuplicates="true" (string)', 'story_scan_messy_project', { path: ROOT, detectDuplicates: 'true' });
  await t('wrong-type: resolve id=123 (number)', 'story_resolve_plot_hole', { id: 123, resolution: 'r' });
  await t('wrong-type: export format="PDF" (enum sai hoa)', 'story_export', { format: 'PDF' });

  // ─── Nhóm 5: giá trị biên nghiệp vụ ───
  await t('edge: pacing arc không tồn tại', 'story_analyze_pacing', { arc: 'arc_99' });
  await t('edge: voice arc không tồn tại', 'story_analyze_voice', { arc: 'arc_99' });
  await t('edge: extract chapter không tồn tại', 'story_extract_entities_to_bible', { arc: 'arc_01', chapter: 'ch_999', confirm: false });
  await t('edge: map_rel chỉ có source không target/type', 'story_map_relationships', { source: 'A' });
  await t('edge: resolve id không tồn tại', 'story_resolve_plot_hole', { id: 'khong_co', resolution: 'x' });
  await t('edge: payoff id không tồn tại', 'story_log_payoff', { id: 'khong_co', payoff: 'y', payoffChapter: 'arc_01/ch_001' });
  await t('edge: rollback chưa có snapshot nào', 'story_rollback', { confirm: true });
  await t('edge: timeline addEvent thiếu relativeOrder (default)', 'story_detect_timeline_conflicts', { addEvent: { label: 'Kiểm tra mặc định' } });
  await t('edge: timeline addEvent absoluteDate rác', 'story_detect_timeline_conflicts', { addEvent: { label: 'Ngày rác', absoluteDate: 'không-phải-ngày', relativeOrder: 9 } });
  await t('edge: query_context budgetTokens=50 (cắt giảm)', 'story_query_context', { query: 'không khớp gì hết abcxyz', budgetTokens: 50 });
  await t('edge: export format pdf (by-design từ chối)', 'story_export', { format: 'pdf' });
  await t('edge: set_project đường dẫn không tồn tại', 'story_set_project', { projectPath: '/tmp/opencode/smoke-edge/khong-ton-tai' });
  await t('edge: set_project file (không phải dir)', 'story_set_project', { projectPath: path.join(novelDir, 'manuscript/arc_01/ch_001.md') });
  await t('edge: scan path không tồn tại', 'story_scan_messy_project', { path: '/tmp/opencode/smoke-edge/none' });
  await t('edge: refactor path rỗng hoàn toàn', 'story_auto_refactor_structure', { projectPath: novelDir, confirm: false });

  // ─── Nhóm 6: resources & prompts edge ───
  try {
    const r1 = await client.request('resources/read', { uri: 'story://bible/characters/khong_co' });
    const txt = r1.result?.contents?.[0]?.text || '';
    report('res: char không tồn tại → message sạch', txt.includes('Không tìm thấy') ? 'PASS' : 'WARN', txt.slice(0, 100));
  } catch (e: any) { report('res: char không tồn tại', 'FAIL', e.message.slice(0, 150)); }
  try {
    await client.request('resources/read', { uri: 'story://unknown' });
    report('res: uri lạ', 'FAIL', 'không error?');
  } catch (e: any) {
    const clean = !/stack/i.test(e.message);
    report('res: uri lạ → lỗi chuẩn', clean ? 'PASS' : 'FAIL', e.message.slice(0, 120));
  }
  try {
    const pr = await client.request('prompts/get', { name: 'rescue-project', arguments: { projectPath: '/tmp/x' } });
    report('prompt rescue-project có args', pr.error ? 'FAIL' : 'PASS', pr.error?.message?.slice(0, 120));
  } catch (e: any) { report('prompt rescue-project có args', 'FAIL', e.message.slice(0, 150)); }
  try {
    const bad = await client.request('prompts/get', { name: 'write-next-chapter', arguments: {} });
    const v = classify(bad);
    report('prompt write-next-chapter thiếu args → lỗi chuẩn', v.verdict === 'FAIL' ? 'FAIL' : 'PASS', v.detail);
  } catch (e: any) { report('prompt write-next-chapter thiếu args', 'PASS', e.message.slice(0, 120)); }
  try {
    const unk = await client.request('tools/call', { name: 'tool_khong_ton_tai', arguments: {} });
    const v = classify(unk);
    report('unknown tool → lỗi chuẩn', v.verdict === 'FAIL' ? 'FAIL' : 'PASS', v.detail);
  } catch (e: any) { report('unknown tool', 'PASS', e.message.slice(0, 120)); }

  console.log('\n════════ EDGE-CASE REPORT ════════');
  let fail = 0, warn = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✔' : r.status === 'WARN' ? '▲' : '✖';
    if (r.status === 'FAIL') fail++;
    if (r.status === 'WARN') warn++;
    console.log(`${icon} [${r.status}] ${r.name}${r.detail ? ' — ' + r.detail.replace(/\n/g, ' | ').slice(0, 200) : ''}`);
  }
  console.log(`════════ ${results.length} checks: ${fail} FAIL, ${warn} WARN ════════`);
}

main().catch(e => { console.error('EDGE CRASH:', e); process.exit(2); });
