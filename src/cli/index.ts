import { runSetupWizard } from './setup.js';
import { runInitNovel } from './initNovel.js';
import { runDoctor } from './doctor.js';
import { runInstallSkill } from './installSkill.js';

export { runSetupWizard, runInitNovel, runDoctor, runInstallSkill };

export function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               STORY-ARCHITECT-MCP CLI & SERVER                   ║
║    Model Context Protocol Server for AI-Assisted Novel Writing   ║
╚══════════════════════════════════════════════════════════════════╝

CÁCH SỬ DỤNG (USAGE):

  1. Khởi chạy MCP Server (Mặc định khi AI Client kết nối qua Stdio):
     $ story-architect-mcp [optional-project-path]

  2. Cấu hình MCP Client tự động (Interactive Setup Wizard):
     $ story-architect-mcp setup [--yes] [--local] [--npx]
     $ npx story-architect-mcp setup

  3. Khởi tạo một dự án tiểu thuyết mới (Novel Workspace Scaffolding):
     $ story-architect-mcp init-novel [path] [--yes]
     $ npx story-architect-mcp init-novel ./my-novel

  4. Chẩn đoán hệ thống & cấu hình MCP Clients:
     $ story-architect-mcp doctor [path]
     $ npx story-architect-mcp doctor

  5. Cài đặt AI Assistant Skill (Đồng tác giả & Biên tập viên):
     $ story-architect-mcp install-skill [--global] [project-path]
     $ npx story-architect-mcp install-skill

TÙY CHỌN (OPTIONS):
  -h, --help       Hiển thị hướng dẫn sử dụng
  -v, --version    Hiển thị phiên bản hiện tại
`);
}
