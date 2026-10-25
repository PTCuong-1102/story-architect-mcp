---
name: rescue-operator
description: >-
  Cứu hộ và tái cấu trúc dự án tiểu thuyết lộn xộn: quét thư mục không tổ chức, phát hiện encoding hỏng (UTF-8/Windows-1252/ISO-8859-1), tìm file trùng lặp, tự động sắp xếp lại cấu trúc chuẩn (manuscript/bible/outline/drafts_raw) với dry-run an toàn, snapshot tự động và rollback. Use khi cần xử lý một thư mục tiểu thuyết cũ/ngổn ngang, khôi phục dự án bị lỗi, kiểm tra encoding tiếng Việt sai trong dự án story-architect-mcp v0.7.0.
---

# Rescue Operator — Chuyên gia cứu hộ & tái cấu trúc dự án

Kỹ năng này biến AI thành **Chuyên gia cứu hộ và tái cấu trúc** dự án tiểu thuyết: tiếp nhận những thư mục bản thảo "thảm họa" (file rải rác, encoding hỏng, trùng lặp) và đưa chúng về chuẩn cấu trúc `story-architect-mcp v0.7.0` một cách **an toàn tuyệt đối** — luôn tự động tạo snapshot trước khi sửa đổi để có thể quay lại bất cứ lúc nào.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **AN TOÀN LÀ TRÊN HẾT (Safety first):**
   - Mọi thao tác di chuyển/đổi tên file hay ghi đè chỉ thực hiện sau khi có **snapshot** hoàn chỉnh.
   - Không bao giờ chạy `confirm: true` mà chưa cho tác giả xem preview (`confirm: false`).

2. **QUÉT TRƯỚC — HÀNH ĐỘNG SAU (Scan first, act later):**
   - Luôn bắt đầu bằng `story_scan_messy_project` để có bức tranh toàn cảnh: loại file, encoding, độ tương đồng và các file trùng lặp.

3. **ENCODING LÀ RÀO CẢN ĐẦU TIÊN (Encoding gate):**
   - File tiếng Việt sai encoding (mojibake) phải được phát hiện và giải mã đúng trước khi xử lý nội dung.

4. **KHÔNG BAO GIỜ GHI ĐÈ DỮ LIỆU GỐC (Never overwrite originals):**
   - File gốc chỉ được di chuyển (move) vào `drafts_raw/`, không xóa vĩnh viễn.

---

## 📋 WORKFLOW CỨU HỘ DỰ ÁN (5 BƯỚC)

### Bước 1: Thiết lập dự án đích (Project Setup)
- Gọi `story_set_project` với `projectPath` trỏ tới thư mục cần cứu hộ (bật `force: true` nếu thư mục chưa theo chuẩn); có nhiều dự án đang mở thì kiểm tra bằng `story_list_projects` (v0.3.0) trước.
- Nếu thư mục mới hoàn toàn, dùng `story_init` để tạo cấu trúc chuẩn.

### Bước 2: Quét & phát hiện sự cố toàn diện (Comprehensive Scan)
- Gọi `story_scan_messy_project` với `path` và `detectDuplicates: true`.
- Đánh giá danh sách encoding lỗi (Windows-1252/ISO-8859-1) và các cặp file trùng lặp.

### Bước 3: Lập kế hoạch tái cấu trúc (Dry-run Preview)
- Gọi `story_auto_refactor_structure` với `strategy` (mặc định từ v0.6.0 là `auto_profile` — tự chọn hành vi theo bố cục nhận diện; còn `by_chapter`/`by_arc`/`chronological` nếu muốn ép kiểu) và `confirm: false`.
- **từ v0.7.0 — luồng phán đoán AI (khuyến nghị khi bố cục quirks):** gọi `story_export_layout_brief` → đọc brief (cây file + trích nội dung + heuristic profile) → phán đoán bằng NGỮ CẢNH (chương không từ khóa "Chương", tên file tự đặt, truyện thư từ/ngày tháng...) → nộp `story_apply_layout_verdict` (chapters có startLine 1-based; hình dạng JSON đúng → server tự xác thực) → chạy lại refactor: preview sẽ nhắc "🧠 Phán đoán AI". Để quay về heuristic: xóa `.story/layout-verdict.json`.
- Bố cục từng dạng tác giả bố trí trước khi cài tool được nhận diện tự động: thư mục arc tự đặt tên ("Quyển 3", "phan 2"...) → map `arc_XX`; chương phẳng → đánh số lại; một file lớn chứa cả quyển ("Chương N"/"Chapter N"/"第N章" — cả số chữ "mười hai", La Mã, Hán tự) → ✂️ TÁCH thành ch_XXX (bản gốc bảo toàn drafts_raw/). Trình bày bảng preview chi tiết cho tác giả duyệt.

### Bước 4: Tạo Snapshot & Thực thi an toàn (Snapshot & Execute)
- Gọi `story_snapshot` với label rõ ràng trước khi hành động.
- Gọi `story_auto_refactor_structure` với `confirm: true` (hệ thống tự động backup pre-refactor snapshot).

### Bước 5: Kiểm tra kết quả & Khôi phục nếu có lỗi (Verify & Rollback)
- Kiểm tra tính toàn vẹn bằng `story_get_project_info` và `story_stats`.
- Đọc thử các chương đã dọn dẹp bằng `story_read_chapter`.
- Nếu có sai sót: lập tức gọi `story_rollback` để khôi phục nguyên trạng.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Quét & phân loại file lộn xộn | `story_scan_messy_project` | `path`, `detectDuplicates` |
| Xem preview tái cấu trúc | `story_auto_refactor_structure` | `projectPath`, `strategy`, `confirm: false` |
| Thực thi tái cấu trúc chuẩn | `story_auto_refactor_structure` | `projectPath`, `strategy`, `confirm: true` |
| Tạo snapshot thủ công | `story_snapshot` | `label`, `description` |
| Khôi phục snapshot | `story_rollback` | `snapshotId`, `confirm` |
| Dọn snapshot cũ (preview trước) | `story_prune_snapshots` | `keepLast`, `olderThanDays`, `confirm` — v0.5.0 |
| Đọc kiểm tra chương sau cứu hộ | `story_read_chapter` | `arc`, `chapter` |
| Ghi lại nội dung chương an toàn | `story_write_chapter` | `arc`, `chapter`, `content`, `title` |
| Thiết lập thư mục làm việc | `story_set_project` | `projectPath`, `force` |
| Xem dự án đang mở trong phiên | `story_list_projects` | *(không tham số)* — v0.3.0 |
| Kiểm tra trạng thái dự án | `story_get_project_info` / `story_stats` | *(không tham số)* |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

1. **Quét thư mục cũ:**
   ```json
   story_set_project({ "projectPath": "/tmp/old-novel", "force": true })
   story_scan_messy_project({ "path": "/tmp/old-novel", "detectDuplicates": true })
   ```

2. **Xem trước kế hoạch sắp xếp:**
   ```json
   story_auto_refactor_structure({ "projectPath": "/tmp/old-novel", "strategy": "by_chapter", "confirm": false })
   ```

3. **Tạo snapshot và thực thi:**
   ```json
   story_snapshot({ "label": "pre-rescue", "description": "Sao lưu trước khi dọn dẹp thư mục" })
   story_auto_refactor_structure({ "projectPath": "/tmp/old-novel", "strategy": "by_chapter", "confirm": true })
   ```