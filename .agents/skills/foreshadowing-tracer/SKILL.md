---
name: foreshadowing-tracer
description: Quản lý kỹ thuật Chekhov's Gun cho tiểu thuyết: ghi nhận chi tiết cài cắm (setup), đánh dấu giải gỡ (payoff), liệt kê các "khẩu súng chưa bắn" (unfired) cần được thu hồi. Use khi cần đặt một chi tiết gài gắm vào chương, giải gỡ một manh mối cũ, kiểm tra những gài cắm nào chưa được giải quyết, lên kế hoạch payoff, theo dõi foreshadowing/plot threads trong dự án story-architect-mcp. Chekhov's gun setup/payoff tracking: log planted details, mark payoffs, and list unfired foreshadowing.
---

# Foreshadowing Tracer — Thợ săn manh mối & khẩu súng Chekhov

Kỹ năng này biến AI thành **Quản lý viên manh mối (Foreshadowing Manager)** chuyên nghiệp: đảm bảo mọi chi tiết cài cắm trong tiểu thuyết đều có nơi trú ngụ, có mốc thời gian, và quan trọng nhất là — **được giải gỡ đúng lúc**, không để "khẩu súng Chekhov" nào treo lơ lửng đến cuối truyện.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **MỖI SETUP LÀ MỘT LỜI HỨA (Every setup is a promise):**
   - Mọi chi tiết cài cắm (`story_log_setup`) là một lời hứa với độc giả — phải được trả bằng payoff.
   - Không để lọt setup mà không có kế hoạch thu hồi.

2. **TRƯỚC MỖI CHƯƠNG: KIỂM TRA SÚNG CHƯA BẮN (Check unfired first):**
   - Luôn gọi `story_list_unfired` trước khi viết một chương để biết manh mối nào cần giải gỡ tại đây.

3. **QUAN TRỌNG PHÂN CẤP (Importance matters):**
   - `importance` (`minor`/`moderate`/`major`) quyết định thứ tự ưu tiên payoff — major setup phải giải gỡ sớm, minor có thể để lâu.

4. **ĐỊNH VỊ CHÍNH XÁC (Precise anchoring):**
   - Luôn ghi `setupChapter`/`payoffChapter` theo chuẩn `arc_XX/ch_YYY` và trích `setupLine` khi cần để dễ truy vết.

---

## 📋 WORKFLOW QUẢN LÝ MANH MỐI (4 BƯỚC)

### Bước 1: Kế hoạch gài cắm (Setup Planning)
- Khi một chi tiết quan trọng xuất hiện (vật phẩm, câu nói, lời tiên tri, chi tiết nhỏ) — gọi `story_log_setup` ngay trong lúc viết.
- Xác định rõ `importance` để biết khi nào phải giải gỡ.

### Bước 2: Kiểm tra trước khi viết chương (Pre-chapter Check)
- Gọi `story_list_unfired` để lấy danh sách setup chưa có payoff.
- Đối chiếu với nội dung chương sắp viết: manh mối nào tự nhiên được giải gỡ ở đây.

### Bước 3: Thực hiện & ghi nhận payoff (Payoff Execution)
- Khi viết cảnh giải gỡ, gọi `story_log_payoff` với `id` của setup, mô tả cách giải gỡ và `payoffChapter`.
- Đảm bảo lời hứa được trả một cách thỏa đáng, không "giải gỡ lấp liếm".

### Bước 4: Rà soát tổng thể (Global Review)
- Chạy `story_list_unfired` định kỳ cuối mỗi arc.
- Những setup major còn treo khi truyện gần kết thúc → cảnh báo tác giả và đề xuất payoff kịp thời qua `story_generate_writing_prompt` (chiến lược `continue`).

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Ghi nhận cài cắm mới | `story_log_setup` | `setup`, `setupChapter`, `setupLine`, `importance` |
| Ghi nhận giải gỡ | `story_log_payoff` | `id`, `payoff`, `payoffChapter` |
| Liệt kê súng chưa bắn | `story_list_unfired` | *(không tham số)* |
| Soạn prompt viết cảnh payoff | `story_generate_writing_prompt` | `arc`, `chapter`, `strategy` |
| Lấy bối cảnh manh mối | `story_query_context` | `query`, `budgetTokens` |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Tình huống:** Ở Chương 2, nhân vật vô tình nhận chiếc nhẫn bạc khắc hình con rắn — đây là manh mối về thân phận thật của anh.

1. **Bước 1 — Ghi nhận setup ngay:**
   ```json
   story_log_setup({
     "setup": "Chiếc nhẫn bạc khắc hình rắn mà Lâm Phong nhận từ người lạ",
     "setupChapter": "arc_01/ch_002",
     "setupLine": "\"Giữ lấy, nó sẽ cứu mạng ngươi.\"",
     "importance": "major"
   })
   ```

2. **Bước 2 — Trước khi viết Chương 8:**
   ```json
   story_list_unfired({})
   ```
   → Trả về: `[major] arc_01/ch_002 — Chiếc nhẫn bạc khắc hình rắn`.

3. **Bước 3 — Giải gỡ ở Chương 8 (nhẫn phát sáng giữa trận chiến, tiết lộ huyết mạch):**
   ```json
   story_log_payoff({
     "id": "<id setup>",
     "payoff": "Nhẫn phát sáng khắc ấn huyết mạch, tiết lộ Lâm Phong là hậu duệ tộc Hắc Xà",
     "payoffChapter": "arc_01/ch_008"
   })
   ```

4. **Bước 4 — Cuối Arc:**
   ```json
   story_list_unfired({})
   ```
   → Nếu còn setup `major` treo: cảnh báo + đề xuất cảnh giải gỡ bằng `story_generate_writing_prompt({ "arc": "arc_01", "chapter": "ch_012", "strategy": "continue" })`.