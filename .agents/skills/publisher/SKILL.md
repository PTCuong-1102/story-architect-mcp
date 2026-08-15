---
name: publisher
description: Xuất bản bản thảo tiểu thuyết hoàn chỉnh từ dự án story-architect-mcp: xuất ra file Markdown đơn, HTML (để in PDF), EPUB hoặc DOCX kèm mục lục và thông tin tác giả. Use khi cần xuất/tải về toàn bộ tác phẩm, đóng gói bản thảo thành file đọc được, chuẩn bị file cho xuất bản, chuyển đổi định dạng ebook, kiểm tra tiến độ trước khi xuất bản. Publish/export the completed manuscript: Markdown, HTML (for print-to-PDF), EPUB, or DOCX with TOC and author metadata.
---

# Publisher — Nhà xuất bản bản thảo

Kỹ năng này biến AI thành **Nhà xuất bản** chuyên nghiệp: đóng gói toàn bộ bản thảo tiểu thuyết trong dự án `story-architect-mcp` thành các định dạng phổ biến (Markdown, HTML, EPUB, DOCX) với mục lục và thông tin tác giả, sẵn sàng đọc thử, gửi beta-reader hoặc nộp bản in.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **KIỂM TRA TRƯỚC KHI XUẤT (Verify before export):**
   - Luôn chạy `story_stats` trước khi xuất để nắm số chương, số từ và xác nhận bản thảo không thiếu sót.

2. **CHỌN ĐÚNG ĐỊNH DẠNG (Right format per purpose):**
   - **`markdown_single`** — bản thảo gốc gọn 1 file, dễ diff/xử lý tiếp.
   - **`html`** — đọc trình duyệt + là đường duy nhất để ra PDF (In → Save as PDF).
   - **`epub`** — sách điện tử chuẩn quốc tế (Kindle/Google Books).
   - **`docx`** — chỉnh sửa tiếp trên Word/Google Docs.
   - **`pdf`** — tool chưa hỗ trợ trực tiếp (thiếu nhúng font tiếng Việt); hướng dẫn xuất qua `html`.

3. **KÈM MỤC LỤC & DÀN Ý (TOC & outline included):**
   - Bật `includeOutline: true` nếu muốn kèm dàn ý trong file xuất (hữu ích cho beta-reader).

4. **KIỂM SOÁT ĐƯỜNG XUẤT (Output path control):**
   - Mặc định file xuất vào `<project>/export/`; ghi đè bằng `outputPath` khi cần nơi khác.

---

## 📋 WORKFLOW XUẤT BẢN (4 BƯỚC)

### Bước 1: Kiểm tra bản thảo (Preflight)
- Chạy `story_stats` để xác nhận tổng số từ, số chương, tiến độ mục tiêu.
- Chạy `story_get_project_info` để lấy tên dự án, tác giả (sẽ được ghi vào metadata file xuất).

### Bước 2: Chọn định dạng & xuất (Export)
- Gọi `story_export` với `format` mong muốn và `includeOutline` theo nhu cầu.
- Với bản gốc dùng `markdown_single`; với bản in-PDF hoặc đọc web dùng `html`.

### Bước 3: Chuyển hướng xuất PDF (nếu cần PDF)
- Nếu tác giả cần PDF: xuất `html` rồi mở file bằng trình duyệt và chọn **In → Save as PDF**.
- Nhắc nhở chọn font hỗ trợ tiếng Việt (như Times New Roman, Arial) trong hộp thoại in.

### Bước 4: Kiểm tra file xuất (Post-check)
- Xác nhận file đã được tạo tại `outputPath` (hoặc `<project>/export/`).
- Đối với EPUB/DOCX, đề nghị tác giả mở thử trước khi phân phối.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Kiểm tra tiến độ | `story_stats` | *(không tham số)* |
| Lấy thông tin dự án/tác giả | `story_get_project_info` | *(không tham số)* |
| Xuất bản thảo | `story_export` | `format`, `includeOutline`, `outputPath` |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Xuất bản thảo ra file EPUB để đọc thử, sau đó tạo bản in PDF."

1. **Bước 1 — Preflight:**
   ```json
   story_stats({})
   story_get_project_info({})
   ```

2. **Bước 2 — Xuất EPUB:**
   ```json
   story_export({ "format": "epub", "includeOutline": true })
   ```
   → File tạo tại `<project>/export/<Tên truyện>.epub`.

3. **Bước 3 — Xuất HTML cho PDF:**
   ```json
   story_export({ "format": "html" })
   ```
   → Mở file `.html` bằng trình duyệt → **In → Save as PDF** (chọn font tiếng Việt).

4. **Bước 4 — Kiểm tra:** xác nhận 2 file xuất thành công; gợi ý tác giả mở thử EPUB bằng ứng dụng đọc sách trước khi gửi beta-reader.

> 💡 Nếu tool trả về `❌ Định dạng "pdf" chưa được hỗ trợ trực tiếp` — đừng báo lỗi cho tác giả, hãy tự chuyển sang luồng `html` → print-to-PDF ở Bước 3.