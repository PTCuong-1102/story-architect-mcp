import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface McpClientInfo {
  id: string;
  name: string;
  configPath: string;
  exists: boolean;
  parentDirExists: boolean;
  type: 'mcpServers' | 'continue';
}

/**
 * Returns configuration paths for popular MCP clients across OS platforms
 */
export function getSupportedClients(): McpClientInfo[] {
  const home = os.homedir();
  const platform = process.platform;

  const clients: McpClientInfo[] = [];

  // 1. Claude Desktop
  let claudePath = '';
  if (platform === 'darwin') {
    claudePath = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    claudePath = path.join(appData, 'Claude', 'claude_desktop_config.json');
  } else {
    // Linux
    const configDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    claudePath = path.join(configDir, 'Claude', 'claude_desktop_config.json');
  }
  clients.push({
    id: 'claude-desktop',
    name: 'Claude Desktop',
    configPath: claudePath,
    exists: fs.existsSync(claudePath),
    parentDirExists: fs.existsSync(path.dirname(claudePath)),
    type: 'mcpServers',
  });

  // 2. Cursor (Global & Workspace)
  const cursorGlobalPath = path.join(home, '.cursor', 'mcp.json');
  clients.push({
    id: 'cursor-global',
    name: 'Cursor (Global: ~/.cursor/mcp.json)',
    configPath: cursorGlobalPath,
    exists: fs.existsSync(cursorGlobalPath),
    parentDirExists: fs.existsSync(path.dirname(cursorGlobalPath)),
    type: 'mcpServers',
  });

  // 3. Antigravity / Gemini IDE
  const antigravityGlobalPath = path.join(home, '.gemini', 'config', 'mcp_config.json');
  const antigravityIdePath = path.join(home, '.gemini', 'antigravity-ide', 'mcp_config.json');
  const targetAntigravity = fs.existsSync(antigravityIdePath) ? antigravityIdePath : antigravityGlobalPath;
  clients.push({
    id: 'antigravity',
    name: 'Google Antigravity / Gemini IDE',
    configPath: targetAntigravity,
    exists: fs.existsSync(targetAntigravity),
    parentDirExists: fs.existsSync(path.dirname(targetAntigravity)),
    type: 'mcpServers',
  });

  // 4. Windsurf (Codeium)
  const windsurfPath = path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
  clients.push({
    id: 'windsurf',
    name: 'Windsurf',
    configPath: windsurfPath,
    exists: fs.existsSync(windsurfPath),
    parentDirExists: fs.existsSync(path.dirname(windsurfPath)),
    type: 'mcpServers',
  });

  // 5. VS Code Cline Extension
  let clinePath = '';
  if (platform === 'darwin') {
    clinePath = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    clinePath = path.join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  } else {
    const configDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    clinePath = path.join(configDir, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json');
  }
  clients.push({
    id: 'cline',
    name: 'VS Code Cline Extension',
    configPath: clinePath,
    exists: fs.existsSync(clinePath),
    parentDirExists: fs.existsSync(path.dirname(clinePath)),
    type: 'mcpServers',
  });

  // 6. VS Code Roo Code Extension
  let rooPath = '';
  if (platform === 'darwin') {
    rooPath = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    rooPath = path.join(appData, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  } else {
    const configDir = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    rooPath = path.join(configDir, 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json');
  }
  clients.push({
    id: 'roo-code',
    name: 'VS Code Roo Code Extension',
    configPath: rooPath,
    exists: fs.existsSync(rooPath),
    parentDirExists: fs.existsSync(path.dirname(rooPath)),
    type: 'mcpServers',
  });

  return clients;
}

export interface McpServerConfigEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Injects or updates story-architect MCP server configuration into a target JSON file.
 * Creates a timestamped backup before modifying.
 */
export function injectMcpConfig(
  configFilePath: string,
  serverEntry: McpServerConfigEntry,
  serverKey = 'story-architect'
): { success: boolean; backupPath?: string; message: string } {
  try {
    const dir = path.dirname(configFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let configContent: Record<string, any> = {};
    let backupPath: string | undefined;

    if (fs.existsSync(configFilePath)) {
      const raw = fs.readFileSync(configFilePath, 'utf-8');
      try {
        configContent = JSON.parse(raw);
      } catch (err: any) {
        return {
          success: false,
          message: `Lỗi đọc JSON từ file ${configFilePath}: ${err.message}. Hãy kiểm tra cú pháp file trước.`,
        };
      }

      // Create backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = `${configFilePath}.bak.${timestamp}`;
      fs.writeFileSync(backupPath, raw, 'utf-8');
    }

    // Prepare mcpServers block
    if (!configContent.mcpServers || typeof configContent.mcpServers !== 'object') {
      configContent.mcpServers = {};
    }

    configContent.mcpServers[serverKey] = serverEntry;

    // Write back cleanly formatted JSON
    fs.writeFileSync(configFilePath, JSON.stringify(configContent, null, 2) + '\n', 'utf-8');

    return {
      success: true,
      backupPath,
      message: `Đã cấu hình thành công cho file: ${configFilePath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `Lỗi khi ghi file ${configFilePath}: ${error.message}`,
    };
  }
}
