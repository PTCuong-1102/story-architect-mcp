import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getSupportedClients } from './clientDetect.js';
import { StoryProject } from '../server/StoryProject.js';

export async function runDoctor(args: string[] = []): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               STORY-ARCHITECT-MCP DOCTOR DIAGNOSTIC              ║
║         Kiểm Tra Môi Trường & Cấu Hình Hệ Thống MCP              ║
╚══════════════════════════════════════════════════════════════════╝
`);

  let errors = 0;
  let warnings = 0;

  // 1. Node.js Version Check
  const nodeVer = process.version;
  const majorVer = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  console.log(`1. Node.js Environment:`);
  if (majorVer >= 20) {
    console.log(`   ✅ Node.js ${nodeVer} (Tương thích: >= 20.0.0)`);
  } else {
    console.log(`   ❌ Node.js ${nodeVer} quá cũ! MCP Server yêu cầu Node.js >= 20.0.0.`);
    errors++;
  }

  // 2. OS & Architecture
  console.log(`\n2. Hệ Điều Hành:`);
  console.log(`   ℹ️  OS: ${process.platform} (${os.release()}) | Arch: ${process.arch}`);

  // 3. MCP Clients Config Status
  console.log(`\n3. Trạng Thái Cấu Hình MCP Clients:`);
  const clients = getSupportedClients();
  let configuredCount = 0;

  for (const client of clients) {
    if (client.exists) {
      try {
        const raw = fs.readFileSync(client.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const hasStoryArchitect = !!(
          parsed.mcpServers?.['story-architect'] ||
          parsed.mcpServers?.['story_architect'] ||
          parsed.mcpServers?.['story-architect-mcp']
        );
        if (hasStoryArchitect) {
          console.log(`   ✅ [Đã Cấu Hình] ${client.name}`);
          console.log(`      File: ${client.configPath}`);
          configuredCount++;
        } else {
          console.log(`   ⚠️  [Chưa Cấu Hình story-architect] ${client.name}`);
          console.log(`      File tồn tại nhưng chưa có entry "story-architect".`);
          warnings++;
        }
      } catch (err: any) {
        console.log(`   ❌ [Lỗi JSON] ${client.name}: ${err.message}`);
        console.log(`      File: ${client.configPath}`);
        errors++;
      }
    } else if (client.parentDirExists) {
      console.log(`   ⚪ [Đã Cài Đặt Ứng Dụng] ${client.name} (Chưa tạo file mcp config)`);
    }
  }

  if (configuredCount === 0) {
    console.log(`\n   ⚠️  Chưa có MCP Client nào được cấu hình story-architect.`);
    console.log(`      Hãy chạy: npx story-architect-mcp setup`);
    warnings++;
  }

  // 4. Check Current Workspace if provided
  const targetDir = args.find((a) => !a.startsWith('-'));
  if (targetDir) {
    const resolvedPath = path.resolve(targetDir);
    console.log(`\n4. Kiểm Tra Thư Mục Dự Án: ${resolvedPath}`);
    const project = new StoryProject(resolvedPath);
    const isInit = await project.isInitialized();
    if (isInit) {
      console.log(`   ✅ Thư mục là một dự án Novel hợp lệ (.story/config.json)`);
      try {
        const config = await project.getConfig();
        console.log(`      Tên: "${config.name}" | Tác giả: ${config.author || 'N/A'} | Ngôn ngữ: ${config.language || 'vi'}`);
      } catch (e: any) {
        console.log(`   ❌ Lỗi đọc config: ${e.message}`);
        errors++;
      }
    } else {
      console.log(`   ⚪ Thư mục này chưa được khởi tạo làm Novel Workspace.`);
      console.log(`      Để khởi tạo, hãy chạy: npx story-architect-mcp init-novel "${targetDir}"`);
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  if (errors === 0 && warnings === 0) {
    console.log(`🎉 TẤT CẢ ĐỀU HOÀN HẢO! Hệ thống sẵn sàng cho AI Novel Writing.`);
  } else if (errors === 0) {
    console.log(`⚠️  Hoàn tất với ${warnings} cảnh báo. Hệ thống cơ bản hoạt động tốt.`);
  } else {
    console.log(`❌ Phát hiện ${errors} lỗi cần khắc phục trước khi sử dụng.`);
  }
  console.log(`════════════════════════════════════════════════════════════════════\n`);
}
