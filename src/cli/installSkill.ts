import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runInstallSkill(args: string[] = []): Promise<void> {
  const isGlobal = args.includes('--global') || args.includes('-g');
  const targetDir = args.find((a) => !a.startsWith('-'));

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               INSTALL NOVEL WRITER ASSISTANT SKILL               ║
║           Cài Đặt Skill AI Đồng Tác Giả & Biên Tập Viên          ║
╚══════════════════════════════════════════════════════════════════╝
`);

  // Locate the embedded skill file
  // Try local source or packaged root
  const candidates = [
    path.resolve(__dirname, '..', '..', '.agents', 'skills', 'novel-writer-assistant', 'SKILL.md'),
    path.resolve(__dirname, '..', 'skills', 'novel-writer-assistant', 'SKILL.md'),
  ];

  let sourceSkillPath = candidates.find((p) => fs.existsSync(p));
  if (!sourceSkillPath) {
    // If not found, use inline default skill content
    console.log(`ℹ️  Đang sử dụng nội dung Skill mặc định tiêu chuẩn...`);
  }

  const skillContent = sourceSkillPath
    ? fs.readFileSync(sourceSkillPath, 'utf-8')
    : `---
name: novel-writer-assistant
description: Đồng Tác Giả & Biên Tập Viên Tiểu Thuyết Chuyên Nghiệp hỗ trợ sáng tác, rà soát tính liên tục (continuity), nhịp độ (pacing), giọng văn (voice) và lỗ hổng cốt truyện (plot holes) thông qua story-architect-mcp.
---

# Novel Writer Assistant (Đồng Tác Giả & Biên Tập Viên AI)

Bạn là một **Tiểu Thuyết Gia Chuyên Nghiệp kiêm Tổng Biên Tập Văn Học**, làm việc chặt chẽ với tác giả thông qua hệ thống công cụ **\`story-architect-mcp\`**.

## Nguyên Tắc Cốt Lõi
1. **Novels as Code**: Luôn tra cứu và bảo vệ sự nhất quán của thế giới, nhân vật, dòng thời gian và phục bút thông qua các công cụ MCP \`story_*\`.
2. **Show, Don't Tell**: Ưu tiên gợi mở hình ảnh, cảm xúc và hành động thay vì giải thích khô khan.
3. **Bảo Tồn Giọng Văn (Voice Preservation)**: Luôn tuân thủ style guide và tông giọng của tác giả.
`;

  const home = os.homedir();
  const installTargets: string[] = [];

  if (isGlobal || !targetDir) {
    // 1. Antigravity / Gemini Global skills
    installTargets.push(path.join(home, '.gemini', 'config', 'skills', 'novel-writer-assistant', 'SKILL.md'));
  }

  if (targetDir) {
    // Project local .agents/skills/
    const projectRoot = path.resolve(targetDir);
    installTargets.push(path.join(projectRoot, '.agents', 'skills', 'novel-writer-assistant', 'SKILL.md'));
  }

  let count = 0;
  for (const target of installTargets) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Không lặng lẽ ghi đè skill user đã tùy biến: backup khi khác nội dung
      if (fs.existsSync(target)) {
        const current = fs.readFileSync(target, 'utf-8');
        if (current !== skillContent) {
          const backup = `${target}.bak.${Date.now()}`;
          fs.copyFileSync(target, backup);
          console.log(`  💾 Đã backup skill cũ tại: ${backup}`);
        }
      }
      fs.writeFileSync(target, skillContent, 'utf-8');
      console.log(`  ✅ Đã cài đặt Skill vào: ${target}`);
      count++;
    } catch (err: any) {
      console.log(`  ❌ Lỗi khi ghi vào ${target}: ${err.message}`);
    }
  }

  console.log(`\n🎉 Đã cài đặt thành công Skill tại ${count} vị trí!`);
  console.log(`Bây giờ bạn có thể kích hoạt skill 'novel-writer-assistant' trong mọi phiên trò chuyện sáng tác.`);
}
