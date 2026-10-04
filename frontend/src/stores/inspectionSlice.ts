/**
 * 原石巡查 slice（Redux Toolkit）
 * 维护巡查单集合、挂起字位与对账状态；跨页状态不留在组件内 useState。
 * 编目室保存失败只重试拓本侧（rubbingSlice），保管组保存失败只重试本侧，两边互不牵扯。
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createId, db } from '@/utils/db';
import {
  type Inspection,
  type InspectionDamage,
  type InspectionDraft,
  type Suspension,
  type SuspensionStatus,
} from '@/types/inspection';
import type { LossType, LossSeverity } from '@/types/loss';
import { reconcileLossesWithInspection } from '@/utils/collate';
import type { RootState } from './store';

export interface InspectionState {
  items: Inspection[];
  loading: boolean;
  ready: boolean;
  error: string;
  currentInspectionId: string | null;
}

const initialState: InspectionState = {
  items: [],
  loading: false,
  ready: false,
  error: '',
  currentInspectionId: null,
};

export const loadInspections = createAsyncThunk('inspection/load', async () => {
  const rows = await db.inspections.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
});

export const createInspection = createAsyncThunk(
  'inspection/create',
  async (draft: InspectionDraft, { dispatch }) => {
    const now = Date.now();
    const row: Inspection = { ...draft, id: createId('insp'), createdAt: now, updatedAt: now };
    await db.inspections.put(row);
    await dispatch(loadInspections());
    return row;
  },
);

export const updateInspection = createAsyncThunk(
  'inspection/update',
  async (payload: { id: string; patch: Partial<Inspection> }, { dispatch }) => {
    await db.inspections.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
    await dispatch(loadInspections());
  },
);

export const removeInspection = createAsyncThunk('inspection/remove', async (id: string, { dispatch }) => {
  await db.inspections.delete(id);
  await dispatch(loadInspections());
});

/** 新增一条残损字位到巡查单 */
export const addInspectionDamage = createAsyncThunk(
  'inspection/addDamage',
  async (payload: { inspectionId: string; damage: InspectionDamage }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const row = state.inspection.items.find((item) => item.id === payload.inspectionId);
    if (!row) return;
    const damagePositions = [...row.damagePositions, payload.damage];
    await db.inspections.update(payload.inspectionId, { damagePositions, updatedAt: Date.now() } as never);
    await dispatch(loadInspections());
  },
);

/** 删除一条巡查残损字位 */
export const removeInspectionDamage = createAsyncThunk(
  'inspection/removeDamage',
  async (payload: { inspectionId: string; lineNo: number; charNo: number }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const row = state.inspection.items.find((item) => item.id === payload.inspectionId);
    if (!row) return;
    const damagePositions = row.damagePositions.filter(
      (d) => !(d.lineNo === payload.lineNo && d.charNo === payload.charNo),
    );
    await db.inspections.update(payload.inspectionId, { damagePositions, updatedAt: Date.now() } as never);
    await dispatch(loadInspections());
  },
);

/**
 * 挂起一个字位：拓本标了损泐而巡查单没记，先挂起等保管组现场核实。
 * 不回填巡查单残损，只在巡查单上登记挂起记录。
 */
export const suspendPosition = createAsyncThunk(
  'inspection/suspend',
  async (payload: { inspectionId: string; rubbingId: string; lineNo: number; charNo: number }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const row = state.inspection.items.find((item) => item.id === payload.inspectionId);
    if (!row) return;
    const exists = row.suspensions.some(
      (s) => s.rubbingId === payload.rubbingId && s.lineNo === payload.lineNo && s.charNo === payload.charNo,
    );
    if (exists) return;
    const suspension: Suspension = {
      id: createId('susp'),
      rubbingId: payload.rubbingId,
      lineNo: payload.lineNo,
      charNo: payload.charNo,
      status: 'pending',
      verifiedAt: null,
      verifyNote: '',
      verifyType: null,
      verifySeverity: null,
    };
    await db.inspections.update(
      payload.inspectionId,
      { suspensions: [...row.suspensions, suspension], updatedAt: Date.now() } as never,
    );
    await dispatch(loadInspections());
  },
);

/**
 * 核实挂起字位：保管组到现场看过再定。
 * - confirmed：现场确认原石有残损，把现场认定的类型/程度记入巡查单（不得从拓本回填），挂起结束。
 * - cleared：现场确认原石完好（或残损与现状不符），撤销挂起，拓本损泐标注留待编目室复核。
 */
export const verifySuspension = createAsyncThunk(
  'inspection/verify',
  async (
    payload: {
      inspectionId: string;
      suspensionId: string;
      status: SuspensionStatus;
      verifyNote: string;
      verifyType: LossType | null;
      verifySeverity: LossSeverity | null;
    },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    const row = state.inspection.items.find((item) => item.id === payload.inspectionId);
    if (!row) return;
    const suspensions = row.suspensions.map((s) =>
      s.id === payload.suspensionId
        ? {
            ...s,
            status: payload.status,
            verifiedAt: Date.now(),
            verifyNote: payload.verifyNote,
            verifyType: payload.verifyType,
            verifySeverity: payload.verifySeverity,
          }
        : s,
    );
    let damagePositions = row.damagePositions;
    if (payload.status === 'confirmed' && payload.verifyType && payload.verifySeverity) {
      const target = row.suspensions.find((s) => s.id === payload.suspensionId);
      if (target) {
        const already = damagePositions.some((d) => d.lineNo === target.lineNo && d.charNo === target.charNo);
        if (!already) {
          damagePositions = [
            ...damagePositions,
            {
              lineNo: target.lineNo,
              charNo: target.charNo,
              type: payload.verifyType,
              severity: payload.verifySeverity,
              note: payload.verifyNote,
            },
          ];
        }
      }
    }
    await db.inspections.update(
      payload.inspectionId,
      { suspensions, damagePositions, updatedAt: Date.now() } as never,
    );
    await dispatch(loadInspections());
  },
);

const inspectionSlice = createSlice({
  name: 'inspection',
  initialState,
  reducers: {
    setCurrentInspection(state, action: PayloadAction<string | null>) {
      state.currentInspectionId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadInspections.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadInspections.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loading = false;
        state.ready = true;
        state.error = '';
        const exists =
          state.currentInspectionId !== null && action.payload.some((row) => row.id === state.currentInspectionId);
        if (!exists) state.currentInspectionId = action.payload[0]?.id ?? null;
      })
      .addCase(loadInspections.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '巡查单读取失败';
      });
  },
});

export const { setCurrentInspection } = inspectionSlice.actions;

export const selectInspectionState = (state: RootState): InspectionState => state.inspection;
export const selectInspections = (state: RootState): Inspection[] => state.inspection.items;
export const selectCurrentInspectionId = (state: RootState): string | null => state.inspection.currentInspectionId;

/** 某碑刻的巡查单（按更新时间倒序，取最近一张） */
export function selectLatestInspectionByStele(state: RootState, steleId: string): Inspection | undefined {
  return state.inspection.items
    .filter((item) => item.steleId === steleId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** 某拓本在最近巡查单下的待核实挂起数（影响断代比对放行） */
export function selectPendingSuspensionsByRubbing(state: RootState, rubbingId: string): number {
  const inspections = state.inspection.items.filter((item) =>
    item.suspensions.some((s) => s.rubbingId === rubbingId && s.status === 'pending'),
  );
  return inspections.reduce(
    (sum, insp) => sum + insp.suspensions.filter((s) => s.rubbingId === rubbingId && s.status === 'pending').length,
    0,
  );
}

/** 某拓本在指定巡查单下的对账结果 */
export function selectReconciliation(state: RootState, inspectionId: string, rubbingId: string) {
  const inspection = state.inspection.items.find((item) => item.id === inspectionId);
  const rubbingLosses = state.loss.items.filter((loss) => loss.rubbingId === rubbingId);
  return reconcileLossesWithInspection(rubbingLosses, inspection, rubbingId);
}

export default inspectionSlice.reducer;
