import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { StoryProject } from '../../server/StoryProject.js';
import type { CharacterStateSnapshot } from '../../server/types.js';
import { errResult, requireProject, isToolError } from '../../utils/mcpResults.js';
import { compareNatural } from '../../utils/fileUtils.js';

/**
 * Chuẩn hóa tên/chương để so khớp: chữ thường + `_`→space + gộp space.
 * Nhờ đó "Tiêu Viêm", "tiêu viêm" và "tieu_viem"-dạng-hiển-thị không
 * tạo thành 2 hồ sơ khác nhau; "arc_01/ch_002" và "ch_002"-lệch-format
 * vẫn khớp khi phần lõi giống nhau.
 */
function normKey(s: string): string {
  return s.toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

/** Chuẩn hoá item so sánh (substance-level, bỏ hoa/thường + space thừa). */
function diffKey(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Diff 2 mốc kế tiếp: mất/thu vật phẩm, bí mật mới học (read-only, không đổi file). */
function transitionDiff(prev: CharacterStateSnapshot, cur: CharacterStateSnapshot) {
  const prevInv = new Set(prev.inventory.map(diffKey));
  const curInv = new Set(cur.inventory.map(diffKey));
  const inventoryLost = cur.inventory.filter(i => !prevInv.has(diffKey(i)));
  const inventoryAcquired = prev.inventory.filter(i => !curInv.has(diffKey(i)));
  const prevSecrets = new Set(prev.knownSecrets.map(diffKey));
  const secretsLearned = cur.knownSecrets.filter(k => !prevSecrets.has(diffKey(k)));
  const locationChanged = diffKey(prev.location || '') !== diffKey(cur.location || '');
  const conditionChanged = diffKey(prev.condition || '') !== diffKey(cur.condition || '');
  return {
    inventoryLost,
    inventoryAcquired,
    secretsLearned,
    locationChanged,
    conditionChanged,
    statusChanged: prev.status !== cur.status,
  };
}

/** Chế dòng "biến động so với mốc trước" danh sách bullet ngắn gọn. */
function diffLine(prev?: CharacterStateSnapshot, cur?: CharacterStateSnapshot): string {
  let out = '';
  if (prev) {
    const d = transitionDiff(prev, cur!);
    const bits: string[] = [];
    for (const lost of d.inventoryLost) bits.push(`− 🎒 ${lost}`);
    for (const got of d.inventoryAcquired) bits.push(`+ 🎒 ${got}`);
    for (const s of d.secretsLearned) bits.push(`+ 🗝️ ${s}`);
    if (d.statusChanged) bits.push(`🛡️ ${prev.status} → ${cur!.status}`);
    if (d.conditionChanged) bits.push('🩺 tình trạng thay đổi');
    if (d.locationChanged) bits.push(`📍 ${prev.location || 'N/A'} → ${cur!.location || 'N/A'}`);
    if (bits.length > 0) out = `- **Biến động so với mốc trước**: ${bits.join(' | ')}`;
  }
  return out;
}

export function registerCharacterStateTools(
  server: McpServer,
  getProject: () => StoryProject
): void {
  server.registerTool(
    'story_track_character_state',
    {
      title: 'Track & Query Character State, Location & Inventory',
      description: 'Ghi nhận hoặc truy vấn trạng thái nhân vật theo từng mốc chương (vị trí hiện tại, vật phẩm/vũ khí mang theo, tình trạng thương tích, bí mật đã biết) để đảm bảo tính liên tục (continuity).',
      inputSchema: z.object({
        character: z.string().min(1).max(200).describe('Tên nhân vật (ví dụ: "Tiêu Viêm", "nhan_vat_chinh")'),
        chapter: z.string().optional().describe('Chương ghi nhận hoặc muốn truy vấn (ví dụ: "arc_01/ch_002")'),
        action: z.enum(['log', 'query', 'history']).default('query').describe('Thao tác: "log" (ghi nhận mới), "query" (lấy trạng thái mới nhất), "history" (lịch sử biến đổi)'),
        state: z.object({
          location: z.string().optional().describe('Vị trí địa lý hiện tại'),
          inventory: z.array(z.string()).optional().describe('Danh sách vật phẩm / trang bị mang theo'),
          condition: z.string().optional().describe('Tình trạng thể chất / cảm xúc (bị thương, kiệt sức, giác ngộ...)'),
          status: z.enum(['alive', 'injured', 'unconscious', 'captured', 'dead', 'unknown']).default('alive'),
          knownSecrets: z.array(z.string()).optional().describe('Bí mật hoặc manh mối mới biết được'),
          notes: z.string().optional().describe('Ghi chú bổ sung'),
        }).optional().describe('Thông tin trạng thái khi thực hiện action="log"'),
      }),
    },
    async (params) => {
      const project = requireProject(getProject);
      if (isToolError(project)) return project;
      if (!await project.isInitialized()) {
        return errResult('❌ Dự án chưa được khởi tạo. Hãy chạy story_init trước.');
      }

      const statesFile = await project.getCharacterStates();
      const normChar = normKey(params.character);

      let charHistory = statesFile.characters.find(
        c => normKey(c.character) === normChar
      );

      // ─── ACTION: LOG ───
      if (params.action === 'log') {
        if (!params.chapter) {
          return errResult('❌ Cần chỉ định tham số "chapter" khi ghi nhận trạng thái nhân vật (action="log").');
        }
        // Giữ bản sao đã narrow để dùng trong closure bên dưới
        const logChapter: string = params.chapter;

        const snapshot: CharacterStateSnapshot = {
          chapter: params.chapter,
          location: params.state?.location,
          inventory: params.state?.inventory || [],
          condition: params.state?.condition,
          status: params.state?.status || 'alive',
          knownSecrets: params.state?.knownSecrets || [],
          notes: params.state?.notes || '',
          timestamp: new Date().toISOString(),
        };

        // Mutate-in-lock: đọc→upsert snapshot→ghi trong cùng khoá.
        // State cũ không dùng để báo cáo (report dựa trên `snapshot`)
        // nên bỏ được khoảng trống get→save dễ race.
        await project.updateCharacterStates(cur => {
          const characters = [...cur.characters];
          const idx = characters.findIndex(c => normKey(c.character) === normChar);
          if (idx < 0) {
            characters.push({ character: params.character, states: [snapshot] });
          } else {
            const states = [...characters[idx].states];
            const sIdx = states.findIndex(s => normKey(s.chapter ?? '') === normKey(logChapter));
            if (sIdx >= 0) {
              states[sIdx] = snapshot;
            } else {
              states.push(snapshot);
            }
            characters[idx] = { ...characters[idx], states };
          }
          return { ...cur, characters };
        });

        return {
          content: [{
            type: 'text' as const,
            text: `✅ Đã ghi nhận trạng thái nhân vật "${params.character}" tại chương \`${params.chapter}\`:

👤 Nhân vật: ${params.character}
📍 Vị trí: ${snapshot.location || '_chưa ghi nhận_'}
🛡️ Trạng thái: ${snapshot.status} ${snapshot.condition ? `(${snapshot.condition})` : ''}
🎒 Hành trang / Đồ vật (${snapshot.inventory.length}): ${snapshot.inventory.length > 0 ? snapshot.inventory.join(', ') : '_trống_'}
🗝️ Bí mật / Manh mối đã biết (${snapshot.knownSecrets.length}): ${snapshot.knownSecrets.length > 0 ? snapshot.knownSecrets.join(', ') : '_không có_'}
📝 Ghi chú: ${snapshot.notes || '_không có_'}`,
          }],
        };
      }

      // ─── ACTION: HISTORY ───
      if (params.action === 'history') {
        if (!charHistory || charHistory.states.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `ℹ️ Chưa có lịch sử trạng thái nào cho nhân vật "${params.character}".`,
            }],
          };
        }

        // Sắp xếp theo thứ tự chương tự nhiên (ch_002 < ch_010),
        // không phụ thuộc thứ tự log.
        const orderedStates = [...charHistory.states].sort((a, b) => compareNatural(a.chapter, b.chapter));
        const historyLines = orderedStates.map((s, idx) => {
          // v0.4.0: kèm diff với mốc kế trước theo thứ tự chương —
          // continuity review thấy ngay mất/thu gì mà không cần so tay 2 snapshot.
          const transition = idx > 0 ? diffLine(orderedStates[idx - 1], s) : '';
          const transitionBlock = transition ? `\n${transition}` : '';
          return `### ${idx + 1}. Mốc: ${s.chapter}
- **Vị trí**: ${s.location || 'N/A'}
- **Tình trạng**: ${s.status} ${s.condition ? `(${s.condition})` : ''}
- **Hành trang**: ${s.inventory.length > 0 ? s.inventory.join(', ') : 'Trống'}
- **Bí mật đã biết**: ${s.knownSecrets.length > 0 ? s.knownSecrets.join('; ') : 'Chưa có'}
- **Ghi chú**: ${s.notes || 'Không'}${transitionBlock}`;
        }).join('\n\n');

        return {
          content: [{
            type: 'text' as const,
            text: `# 📜 Lịch Sử Trạng Thái Nhân Vật: ${params.character} (${charHistory.states.length} mốc)

${historyLines}`,
          }],
        };
      }

      // ─── ACTION: QUERY (DEFAULT) ───
      if (!charHistory || charHistory.states.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `ℹ️ Chưa có dữ liệu trạng thái cho nhân vật "${params.character}". Bạn có thể dùng action="log" để bắt đầu ghi nhận.`,
          }],
        };
      }

      let targetState: CharacterStateSnapshot | undefined;
      let targetDesc = '';

      if (params.chapter) {
        const queryNorm = normKey(params.chapter);
        targetState = charHistory.states.find(s => normKey(s.chapter) === queryNorm);
        if (!targetState) {
          // Tìm mốc gần nhất ghi nhận trước hoặc tại chương này
          const priorStates = charHistory.states
            .filter(s => compareNatural(s.chapter, params.chapter!) <= 0)
            .sort((a, b) => compareNatural(a.chapter, b.chapter));
          targetState = priorStates.pop();
          if (targetState) {
            targetDesc = `Trạng thái của "${params.character}" tính đến ${params.chapter} (mốc gần nhất tại ${targetState.chapter})`;
          } else {
            return {
              content: [{
                type: 'text' as const,
                text: `ℹ️ Không tìm thấy trạng thái nào của "${params.character}" tại hoặc trước chương "${params.chapter}".`,
              }],
            };
          }
        } else {
          targetDesc = `Trạng thái của "${params.character}" tại ${targetState.chapter}`;
        }
      } else {
        // "Gần nhất" = mốc có thứ tự chương lớn nhất (tự nhiên), không phải
        // phần tử log cuối cùng — vì user có thể log ch_002 sau ch_010.
        targetState = [...charHistory.states].sort((a, b) => compareNatural(a.chapter, b.chapter)).pop()!;
        targetDesc = `Trạng thái gần nhất của "${params.character}" (tại ${targetState.chapter})`;
      }

      return {
        content: [{
          type: 'text' as const,
          text: `👤 ${targetDesc}:

📍 **Vị trí**: ${targetState.location || '_không rõ_'}
🛡️ **Tình trạng**: ${targetState.status} ${targetState.condition ? `(${targetState.condition})` : ''}
🎒 **Hành trang / Vật phẩm** (${targetState.inventory.length}):
${targetState.inventory.length > 0 ? targetState.inventory.map(i => `  - ${i}`).join('\n') : '  _Trống_'}
🗝️ **Bí mật / Thông tin đang nắm giữ** (${targetState.knownSecrets.length}):
${targetState.knownSecrets.length > 0 ? targetState.knownSecrets.map(k => `  - ${k}`).join('\n') : '  _Không có_'}
📝 **Ghi chú**: ${targetState.notes || '_không có_'}`,
        }],
      };
    }
  );
}
