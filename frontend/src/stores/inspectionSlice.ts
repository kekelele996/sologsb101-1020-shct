/**
 * 原石巡查 slice（Redux Toolkit）—— 保管组一侧
 * 维护巡查单、原石残损字位、对账核销三组数据，以及巡查侧的保存失败重试队列。
 *
 * 边界约定：
 * - 本 slice 的 thunk 事务只读写 inspections / inspectionDamages / reconciliations，
 *   绝不写编目侧表（steles / rubbings / losses / seals / compares）。
 * - 巡查残损只能照原石现状登记，页面不提供任何「从拓本损泐带入」的入口。
 * - 保存失败只在本侧排队重试，不触发编目侧任何动作。
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createId, db } from '@/utils/db';
import type { Inspection, InspectionDraft, InspectionDamage, InspectionDamageDraft } from '@/types/inspection';
import type { Reconciliation, ReconciliationDraft } from '@/types/reconciliation';
import type { RootState } from './store';
import { toPendingSave, type PendingSave } from '@/utils/saveRetry';

/** 巡查侧失败动作种类 */
export type InspectionRetryKind =
  | 'inspection/create'
  | 'inspection/update'
  | 'damage/create'
  | 'damage/update'
  | 'reconciliation/resolve';

type AnyPayload = Record<string, unknown>;

export interface InspectionState {
  inspections: Inspection[];
  damages: InspectionDamage[];
  reconciliations: Reconciliation[];
  loading: boolean;
  ready: boolean;
  error: string;
  /** 巡查侧保存失败重试队列（与编目侧互不影响） */
  pendingSaves: PendingSave<InspectionRetryKind, AnyPayload>[];
}

const initialState: InspectionState = {
  inspections: [],
  damages: [],
  reconciliations: [],
  loading: false,
  ready: false,
  error: '',
  pendingSaves: [],
};

export const loadInspections = createAsyncThunk('inspection/load', async () => {
  const [inspections, damages, reconciliations] = await Promise.all([
    db.inspections.toArray(),
    db.inspectionDamages.toArray(),
    db.reconciliations.toArray(),
  ]);
  inspections.sort((a, b) => (a.inspectedAt < b.inspectedAt ? 1 : a.inspectedAt > b.inspectedAt ? -1 : 0));
  damages.sort((a, b) => (a.lineNo === b.lineNo ? a.charNo - b.charNo : a.lineNo - b.lineNo));
  reconciliations.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
  return { inspections, damages, reconciliations };
});

export const createInspection = createAsyncThunk('inspection/create', async (draft: InspectionDraft, { dispatch }) => {
  const now = Date.now();
  const row: Inspection = { ...draft, id: createId('insp'), createdAt: now, updatedAt: now };
  await db.inspections.put(row);
  await dispatch(loadInspections());
  return row;
});

export const updateInspection = createAsyncThunk(
  'inspection/update',
  async (payload: { id: string; patch: Partial<Inspection> }, { dispatch }) => {
    await db.inspections.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
    await dispatch(loadInspections());
  },
);

/** 照原石现场补记残损字位（严禁从拓本损泐回填） */
export const createDamage = createAsyncThunk('damage/create', async (draft: InspectionDamageDraft, { dispatch }) => {
  const now = Date.now();
  const row: InspectionDamage = { ...draft, id: createId('idmg'), createdAt: now, updatedAt: now };
  await db.inspectionDamages.put(row);
  await dispatch(loadInspections());
  return row;
});

export const updateDamage = createAsyncThunk(
  'damage/update',
  async (payload: { id: string; patch: Partial<InspectionDamage> }, { dispatch }) => {
    await db.inspectionDamages.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
    await dispatch(loadInspections());
  },
);

export const removeDamage = createAsyncThunk('damage/remove', async (id: string, { dispatch }) => {
  await db.inspectionDamages.delete(id);
  await dispatch(loadInspections());
});

/** 保管组现场核查后核销挂起字位（原石无损） */
export const resolveReconciliation = createAsyncThunk(
  'reconciliation/resolve',
  async (draft: ReconciliationDraft, { dispatch }) => {
    const now = Date.now();
    const row: Reconciliation = { ...draft, id: createId('rec'), createdAt: now, updatedAt: now };
    await db.reconciliations.put(row);
    await dispatch(loadInspections());
    return row;
  },
);

/** 撤销核销（如现场复查发现原石确损，改为去巡查单照现状补记） */
export const removeReconciliation = createAsyncThunk('reconciliation/remove', async (id: string, { dispatch }) => {
  await db.reconciliations.delete(id);
  await dispatch(loadInspections());
});

/**
 * 巡查侧重试：按失败动作的 kind 重放原载荷，只重跑巡查侧 thunk，编目侧不动。
 */
export const retryInspectionSave = createAsyncThunk(
  'inspection/retry',
  async (fp: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    const pending = state.inspection.pendingSaves.find((item) => item.fp === fp);
    if (!pending) return;
    const payload = pending.payload as never;
    if (pending.kind === 'inspection/create') await dispatch(createInspection(payload as InspectionDraft)).unwrap();
    else if (pending.kind === 'inspection/update')
      await dispatch(updateInspection(payload as { id: string; patch: Partial<Inspection> })).unwrap();
    else if (pending.kind === 'damage/create')
      await dispatch(createDamage(payload as InspectionDamageDraft)).unwrap();
    else if (pending.kind === 'damage/update')
      await dispatch(updateDamage(payload as { id: string; patch: Partial<InspectionDamage> })).unwrap();
    else if (pending.kind === 'reconciliation/resolve')
      await dispatch(resolveReconciliation(payload as ReconciliationDraft)).unwrap();
    dispatch(dismissInspectionPending(fp));
  },
);

const inspectionSlice = createSlice({
  name: 'inspection',
  initialState,
  reducers: {
    /** 手动移除一条失败记录（放弃重试） */
    dismissInspectionPending(state, action: PayloadAction<string>) {
      state.pendingSaves = state.pendingSaves.filter((item) => item.fp !== action.payload);
    },
    /** 失败动作入本侧重试队列 */
    enqueueInspectionPending(
      state,
      action: PayloadAction<{ kind: InspectionRetryKind; payload: AnyPayload; error: unknown }>,
    ) {
      state.pendingSaves.push(toPendingSave(action.payload.kind, action.payload.payload, action.payload.error));
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadInspections.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadInspections.fulfilled, (state, action) => {
        state.inspections = action.payload.inspections;
        state.damages = action.payload.damages;
        state.reconciliations = action.payload.reconciliations;
        state.loading = false;
        state.ready = true;
        state.error = '';
      })
      .addCase(loadInspections.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '巡查数据读取失败';
      })
      .addCase(retryInspectionSave.rejected, (state, action) => {
        const fp = action.meta.arg;
        const target = state.pendingSaves.find((item) => item.fp === fp);
        if (target) target.error = action.error.message ?? '巡查侧重试仍失败';
      });
  },
});

export const { dismissInspectionPending, enqueueInspectionPending } = inspectionSlice.actions;

export const selectInspectionState = (state: RootState): InspectionState => state.inspection;
export const selectInspections = (state: RootState): Inspection[] => state.inspection.inspections;
export const selectInspectionDamages = (state: RootState): InspectionDamage[] => state.inspection.damages;
export const selectReconciliations = (state: RootState): Reconciliation[] => state.inspection.reconciliations;

export default inspectionSlice.reducer;
