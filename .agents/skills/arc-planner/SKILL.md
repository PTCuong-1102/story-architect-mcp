---
name: arc-planner
description: Lập kế hoạch Arc & nhịp độ truyện (story arc planning & pacing): thiết kế cấu trúc arc, phân chia phân cảnh (scenes), đặt mục tiêu tỷ lệ Action/Dialogue/Description, kiểm soát đường cong căng thẳng (tension curve), chuẩn bị dàn ý chương. Use khi cần lên kế hoạch một arc mới, thiết kế scene structure, đánh giá nhịp độ một arc/chương, phân phối hành động-hội thoại-mô tả, cân bằng tốc độ truyện trong dự án story-architect-mcp. Arc structure & pacing planning: scene breakdown, Action/Dialogue/Description targets, and tension curve control.
---

# Arc Planner — Kiến trúc sư cốt truyện & nhịp độ

Kỹ năng này biến AI thành **Nhà thiết kế cấu trúc Arc và nhịp độ** chuyên nghiệp: lên kế hoạch từng Arc tiểu thuyết với cấu trúc phân cảnh rõ ràng, đặt chỉ tiêu nhịp độ (Action/Dialogue/Description) và kiểm soát đường cong căng thẳng để câu chuyện luôn cuốn hút.

---

## 🎯 NGUYÊN TẮC HOẠT ĐỘNG CỐT LÕI

1. **CẤU TRÚC 3 CỤM (Three-beat structure):**
   - Mỗi Arc có **Set-up** (thiết lập) → **Rising action** (leo thang xung đột) → **Climax/Resolution** (cao trào & hạ màn).
   - Mỗi Scene trong Arc cũng theo nhịp **Goal → Conflict → Disaster/Turn**.

2. **NHỊP ĐỘ THEO LOẠI CẢNH (Pacing by scene type):**
   - **Cảnh hành động/kịch tính:** tỷ lệ Action cao, câu ngắn, nhịp gấp.
   - **Cảnh tâm lý/tả cảnh:** tỷ lệ Description cao, câu dài, chậm rãi.
   - Không để một chương toàn hành động (mệt) hoặc toàn tả cảnh (chán).

3. **ĐO LƯỜNG = KIỂM SOÁT (Measure to control):**
   - Sau khi lập kế hoạch, dùng `story_analyze_pacing` để so sánh nhịp độ thực tế với chỉ tiêu đặt ra.

4. **QUAN HỆ LÀ ĐỘNG CƠ XUNG ĐỘT (Relationships drive conflict):**
   - Tham khảo `story_map_relationships` để biết xung đột tiềm năng nào có thể khai thác trong Arc.

---

## 📋 WORKFLOW LẬP KẾ HOẠCH ARC (5 BƯỚC)

### Bước 1: Khảo sát hiện trạng (Survey)
- Chạy `story_stats` để nắm tổng số từ, số chương, tiến độ so với `targetWordCount`.
- Truy vấn `story_query_context` về các tuyến nhân vật sẽ tham gia Arc.

### Bước 2: Xác định mục tiêu Arc (Arc Goal)
- Xác định xung đột trung tâm, mục tiêu nhân vật, và điểm lật (turning point) cuối Arc.
- Kiểm tra các mối quan hệ đang biến động qua `story_map_relationships`.

### Bước 3: Phân chia phân cảnh (Scene Breakdown)
- Chia Arc thành các chương; mỗi chương 2–4 Scene.
- Với mỗi Scene, định nghĩa **Goal**, **Conflict**, **Disaster/Turn** và đặt chỉ tiêu nhịp độ sơ bộ.

### Bước 4: Ghi dàn ý (Outline Persist)
- Soạn `overview.md` + các file outline chương trong `outline/arc_XX/` (theo đúng cấu trúc dự án chuẩn).

### Bước 5: Kiểm chứng nhịp độ sau khi viết (Post-write Verification)
- Gọi `story_analyze_pacing` với `arc` sau mỗi vài chương.
- So sánh tỷ lệ Action/Dialogue/Description với chỉ tiêu; nếu lệch nhiều → đề xuất điều chỉnh ở chương tiếp theo (nhờ `story_generate_writing_prompt` chiến lược `rewrite`/`expand` nếu cần).

---

## 🛠️ BẢNG ÁNH XẠ CÔNG CỤ MCP

| Mục đích | Tool MCP | Tham số chính |
| :--- | :--- | :--- |
| Thống kê tiến độ | `story_stats` | *(không tham số)* |
| Lấy bối cảnh tuyến nhân vật | `story_query_context` | `query`, `budgetTokens` |
| Khảo sát quan hệ xung đột | `story_map_relationships` | `source`, `target`, `type` |
| Đo nhịp độ thực tế | `story_analyze_pacing` | `arc`, `chapter` |
| Soạn prompt viết chương | `story_generate_writing_prompt` | `arc`, `chapter`, `strategy` |
| Khởi tạo cấu trúc dự án | `story_init` | `name`, `targetWordCount` |

---

## 💡 VÍ DỤ MINH HỌA QUY TRÌNH

**Yêu cầu:** "Lên kế hoạch Arc 2 — Cuộc vây hãm Hắc Phong Thành (dự kiến 10 chương)."

1. **Bước 1 & 2 — Khảo sát & mục tiêu:**
   ```json
   story_stats({})
   story_query_context({ "query": "Hắc Phong Thành Hắc Vũ" })
   story_map_relationships({ "source": "Lâm Phong", "target": "Hắc Vũ" })
   ```

2. **Bước 3 — Phân chia nhịp độ theo cụm:**
   - **ch_001–003 (Set-up):** hội quân, 60% Description, 25% Dialogue.
   - **ch_004–007 (Rising):** giao tranh leo thang, 45% Action, 30% Dialogue.
   - **ch_008–010 (Climax):** đại chiến thành, 60% Action, câu ngắn.

3. **Bước 4 — Ghi dàn ý:** tạo `outline/arc_02/overview.md` + outline từng chương.

4. **Bước 5 — Kiểm chứng:**
   ```json
   story_analyze_pacing({ "arc": "arc_02" })
   ```
   → Nếu ch_005 đang 30% Action (thiếu so với mục tiêu 45%) → đề xuất thêm 1 cảnh xô xát hoặc rút ngắn đoạn hồi tưởng.