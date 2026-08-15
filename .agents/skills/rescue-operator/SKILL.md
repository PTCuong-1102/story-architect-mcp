---
name: rescue-operator
description: Cứu hộ và tái cấu trúc dự án tiểu thuyết lộn xộn: quét thư mục không tổ chức, phát hiện encoding hỏng (UTF-8/Windows-1252/ISO-8859-1), tìm file trùng lặp, tự động sắp xếp lại cấu trúc chuẩn (manuscript/bible/outline/drafts_raw) với dry-run an toàn, snapshot và rollback. Use khi cần xử lý một thư mục tiểu thuyết cũ/ngổn ngang, khôi phục dự án bị lỗi, kiểm tra encoding tiếng Việt sai, sắp xếp lại file thảm họa, refactor cấu trúc project. Rescue messy/unorganized novel projects: encoding detection, duplicate detection, safe auto-refactoring, snapshot & rollback.
---

# Rescue Operator — Chuyên gia cứu hộ dự án

Kỹ năng này biến AI thành **Chuyên gia cứu hộ và tái cấu trúc** dự án tiểu thuyết: tiếp nhận những thư mục bản thảo "thảm họa" (file rải rác, encoding hỏng, trùng lặp) và đưa chúng về chuẩn cấu trúc `story-architect-mcp` một cách **an toàn tuyệt đối** — luôn có snapshot để quay lại bất cứ lúc nào.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **AN TOÀN LÀ TRÊN HẾT (Safety first):**
   - Mọi thao tác di chuyển/đổi tên file chỉ thực hiện sau khi có **snapshot** hoàn chỉnh.
   - Không bao giờ chạy `confirm: true` mà chưa cho tác giả xem preview.

2. **QUÉT TRƯỚC — HÀNH ĐỘNG SAU (Scan first, act later):**
   - Luôn bắt đầu bằng `story_scan_messy_project` để có bức tranh toàn cảnh: loại file, encoding, độ tương đồng.

3. **ENCODING LÀ RÀO CẢN ĐẦU TIÊN (Encoding gate):**
   - File tiếng Việt sai encoding (mojibake) phải được phát hiện và đánh dấu trước khi xử lý nội dung — nếu không, mọi phân loại tiếp theo đều vô nghĩa.

4. **KHÔNG BAO GIỜ GHI ĐÈ DỮ LIỆU GỐC (Never overwrite originals):**
   - File gốc chỉ được di chuyển (move), không xóa; nếu cần thay đổi nội dung, giữ bản gốc trong `drafts_raw/`.

---

## 📋 WORKFLOW CỨU HỘ (5 BƯỚC)

### Bước 1: Thiết lập dự án (Setup)
- Gọi `story_set_project` với `projectPath` trỏ tới thư mục cần cứu hộ (bật `force: true` nếu thư mục chưa theo chuẩn).
- Nếu chưa có dự án, dùng `story_init` để tạo cấu trúc chuẩn trong thư mục.

### Bước 2: Quét toàn diện (Comprehensive Scan)
- Gọi `story_scan_messy_project` với `path` và `detectDuplicates: true`.
- Phân tích kết quả: phân loại file (Manuscript/Lore/Notes/Outline), encoding phát hiện (đặc biệt file Windows-1252/ISO-8859-1), các cặp file trùng lặp.

### Bước 3: Lập kế hoạch refactor (Dry-run Preview)
- Gọi `story_auto_refactor_structure` với `projectPath`, `strategy` (`by_chapter`/`by_arc`/`chronological`), `confirm: false`.
- Trình bày bảng preview cho tác giả: file nào sẽ di chuyển vào đâu.

### Bước 4: Snapshot & thực thi (Snapshot + Execute)
- Gọi `story_snapshot` với `label: "pre-refactor"` + `description` chi tiết.
- Gọi `story_auto_refactor_structure` với `confirm: true` (hệ thống tự snapshot thêm một lần nữa trước khi chạy).

### Bước 5: Kiểm tra & khôi phục nếu cần (Verify & Rollback)
- Xác minh cấu trúc mới bằng `story_get_project_info`.
- Nếu kết quả không như mong đợi → `story_rollback` về snapshot `pre-refactor`.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Trỏ vào dự án cần cứu hộ | `story_set_project` | `projectPath`, `force` |
| Tạo dự án chuẩn mới | `story_init` | `name`, `targetWordCount` |
| Quét & phân loại file | `story_scan_messy_project` | `path`, `detectDuplicates` |
| Xem preview refactor | `story_auto_refactor_structure` | `projectPath`, `strategy`, `confirm: false` |
| Thực thi refactor | `story_auto_refactor_structure` | `projectPath`, `strategy`, `confirm: true` |
| Tạo snapshot thủ công | `story_snapshot` | `label`, `description` |
| Khôi phục | `story_rollback` | `snapshotId`, `confirm` |
| Kiểm tra kết quả | `story_get_project_info` | *(không tham số)* |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Cứu hộ thư mục tiểu thuyết cũ của tôi nằm ở /tmp/old-novel."

1. **Bước 1 — Thiết lập:**
   ```json
   story_set_project({ "projectPath": "/tmp/old-novel", "force": true })
   ```

2. **Bước 2 — Quét:**
   ```json
   story_scan_messy_project({ "path": "/tmp/old-novel", "detectDuplicates": true })
   ```
   → Kết quả: 25 file; 3 file encoding Windows-1252 (cần chú ý), 2 cặp trùng lặp, phân loại: 18 Manuscript, 4 Lore, 3 Notes.

3. **Bước 3 & 4 — Preview → Snapshot → Execute:**
   ```json
   story_auto_refactor_structure({ "projectPath": "/tmp/old-novel", "strategy": "by_chapter", "confirm": false })
   // tác giả duyệt xong:
   story_snapshot({ "label": "pre-refactor", "description": "Trước khi refactor thư mục cũ" })
   story_auto_refactor_structure({ "projectPath": "/tmp/old-novel", "strategy": "by_chapter", "confirm": true })
   ```

4. **Bước 5 — Kiểm tra:**
   ```json
   story_get_project_info({})
   ```
   → Nếu có vấn đề: `story_rollback({ "confirm": true })` để về trạng thái trước refactor.