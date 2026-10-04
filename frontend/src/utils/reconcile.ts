/**
 * 对账工具：拓本损泐（编目侧）× 巡查残损（保管组侧）
 *
 * - 老巡查单整段残损描述按「第 N 行第 M 字」补拆为字位残损（v2→v3 迁移用）
 * - 按「碑刻 + 行号 + 字位」逐字位对账：已对上 / 挂起 / 已核销
 * - 断代闸门：拓本是否存在尚未核实的挂起字位
 *
 * 本文件只做纯计算，不触碰 IndexedDB：编目侧与巡查侧的写入各自独立，互不回填。
 */
import type { Loss } from '@/types/loss';
import type { Rubbing } from '@/types/rubbing';
import type { InspectionDamage } from '@/types/inspection';
import type { Reconciliation, ReconcileStatus } from '@/types/reconciliation';
import { coordKey } from './collate';

/** 对账行：一条拓本损泐字位及其对账结果 */
export interface ReconcileRow {
  loss: Loss;
  rubbingId: string;
  steleId: string;
  lineNo: number;
  charNo: number;
  status: ReconcileStatus;
  /** status=matched 时巡查单上对应的原石残损（取最近一次巡查记录） */
  inspectionDamage: InspectionDamage | null;
  /** status=cleared 时的核销记录 */
  reconciliation: Reconciliation | null;
}

/* --------------------------- 老单残损描述补拆 --------------------------- */

export interface SplitDamageItem {
  lineNo: number;
  charNo: number;
  type: InspectionDamage['type'];
  severity: InspectionDamage['severity'];
  note: string;
}

export interface SplitLegacyResult {
  /** 能按字位拆出的条目 */
  items: SplitDamageItem[];
  /**
   * 是否完整拆出：原始描述的每个实义分句都带「第 N 行第 M 字」坐标。
   * false 表示存在按碑面行号也定不到字位的分句，老单须留只读。
   */
  complete: boolean;
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 解析中文 / 阿拉伯数字（支持到「九十九」），失败返回 null */
export function parseLocalNumber(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const value = Number.parseInt(trimmed, 10);
    return value > 0 && value <= 999 ? value : null;
  }
  if (trimmed === '十') return 10;
  let value = 0;
  let parsed = false;
  if (trimmed.includes('十')) {
    const [tensPart, onesPart] = trimmed.split('十');
    const tens = tensPart === '' ? 1 : (CN_DIGITS[tensPart] ?? NaN);
    const ones = onesPart === '' ? 0 : (CN_DIGITS[onesPart] ?? NaN);
    if (Number.isFinite(tens) && Number.isFinite(ones)) {
      value = tens * 10 + ones;
      parsed = value > 0;
    }
  } else {
    let acc = 0;
    for (const ch of trimmed) {
      if (!(ch in CN_DIGITS)) {
        acc = NaN;
        break;
      }
      acc = acc * 10 + (CN_DIGITS[ch] as number);
      parsed = true;
    }
    value = acc;
  }
  return parsed && value > 0 && value <= 999 ? value : null;
}

function inferType(clause: string): InspectionDamage['type'] {
  if (/缺|残字|少字/.test(clause)) return 'missing';
  if (/石花/.test(clause)) return 'stoneFlower';
  if (/裂|纹|断/.test(clause)) return 'crack';
  if (/漫|漶|模糊|泐|剥/.test(clause)) return 'blur';
  return 'blur';
}

function inferSeverity(clause: string): InspectionDamage['severity'] {
  if (/重|全缺|断为|大裂|严重/.test(clause)) return 'heavy';
  if (/轻|细|微|略/.test(clause)) return 'light';
  return 'medium';
}

/**
 * 把旧巡查单的整段残损描述按「第 N 行第 M 字」补拆。
 * 任一实义分句缺行号或缺字位（无法定位到字位）即视为拆不完整，老单留只读。
 */
export function splitLegacyDamageText(raw: string): SplitLegacyResult {
  const clauses = raw
    .split(/[；;。\n\r]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (clauses.length === 0) return { items: [], complete: false };

  const items: SplitDamageItem[] = [];
  let complete = true;

  clauses.forEach((clause) => {
    const lineMatch = /第\s*([0-9零〇一二两三四五六七八九十]+)\s*行/.exec(clause);
    const charMatch = /第\s*([0-9零〇一二两三四五六七八九十]+)\s*[字位]/.exec(clause);
    const lineNo = lineMatch ? parseLocalNumber(lineMatch[1] as string) : null;
    const charNo = charMatch ? parseLocalNumber(charMatch[1] as string) : null;
    if (lineNo === null || charNo === null) {
      complete = false;
      return;
    }
    items.push({
      lineNo,
      charNo,
      type: inferType(clause),
      severity: inferSeverity(clause),
      note: clause,
    });
  });

  return { items, complete: complete && items.length > 0 };
}

/* ------------------------------- 字位对账 ------------------------------- */

/** 全库残损字位索引：`${steleId}|${line}:${char}` → 最近一次巡查记录的原石残损 */
export function buildDamageIndex(damages: InspectionDamage[]): Map<string, InspectionDamage> {
  const index = new Map<string, InspectionDamage>();
  damages.forEach((damage) => {
    const key = `${damage.steleId}|${coordKey(damage)}`;
    const prev = index.get(key);
    if (!prev || damage.updatedAt >= prev.updatedAt) index.set(key, damage);
  });
  return index;
}

/** 拓本损泐 id → 核销记录（同一字位理论上仅一条有效核销，取最新） */
export function buildClearedIndex(reconciliations: Reconciliation[]): Map<string, Reconciliation> {
  const index = new Map<string, Reconciliation>();
  reconciliations.forEach((row) => {
    const prev = index.get(row.lossId);
    if (!prev || row.verifiedAt >= prev.verifiedAt) index.set(row.lossId, row);
  });
  return index;
}

/**
 * 全量对账：逐条拓本损泐判定状态。
 * - 有核销记录 → cleared（保管组现场确认原石无损）
 * - 否则巡查残损索引命中同碑同字位 → matched
 * - 否则 → pending（挂起，待现场核实）
 */
export function reconcileAll(
  losses: Loss[],
  rubbings: Rubbing[],
  damages: InspectionDamage[],
  reconciliations: Reconciliation[],
): ReconcileRow[] {
  const steleOf = new Map(rubbings.map((rubbing) => [rubbing.id, rubbing.steleId]));
  const damageIndex = buildDamageIndex(damages);
  const clearedIndex = buildClearedIndex(reconciliations);

  return losses.map((loss) => {
    const steleId = steleOf.get(loss.rubbingId) ?? '';
    const reconciliation = clearedIndex.get(loss.id) ?? null;
    const inspectionDamage = reconciliation ? null : (damageIndex.get(`${steleId}|${coordKey(loss)}`) ?? null);
    const status: ReconcileStatus = reconciliation ? 'cleared' : inspectionDamage ? 'matched' : 'pending';
    return {
      loss,
      rubbingId: loss.rubbingId,
      steleId,
      lineNo: loss.lineNo,
      charNo: loss.charNo,
      status,
      inspectionDamage,
      reconciliation,
    };
  });
}

/** 某拓本是否存在未核实的挂起字位（断代比对放行闸门） */
export function hasPendingForRubbing(rows: ReconcileRow[], rubbingId: string): boolean {
  return rows.some((row) => row.rubbingId === rubbingId && row.status === 'pending');
}

/** 某拓本的对账状态计数 */
export function countStatusByRubbing(
  rows: ReconcileRow[],
): Record<string, { pending: number; matched: number; cleared: number }> {
  const result: Record<string, { pending: number; matched: number; cleared: number }> = {};
  rows.forEach((row) => {
    const bucket = result[row.rubbingId] ?? { pending: 0, matched: 0, cleared: 0 };
    bucket[row.status] += 1;
    result[row.rubbingId] = bucket;
  });
  return result;
}
