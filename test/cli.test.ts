import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getSupportedClients, injectMcpConfig } from '../src/cli/clientDetect.js';
import { runInitNovel } from '../src/cli/initNovel.js';
import { StoryProject } from '../src/server/StoryProject.js';

test('CLI: getSupportedClients returns list of standard MCP clients', () => {
  const clients = getSupportedClients();
  assert.ok(Array.isArray(clients));
  assert.ok(clients.length >= 4);

  const ids = clients.map((c) => c.id);
  assert.ok(ids.includes('claude-desktop'));
  assert.ok(ids.includes('cursor-global'));
  assert.ok(ids.includes('antigravity'));
  assert.ok(ids.includes('windsurf'));
});

test('CLI: injectMcpConfig creates backup and safely merges mcpServers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-cli-test-'));
  const configPath = path.join(tmpDir, 'test_mcp_config.json');

  try {
    // 1. Initial config with another server
    const initialConfig = {
      mcpServers: {
        'existing-server': {
          command: 'node',
          args: ['existing.js'],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');

    // 2. Inject story-architect
    const result = injectMcpConfig(configPath, {
      command: 'npx',
      args: ['-y', 'story-architect-mcp'],
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.backupPath && fs.existsSync(result.backupPath), 'Backup file should exist');

    // 3. Verify content
    const updated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(updated.mcpServers['existing-server'], 'Should preserve existing servers');
    assert.deepStrictEqual(updated.mcpServers['story-architect'], {
      command: 'npx',
      args: ['-y', 'story-architect-mcp'],
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI: runInitNovel scaffolds complete novel workspace with starter templates', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-novel-init-test-'));

  try {
    await runInitNovel([tmpDir, '--yes']);

    const project = new StoryProject(tmpDir);
    const isInit = await project.isInitialized();
    assert.strictEqual(isInit, true);

    // Verify starter templates
    assert.ok(fs.existsSync(path.join(tmpDir, 'bible', 'characters', 'nhan_vat_chinh.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'bible', 'world', 'thanh_pho_khoi_nguon.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'outline', 'synopsis.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'manuscript', 'arc_01', 'ch_001.md')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
