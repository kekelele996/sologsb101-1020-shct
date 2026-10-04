/**
 * 拓本损泐 ↔ 原石巡查残损 对账（Reconciliation）数据模型
 *
 * 对账以「碑刻 + 行号 + 字位」为坐标：
 * - matched（已对上）：拓本标了损泐，巡查单按原石现状也在该字位记了残损 —— 实时派生，不落库
 * - pending（挂起）：拓本标了损泐，巡查单没记 —— 等保管组到现场看过再定，期间拓本断代比对不放行
 * - cleared（核销）：保管组现场看过，原石该字位并无残损（损泐系拓本自身问题），登记核销
 *
 * 只有「核销」落库；挂起由编目损泐集合与巡查残损集合实时对账得出，
 * 因此任何一方补记 / 撤销后状态立即更新，不会留下陈旧结论。
 */

/** 对账状态：挂起 / 已对上 / 已核销 */
export type ReconcileStatus = 'pending' | 'matched' | 'cleared';

export interface Reconciliation {
  id: string;
  /** 核销涉及的拓本损泐字位（Loss）id */
  lossId: string;
  /** 冗余拓本 id / 碑刻 id，便于按拓本做断代闸门、按碑刻列对账 */
  rubbingId: string;
  steleId: string;
  lineNo: number;
  charNo: number;
  /** 现场核查结论，如「原石字口完好，损泐系拓本磨损」 */
  reason: string;
  /** 保管组现场核查人 */
  verifier: string;
  /** 核查日期 yyyy-MM-dd */
  verifiedAt: string;
  createdAt: number;
  updatedAt: number;
}

export type ReconciliationDraft = Omit<Reconciliation, 'id' | 'createdAt' | 'updatedAt'>;

export const RECONCILE_STATUS_LABEL: Record<ReconcileStatus, string> = {
  pending: '挂起',
  matched: '已对上',
  cleared: '已核销',
};

export const RECONCILE_STATUS_COLOR: Record<ReconcileStatus, string> = {
  pending: '#b03a2e',
  matched: '#2f6f4f',
  cleared: '#8c8c8c',
};

export const RECONCILE_STATUS_OPTIONS: ReadonlyArray<{ value: ReconcileStatus; label: string }> = [
  { value: 'pending', label: '挂起' },
  { value: 'matched', label: '已对上' },
  { value: 'cleared', label: '已核销' },
];

export function createEmptyReconciliationDraft(
  lossId: string,
  rubbingId: string,
  steleId: string,
  lineNo: number,
  charNo: number,
): ReconciliationDraft {
  return {
    lossId,
    rubbingId,
    steleId,
    lineNo,
    charNo,
    reason: '',
    verifier: '',
    verifiedAt: new Date().toISOString().slice(0, 10),
  };
}
