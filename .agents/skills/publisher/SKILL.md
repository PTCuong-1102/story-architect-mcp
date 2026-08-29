---
name: publisher
description: Xuất bản bản thảo tiểu thuyết hoàn chỉnh và tạo Interactive Visual Dashboard từ dự án story-architect-mcp v0.2.0: xuất ra file Markdown đơn, HTML (để in PDF), EPUB, DOCX hoặc xuất HTML Dashboard tổng quan dự án. Use khi cần xuất/tải về toàn bộ tác phẩm, đóng gói bản thảo thành file đọc được, tạo dashboard theo dõi tiến độ, chuyển đổi định dạng ebook.
---

# Publisher — Nhà xuất bản bản thảo & Dashboard

Kỹ năng này biến AI thành **Nhà xuất bản & Báo cáo viên dự án** chuyên nghiệp: đóng gói toàn bộ bản thảo tiểu thuyết trong dự án `story-architect-mcp v0.2.0` thành các định dạng phổ biến (Markdown, HTML, EPUB, DOCX) kèm mục lục và thông tin tác giả; đồng thời tạo Visual HTML Dashboard tương tác đầy đủ để theo dõi tổng thể dự án.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **KIỂM TRA TRƯỚC KHI XUẤT (Verify before export):**
   - Luôn chạy `story_stats` trước khi xuất để nắm số chương, số từ và xác nhận bản thảo hoàn chỉnh.

2. **CHỌN ĐÚNG ĐỊNH DẠNG (Right format per purpose):**
   - **`markdown_single`** — bản thảo gốc gom gọn 1 file Markdown duy nhất, tiện diff/lưu trữ git.
   - **`html`** — giao diện web đẹp + là đường xuất PDF chuẩn (Trình duyệt: In → Save as PDF).
   - **`epub`** — sách điện tử chuẩn quốc tế (Kindle/Apple Books/Google Play Books).
   - **`docx`** — file Word hoàn chỉnh để gửi nhà xuất bản hoặc biên tập viên bên ngoài.
   - **`story_generate_dashboard`** — Báo cáo tổng quan dự án (tiến độ từ, radar cảm xúc, Chekhov guns, quan hệ nhân vật).

3. **KÈM MỤC LỤC & DÀN Ý (TOC & outline included):**
   - Bật `includeOutline: true` khi xuất ebook/docx nếu muốn kèm dàn ý tác phẩm.

---

## 📋 WORKFLOW XUẤT BẢN & BÁO CÁO (4 BƯỚC)

### Bước 1: Kiểm tra tổng thể (Preflight Check)
- Chạy `story_stats` để xác nhận tổng số từ, số chương và tiến độ mục tiêu.
- Chạy `story_get_project_info` để kiểm tra metadata tác giả, tên truyện.

### Bước 2: Xuất bản thảo theo định dạng (Export Manuscript)
- Gọi `story_export` với format mong muốn (`epub`, `docx`, `html`, `markdown_single`).

### Bước 3: Xuất Visual Dashboard (Generate Interactive Dashboard)
- Gọi `story_generate_dashboard` để tạo file HTML Dashboard báo cáo toàn cảnh dự án.

### Bước 4: Hướng dẫn xuất PDF (nếu cần PDF)
- Khi tác giả cần bản in PDF: xuất `html` qua `story_export({ "format": "html" })`, mở file bằng trình duyệt và chọn **In → Save as PDF**.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Xuất bản thảo đa định dạng | `story_export` | `format` (`markdown_single`, `html`, `epub`, `docx`), `includeOutline`, `outputPath` |
| Tạo Visual HTML Dashboard | `story_generate_dashboard` | `outputPath`, `autoOpen` |
| Kiểm tra tiến độ & số từ | `story_stats` | *(không tham số)* |
| Lấy thông tin dự án/tác giả | `story_get_project_info` | *(không tham số)* |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

1. **Xuất sách điện tử EPUB:**
   ```json
   story_export({ "format": "epub", "includeOutline": true })
   ```

2. **Tạo Visual HTML Dashboard:**
   ```json
   story_generate_dashboard({ "autoOpen": false })
   ```