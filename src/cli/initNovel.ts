import * as path from 'node:path';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { StoryProject } from '../server/StoryProject.js';

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

export async function runInitNovel(args: string[] = []): Promise<void> {
  let targetPath = args.find((a) => !a.startsWith('-')) || '.';
  const isAutoYes = args.includes('--yes') || args.includes('-y');

  const resolvedPath = path.resolve(targetPath);

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               INIT NOVEL PROJECT SCAFFOLDING                     ║
║           Khởi Tạo Dự Án Tiểu Thuyết Chuẩn MCP                   ║
╚══════════════════════════════════════════════════════════════════╝
`);

  let name = path.basename(resolvedPath) || 'My Epic Novel';
  let author = 'Tác Giả';
  let genre = ['Fantasy', 'Adventure'];
  let pov: 'first' | 'third-limited' | 'third-omniscient' | 'second' = 'third-limited';
  let tense: 'past' | 'present' = 'past';
  let language = 'vi';
  let targetWordCount = 80000;

  if (!isAutoYes) {
    console.log(`📁 Thư mục dự án: ${resolvedPath}\n`);
    const inputName = await askQuestion(`1. Tên tác phẩm [${name}]: `);
    if (inputName) name = inputName;

    const inputAuthor = await askQuestion(`2. Tên tác giả [${author}]: `);
    if (inputAuthor) author = inputAuthor;

    const inputGenre = await askQuestion(`3. Thể loại (cách nhau bởi dấu phẩy) [Fantasy, Adventure]: `);
    if (inputGenre) {
      genre = inputGenre.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const inputPov = await askQuestion(`4. Ngôi kể (first / third-limited / third-omniscient) [third-limited]: `);
    if (inputPov && ['first', 'third-limited', 'third-omniscient', 'second'].includes(inputPov)) {
      pov = inputPov as any;
    }

    const inputTense = await askQuestion(`5. Thì kể chuyện (past / present) [past]: `);
    if (inputTense && ['past', 'present'].includes(inputTense)) {
      tense = inputTense as any;
    }

    const inputLang = await askQuestion(`6. Ngôn ngữ chính [vi]: `);
    if (inputLang) language = inputLang;

    const inputWords = await askQuestion(`7. Mục tiêu tổng số từ [80000]: `);
    if (inputWords && !isNaN(parseInt(inputWords, 10))) {
      targetWordCount = parseInt(inputWords, 10);
    }
  }

  const project = new StoryProject(resolvedPath);

  if (await project.isInitialized()) {
    console.log(`\n⚠️  Dự án tại ${resolvedPath} đã được khởi tạo trước đó.`);
    return;
  }

  console.log(`\n⚙️ Đang tạo cấu trúc thư mục & dữ liệu ban đầu...`);

  await project.initializeProject({
    name,
    author,
    genre,
    pov,
    tense,
    language,
    targetWordCount,
  });

  // Populate rich starter templates
  const sampleCharPath = path.join(resolvedPath, 'bible', 'characters', 'nhan_vat_chinh.md');
  if (!fs.existsSync(sampleCharPath)) {
    fs.writeFileSync(
      sampleCharPath,
      `---
name: "Nhân Vật Chính"
role: "protagonist"
archetype: "The Reluctant Hero"
age: 22
gender: "Nam"
occupation: "Học đồ giả kim thuật"
status: "alive"
relationships:
  - target: "Nguoi_Huong_Dan"
    type: "mentor"
    sentiment: "respect"
---

# Nhân Vật Chính

## Tóm tắt lý lịch & Động lực
Một thanh niên sống tại vùng biên cảnh, mang trong mình bí mật về huyết mạch cổ xưa. Động lực lớn nhất là bảo vệ gia đình và tìm ra sự thật về vụ mất tích của người cha.

## Ngoại hình & Đặc điểm nhận dạng
- Tóc đen rối, mắt màu hổ phách.
- Vết sẹo hình lưỡi liềm ở cổ tay trái.

## Tính cách & Xung đột nội tâm (Flaws & Arc)
- **Điểm mạnh**: Kiên cường, nhạy bén với cổ ngữ, trung thành.
- **Điểm yếu**: Thường nghi ngờ bản thân, dễ bộc phát khi người thân bị đe dọa.
`,
      'utf-8'
    );
  }

  const sampleLocPath = path.join(resolvedPath, 'bible', 'world', 'thanh_pho_khoi_nguon.md');
  if (!fs.existsSync(sampleLocPath)) {
    fs.writeFileSync(
      sampleLocPath,
      `---
name: "Thành Phố Khởi Nguồn"
type: "location"
region: "Đông Vực"
climate: "Ôn đới sương mù"
---

# Thành Phố Khởi Nguồn

## Mô tả tổng quan
Thành phố cảng cổ kính được xây dựng trên vách đá ven biển. Nổi tiếng với ngọn hải đăng pha lê và các xưởng chế tác ma đạo khí cụ.

## Quy tắc thế giới & Văn hóa
- Hệ thống phân cấp dựa trên cấp bậc huân chương ma đạo sư.
- Ban đêm có lệnh giới nghiêm do sương mù biển mang theo tà khí.
`,
      'utf-8'
    );
  }

  const sampleOutlinePath = path.join(resolvedPath, 'outline', 'synopsis.md');
  if (!fs.existsSync(sampleOutlinePath)) {
    fs.writeFileSync(
      sampleOutlinePath,
      `# Tóm Tắt Cốt Truyện Tổng Thể (Master Synopsis)

## Logline
Khi một học đồ giả kim thuật phát hiện cổ vật cấm kỵ tại thành phố cảng, cậu buộc phải dấn thân vào hành trình vượt qua lục địa trước khi thế lực bóng đêm kịp thức tỉnh.

## 3 Hồi Kịch Tính (Three-Act Structure)
- **Hồi 1 - Khởi đầu**: Khám phá cổ vật và biến cố thiêu rụi xưởng giả kim.
- **Hồi 2 - Thử thách**: Trốn chạy, tập hợp đồng minh và giải mã phong ấn.
- **Hồi 3 - Cao trào & Kết thúc**: Trận chiến tại đỉnh Hải Đăng Vĩnh Hằng.
`,
      'utf-8'
    );
  }

  const sampleCh1Path = path.join(resolvedPath, 'manuscript', 'arc_01', 'ch_001.md');
  if (!fs.existsSync(sampleCh1Path)) {
    fs.writeFileSync(
      sampleCh1Path,
      `# Chương 1: Đêm Sương Mù Trên Bến Cảng

Đèn hải đăng xoay một vòng chậm rãi trên mặt biển xám đục. Gió biển mang theo vị mặn chát luồn qua từng con hẻm lát đá của Thành Phố Khởi Nguồn.

Trong căn gác xép nhỏ ngập tràn mùi thảo dược và bụi giấy, cậu thanh niên cẩn thận dùng nhíp gắp mảnh kim loại phát sáng ra khỏi chiếc bình pha lê...
`,
      'utf-8'
    );
  }

  console.log(`
🎉 KHỞI TẠO THÀNH CÔNG DỰ ÁN TIỂU THUYẾT: "${name}"!
📁 Vị trí: ${resolvedPath}

Các thư mục và file mẫu đã sẵn sàng:
  ├── .story/                ← Cấu hình & Trạng thái dự án
  ├── bible/characters/      ← Hồ sơ nhân vật (đã tạo nhan_vat_chinh.md)
  ├── bible/world/           ← Địa điểm & Lore (đã tạo thanh_pho_khoi_nguon.md)
  ├── outline/synopsis.md    ← Tóm tắt cốt truyện
  └── manuscript/arc_01/     ← Chương đầu tiên (ch_001.md)

👉 Bạn có thể mở dự án này trên Claude Desktop / Cursor / Antigravity và bảo AI:
   "Hãy cùng tôi lập dàn ý chi tiết cho Arc 1 dựa trên synopsis.md!"
`);
}
