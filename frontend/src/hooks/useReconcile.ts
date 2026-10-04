/**
 * useReconcile()：拓本损泐 ↔ 原石巡查残损 的按字位对账
 * 被对账页（/reconcile）、比对页（/compare，断代闸门）、字位页与拓本页消费。
 *
 * 纯派生：数据来源为编目侧 losses + 巡查侧 inspectionDamages / reconciliations，
 * 不做任何写入；挂起即「拓本标了、巡查单没记且未核销」的字位。
 */
import { useMemo } from 'react';
import { useAppSelector } from '@/stores/store';
import { selectLosses } from '@/stores/lossSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import { selectInspectionDamages, selectReconciliations } from '@/stores/inspectionSlice';
import {
  countStatusByRubbing,
  hasPendingForRubbing,
  reconcileAll,
  type ReconcileRow,
} from '@/utils/reconcile';
import type { ReconcileStatus } from '@/types/reconciliation';

export interface UseReconcileResult {
  rows: ReconcileRow[];
  rowsOfStele: (steleId: string) => ReconcileRow[];
  rowsOfRubbing: (rubbingId: string) => ReconcileRow[];
  /** 拓本是否存在挂起字位（断代比对不放行） */
  isBlocked: (rubbingId: string) => boolean;
  /** 拓本 → 各状态计数 */
  countsByRubbing: Record<string, Record<ReconcileStatus, number>>;
  /** 全库挂起总数 */
  pendingTotal: number;
  /** 某碑刻的挂起总数（供巡查页提示） */
  pendingOfStele: (steleId: string) => number;
}

export function useReconcile(): UseReconcileResult {
  const losses = useAppSelector(selectLosses);
  const rubbings = useAppSelector(selectRubbings);
  const damages = useAppSelector(selectInspectionDamages);
  const reconciliations = useAppSelector(selectReconciliations);

  const rows = useMemo(
    () => reconcileAll(losses, rubbings, damages, reconciliations),
    [losses, rubbings, damages, reconciliations],
  );

  return useMemo<UseReconcileResult>(() => {
    const countsByRubbing = countStatusByRubbing(rows);
    return {
      rows,
      rowsOfStele: (steleId) => rows.filter((row) => row.steleId === steleId),
      rowsOfRubbing: (rubbingId) => rows.filter((row) => row.rubbingId === rubbingId),
      isBlocked: (rubbingId) => hasPendingForRubbing(rows, rubbingId),
      countsByRubbing,
      pendingTotal: rows.filter((row) => row.status === 'pending').length,
      pendingOfStele: (steleId) =>
        rows.filter((row) => row.steleId === steleId && row.status === 'pending').length,
    };
  }, [rows]);
}

export default useReconcile;
