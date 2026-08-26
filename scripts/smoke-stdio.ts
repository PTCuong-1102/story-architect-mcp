/**
 * Smoke qua stdio THẬT: spawn `node dist/index.js` như một MCP client thật
 * (Claude Desktop / Cursor làm), nói JSON-RPC newline-delimited qua stdin/stdout.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';

const ROOT = '/tmp/opencode/smoke-stdio';
const results: { name: string; status: 'PASS' | 'FAIL' | 'WARN'; detail: string }[] = [];
function report(name: string, status: 'PASS' | 'FAIL' | 'WARN', detail = '') {
  results.push({ name, status, detail });
  const icon = status === 'PASS' ? '✔' : status === 'WARN' ? '▲' : '✖';
  console.error(`${icon} [${status}] ${name}${detail ? ' — ' + detail.replace(/\n/g, ' | ').slice(0, 180) : ''}`);
}

async function main() {
  await fs.rm(ROOT, { recursive: true, force: true });
  const novelDir = path.join(ROOT, 'novel');
  await fs.mkdir(novelDir, { recursive: true });
  // KHÔNG khởi tạo sẵn — test đúng luồng zero-config của README

  const child = spawn('node', ['dist/index.js'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  let stderrBuf = '';
  child.stderr.on('data', d => { stderrBuf += d.toString(); });

  const pending = new Map<number, (v: any) => void>();
  const rl = readline.createInterface({ input: child.stdout! });
  let nextId = 1;
  rl.on('line', line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try { msg = JSON.parse(trimmed); } catch {
      report('STDOUT Ô NHIỄM (dòng không phải JSON)', 'FAIL', trimmed.slice(0, 120));
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const res = pending.get(msg.id)!;
      pending.delete(msg.id);
      res(msg);
    }
  });

  function request(method: string, params: any, timeoutMs = 30000): Promise<any> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`TIMEOUT ${method}`)); }, timeoutMs);
      pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async function call(name: string, tool: string, args: any, expectFailBusiness = false) {
    try {
      const resp = await request('tools/call', { name: tool, arguments: args });
      if (resp.error) { report(name, 'WARN', `[${resp.error.code}] ${resp.error.message?.slice(0, 140)}`); return ''; }
      const text = (resp.result?.content || []).map((c: any) => c.text || '').join('\n');
      if (resp.result?.isError && !expectFailBusiness) report(name, 'FAIL', text.slice(0, 160));
      else if (resp.result?.isError && expectFailBusiness) report(name, 'WARN', '❌ trả về mà KHÔNG đặt isError → client không biết là lỗi');
      else if (expectFailBusiness) report(name, 'WARN', '(by-design ❌, isError=false)');
      else report(name, 'PASS');
      return text;
    } catch (e: any) {
      report(name, 'FAIL', e.message.slice(0, 150));
      return '';
    }
  }

  // ─── Handshake ───
  try {
    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'stdio-smoke', version: '0' },
    });
    report('initialize (stdio)', init.error ? 'FAIL' : 'PASS', `protocol=${init.result?.protocolVersion ?? init.error?.message}`);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  } catch (e: any) {
    report('initialize (stdio)', 'FAIL', e.message);
    console.error('STDERR server:', stderrBuf.slice(0, 800));
    child.kill();
    process.exit(1);
  }

  const tl = await request('tools/list', {});
  report('tools/list (stdio)', (tl.result?.tools || []).length === 21 ? 'PASS' : 'FAIL', `${(tl.result?.tools || []).length} tools`);

  // ─── Luồng zero-config chuẩn README ───
  await call('set_project (thư mục rỗng)', 'story_set_project', { projectPath: novelDir });
  const initText = await call('story_init', 'story_init', {
    name: 'Stdio Novel', author: 'Tác giả B', genre: ['Kiếm hiệp'],
    pov: 'third-limited', tense: 'past', language: 'vi', targetWordCount: 200000,
  });
  report('story_init tạo cấu trúc', initText.includes('khởi tạo thành công') ? 'PASS' : 'FAIL');

  // Viết chương lớn (~30k ký tự) để thử payload lớn qua stdio
  const bigParagraph = Array.from({ length: 200 }, (_, i) =>
    `"Câu thoại số ${i}," hắn nói rồi chém một nhát kiếm về phía nàng.`).join('\n');
  await fs.writeFile(path.join(novelDir, 'manuscript/arc_01/ch_001.md'), bigParagraph);

  await call('stats với chương lớn', 'story_stats', {});
  await call('analyze_pacing arc_01', 'story_analyze_pacing', { arc: 'arc_01' });
  await call('analyze_voice arc_01', 'story_analyze_voice', { arc: 'arc_01' });
  await call('log_plot_hole', 'story_log_plot_hole', { title: 'T1', description: 'D', severity: 'low' });
  await call('log_setup', 'story_log_setup', { setup: 'S', setupChapter: 'arc_01/ch_001', importance: 'major' });
  await call('timeline + addEvent', 'story_detect_timeline_conflicts', { addEvent: { label: 'Xảy ra', chapter: 'arc_01/ch_001', relativeOrder: 4 } });
  await call('query_context', 'story_query_context', { query: 'kiếm', budgetTokens: 1500 });
  await call('extract_entities confirm=true', 'story_extract_entities_to_bible', { arc: 'arc_01', chapter: 'ch_001', confirm: true });
  for (const fmt of ['markdown_single', 'html', 'epub', 'docx'] as const) {
    await call(`export ${fmt}`, 'story_export', { format: fmt });
  }
  await call('snapshot', 'story_snapshot', { label: 'stdio-check' });

  // Gọi tuần tự nhanh 15 request liên tiếp (đo độ ổn định pipeline)
  try {
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => request('tools/call', { name: 'story_get_project_info', arguments: {} }))
    );
    const allOk = burst.every(r => !r.error);
    report('burst x5 get_project_info đồng thời', allOk ? 'PASS' : 'FAIL');
  } catch (e: any) {
    report('burst đồng thời', 'FAIL', e.message.slice(0, 140));
  }

  // Tắt gọn
  child.stdin.end();
  child.kill();
  await new Promise(r => setTimeout(r, 300));

  const fatalStderr = stderrBuf.includes('Fatal error');
  report('stderr không có Fatal error', fatalStderr ? 'FAIL' : 'PASS');

  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  console.error(`════════ STDIO SMOKE: ${results.length} checks, ${failCount} FAIL, ${warnCount} WARN ════════`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error('CRASH:', e); process.exit(2); });
