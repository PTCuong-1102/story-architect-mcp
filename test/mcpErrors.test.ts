/**
 * Regression: mọi THẤT BẠI nghiệp vụ phải trả về result có isError=true
 * qua MCP transport thật — nếu không, client (LLM agent) sẽ tưởng thành công
 * và tiếp tục chuỗi gọi tool trên trạng thái sai.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';

import { StoryProject } from '../src/server/StoryProject.js';
import { registerProjectManagerTools } from '../src/tools/projectManager.js';
import { registerPlotHoleTools } from '../src/tools/management/plotHoles.js';
import { registerSnapshotTools } from '../src/tools/rescue/snapshot.js';
import { registerExportTool } from '../src/tools/export.js';
import { registerAnalyzePacingTool } from '../src/tools/analysis/analyzePacing.js';
import { registerStatsTool } from '../src/tools/management/stats.js';

const TMP = '/tmp/opencode/unit-mcp-errors';

class MiniClient {
  private t: any;
  private nextId = 1;
  private pending = new Map<number, (v: any) => void>();
  constructor(t: any) {
    this.t = t;
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
      const timer = setTimeout(() => reject(new Error(`TIMEOUT ${method}`)), 10000);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      // @ts-expect-error test double
      this.t.send({ jsonrpc: '2.0', id, method, params }).catch((e: Error) => { clearTimeout(timer); reject(e); });
    });
  }
}

async function setupServer(currentProject: StoryProject | null) {
  const server = new McpServer({ name: 'regression', version: '0' });
  const getProject = (): StoryProject => {
    if (!currentProject) throw new Error('Chưa thiết lập dự án. Hãy gọi tool story_set_project trước.');
    return currentProject;
  };
  registerProjectManagerTools(server, (pp) => { currentProject = new StoryProject(path.resolve(pp)); return currentProject; }, () => currentProject, () => currentProject?.projectPath ?? null);
  registerPlotHoleTools(server, getProject);
  registerSnapshotTools(server, getProject);
  registerExportTool(server, getProject);
  registerAnalyzePacingTool(server, getProject);
  registerStatsTool(server, getProject);

  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new MiniClient(ct);
  await server.connect(st);
  await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  });
  return {
    call: async (name: string, args: any): Promise<{ isError: boolean; text: string }> => {
      const resp = await client.request('tools/call', { name, arguments: args });
      if (resp.error) return { isError: true, text: String(resp.error.message) };
      const r = resp.result ?? {};
      return { isError: !!r.isError, text: (r.content || []).map((c: any) => c.text || '').join('\n') };
    },
  };
}

async function freshNovel(name = 'Err Novel'): Promise<StoryProject> {
  const dir = path.join(TMP, `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(dir, { recursive: true });
  const p = new StoryProject(dir);
  await p.initializeProject({ name });
  return p;
}

test('isError=true cho thất bại nghiệp vụ; success KHÔNG isError', async () => {
  const p = await freshNovel();
  const { call } = await setupServer(p);

  // ─── Success path: bắt buộc isError=false ───
  const ok = await call('story_log_plot_hole', { title: 'T', description: 'D' });
  assert.equal(ok.isError, false, 'log_plot_hole thành công phải isError=false');

  // ─── Failure paths: bắt buộc isError=true ───
  const cases: [string, string, any][] = [
    ['set_project: path không tồn tại', 'story_set_project', { projectPath: path.join(TMP, 'missing') }],
    ['resolve_plot_hole: id lạ', 'story_resolve_plot_hole', { id: 'nope', resolution: 'r' }],
    ['rollback: chưa có snapshot', 'story_rollback', { confirm: true }],
    ['export: format pdf không hỗ trợ', 'story_export', { format: 'pdf' }],
    ['analyze_pacing: arc trống', 'story_analyze_pacing', { arc: 'arc_99' }],
    ['stats: validation sai kiểu', 'story_resolve_plot_hole', { id: 123, resolution: 'r' }],
  ];
  for (const [label, tool, args] of cases) {
    const r = await call(tool, args);
    assert.equal(r.isError, true, `${label} PHẢI isError=true — client cần biết là lỗi`);
    assert.ok(r.text.length > 0 && r.text.length < 2000, `${label}: message hợp lý`);
    assert.ok(!/\n\s+at\s/.test(r.text), `${label}: không được lộ stack trace`);
  }
});

test('gọi tool khi chưa set project → isError với message hướng dẫn', async () => {
  const { call } = await setupServer(null);
  const r = await call('story_stats', {});
  assert.equal(r.isError, true);
  assert.match(r.text, /Chưa thiết lập dự án/);
});
