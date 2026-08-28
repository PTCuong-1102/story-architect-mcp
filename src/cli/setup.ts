import * as readline from 'node:readline';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSupportedClients, injectMcpConfig, McpServerConfigEntry } from './clientDetect.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

export async function runSetupWizard(args: string[] = []): Promise<void> {
  const isAutoYes = args.includes('--yes') || args.includes('-y') || args.includes('--all');
  const forceLocal = args.includes('--local');
  const forceNpx = args.includes('--npx');

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               STORY-ARCHITECT-MCP SETUP WIZARD                   ║
║    Model Context Protocol Server for AI-Assisted Novel Writing   ║
╚══════════════════════════════════════════════════════════════════╝
`);

  // Detect project path if run from local source
  const distIndexPath = path.resolve(__dirname, '..', 'index.js');
  const isLocalRepo = fs.existsSync(distIndexPath);

  let useNpx = true;
  if (forceLocal && isLocalRepo) {
    useNpx = false;
  } else if (forceNpx) {
    useNpx = true;
  } else if (isLocalRepo && !isAutoYes) {
    console.log(`📦 Phát hiện bạn đang chạy từ thư mục mã nguồn cục bộ:`);
    console.log(`   ${distIndexPath}\n`);
    const ans = await askQuestion(
      `Bạn muốn cấu hình MCP Client chạy bằng [1] npx (Khuyên dùng) hay [2] node trực tiếp từ repo này? (Mặc định: 1): `
    );
    if (ans === '2') {
      useNpx = false;
    }
  }

  const serverConfig: McpServerConfigEntry = useNpx
    ? {
        command: 'npx',
        args: ['-y', 'story-architect-mcp'],
      }
    : {
        command: 'node',
        args: [distIndexPath],
      };

  console.log(`\n🔍 Đang quét các MCP Clients trên máy của bạn...\n`);
  const clients = getSupportedClients();

  const detected = clients.filter((c) => c.exists || c.parentDirExists);
  const notDetected = clients.filter((c) => !c.exists && !c.parentDirExists);

  if (detected.length === 0) {
    console.log(`⚠️  Không tìm thấy thư mục cấu hình nào của các MCP Client phổ biến.`);
    console.log(`   Bạn có thể tự tạo file config hoặc kiểm tra lại đường dẫn cài đặt của Claude/Cursor/Antigravity.\n`);
  } else {
    console.log(`Đã phát hiện ${detected.length} MCP Client(s):`);
    detected.forEach((c, idx) => {
      const status = c.exists ? '✅ Đã có config' : '📁 Đã có thư mục ứng dụng';
      console.log(`  [${idx + 1}] ${c.name} (${status})`);
      console.log(`      Path: ${c.configPath}`);
    });
  }

  let selectedClients = detected;

  if (!isAutoYes && detected.length > 0) {
    console.log(`\nLựa chọn cài đặt:`);
    console.log(`  - Nhập 'all' hoặc Enter để cấu hình TẤT CẢ các client đã phát hiện`);
    console.log(`  - Hoặc nhập số thứ tự (ví dụ: 1, 2) để chọn cụ thể`);
    const selection = await askQuestion(`\nLựa chọn của bạn (Mặc định: all): `);

    if (selection && selection.toLowerCase() !== 'all') {
      const indices = selection
        .split(/[,\s]+/)
        .map((s) => parseInt(s, 10) - 1)
        .filter((i) => !isNaN(i) && i >= 0 && i < detected.length);
      if (indices.length > 0) {
        selectedClients = indices.map((i) => detected[i]);
      }
    }
  }

  if (selectedClients.length === 0) {
    console.log(`\n⚠️ Không có client nào được chọn để cấu hình.`);
    return;
  }

  console.log(`\n🚀 Đang tiến hành cấu hình MCP Server...`);
  let successCount = 0;

  for (const client of selectedClients) {
    const result = injectMcpConfig(client.configPath, serverConfig);
    if (result.success) {
      successCount++;
      console.log(`  ✅ ${client.name}: Thành công!`);
      if (result.backupPath) {
        console.log(`     (Đã tạo backup an toàn: ${result.backupPath})`);
      }
    } else {
      console.log(`  ❌ ${client.name}: Thất bại (${result.message})`);
    }
  }

  console.log(`
════════════════════════════════════════════════════════════════════
🎉 CÀI ĐẶT HOÀN TẤT: Đã cấu hình thành công cho ${successCount}/${selectedClients.length} clients!
════════════════════════════════════════════════════════════════════

📌 BƯỚC TIẾP THEO ĐỂ BẮT ĐẦU VIẾT TRUYỆN:
1. Khởi động lại (hoặc reload) Claude Desktop / Cursor / Antigravity / Windsurf.
2. Kiểm tra danh sách MCP tools (sẽ thấy 23 công cụ bắt đầu bằng 'story_*').
3. Bắt đầu novel project:
   - Dùng lệnh: npx story-architect-mcp init-novel ./my-novel
   - Hoặc yêu cầu AI trong chat: "Hãy khởi tạo dự án tiểu thuyết mới tại thư mục hiện tại".

💡 Chúc bạn sáng tác những thiên tiểu thuyết tuyệt tác cùng story-architect-mcp!
`);
}
