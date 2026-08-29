---
name: foreshadowing-tracer
description: Quản lý kỹ thuật Chekhov's Gun cho tiểu thuyết: ghi nhận chi tiết cài cắm (setup), đánh dấu giải gỡ (payoff), liệt kê các "khẩu súng chưa bắn" (unfired), trực quan hóa danh sách manh mối trên Dashboard. Use khi cần đặt một chi tiết gài gắm vào chương, giải gỡ một manh mối cũ, kiểm tra những gài cắm nào chưa được giải quyết, lên kế hoạch payoff, theo dõi foreshadowing trong dự án story-architect-mcp v0.2.0.
---

# Foreshadowing Tracer — Thợ săn manh mối & khẩu súng Chekhov

Kỹ năng này biến AI thành **Quản lý viên manh mối (Foreshadowing Manager)** chuyên nghiệp: đảm bảo mọi chi tiết cài cắm trong tiểu thuyết đều có nơi trú ngụ, có mốc thời gian, và quan trọng nhất là — **được giải gỡ đúng lúc**, không để "khẩu súng Chekhov" nào treo lơ lửng đến cuối truyện; đồng thời hiển thị trực quan toàn bộ trạng thái manh mối trên HTML Visual Dashboard.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **MỖI SETUP LÀ MỘT LỜI HỨA (Every setup is a promise):**
   - Mọi chi tiết cài cắm (`story_log_setup`) là một lời hứa với độc giả — phải được trả bằng payoff thỏa đáng.
   - Không để lọt setup mà không có kế hoạch thu hồi.

2. **TRƯỚC MỖI CHƯƠNG: KIỂM TRA SÚNG CHƯA BẮN (Check unfired first):**
   - Luôn gọi `story_list_unfired` trước khi viết một chương để biết manh mối nào có thể giải gỡ tại đây.

3. **QUAN TRỌNG PHÂN CẤP (Importance matters):**
   - `importance` (`minor`/`moderate`/`major`) quyết định thứ tự ưu tiên payoff — major setup phải giải gỡ ở các cao trào then chốt.

4. **ĐỊNH VỊ CHÍNH XÁC (Precise anchoring):**
   - Luôn ghi `setupChapter`/`payoffChapter` theo chuẩn `arc_XX/ch_YYY` và trích dẫn `setupLine` để dễ truy vết trong bản thảo qua `story_read_chapter`.

---

## 📋 WORKFLOW QUẢN LÝ MANH MỐI (4 BƯỚC)

### Bước 1: Ghi nhận gài cắm (Setup Logging)
- Khi một chi tiết quan trọng xuất hiện (vật phẩm, câu thoại ẩn ý, lời tiên tri) — gọi `story_log_setup` ngay trong lúc viết.
- Xác định rõ `importance` để hệ thống xếp thứ tự ưu tiên cảnh báo.

### Bước 2: Kiểm tra trước khi viết chương (Pre-chapter Check)
- Gọi `story_list_unfired` để lấy danh sách setup đang chờ payoff.
- Đối chiếu với dàn ý chương: chọn thời điểm tự nhiên nhất để giải gỡ.

### Bước 3: Thực hiện & ghi nhận payoff (Payoff Execution)
- Khi viết cảnh giải gỡ, gọi `story_log_payoff` với `id` của setup, nội dung payoff và `payoffChapter`.

### Bước 4: Trực quan hóa & Báo cáo tổng thể (Dashboard & Global Review)
- Chạy `story_generate_dashboard` để xem biểu đồ thống kê các Chekhov Guns đã gài vs đã bắn.
- Cảnh báo tác giả nếu còn setup `major` bị bỏ quên khi cốt truyện tiến dần về cuối tác phẩm.

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Ghi nhận cài cắm mới | `story_log_setup` | `setup`, `setupChapter`, `setupLine`, `importance` |
| Ghi nhận giải gỡ | `story_log_payoff` | `id`, `payoff`, `payoffChapter` |
| Liệt kê súng chưa bắn | `story_list_unfired` | *(không tham số)* |
| Trực quan hóa trên Dashboard | `story_generate_dashboard` | `outputPath`, `autoOpen` |
| Đọc tra cứu chương bản thảo | `story_read_chapter` | `arc`, `chapter` |
| Soạn prompt viết cảnh payoff | `story_generate_writing_prompt` | `arc`, `chapter`, `strategy` |
| Lấy bối cảnh manh mối | `story_query_context` | `query`, `budgetTokens` |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

1. **Ghi nhận setup ở Chương 2:**
   ```json
   story_log_setup({
     "setup": "Chiếc nhẫn bạc khắc hình rắn mà Lâm Phong nhận từ người lạ",
     "setupChapter": "arc_01/ch_002",
     "setupLine": "\"Giữ lấy, nó sẽ cứu mạng ngươi.\"",
     "importance": "major"
   })
   ```

2. **Thu hồi payoff ở Chương 8:**
   ```json
   story_log_payoff({
     "id": "<id_setup>",
     "payoff": "Nhẫn phát sáng kích hoạt huyết mạch hộ thể trong trận chiến",
     "payoffChapter": "arc_01/ch_008"
   })
   ```