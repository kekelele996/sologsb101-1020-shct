/**
 * 损泐与比对 slice（Redux Toolkit）
 * 维护字位损泐集合、比对记录与比对 A/B 选择及筛选条件。
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createId, db } from '@/utils/db';
import type { Loss, LossDraft, LossSeverity, LossType } from '@/types/loss';
import type { Compare, CompareDraft } from '@/types/compare';
import { sortLosses } from '@/utils/collate';
import { toPendingSave, type PendingSave } from '@/utils/saveRetry';
import type { RootState } from './store';

/** 编目侧（损泐 / 比对）失败动作种类；保存失败只在编目侧重试，巡查单不动 */
export type LossRetryKind = 'loss/create' | 'loss/update';

export interface LossFilters {
  keyword: string;
  types: LossType[];
  severities: LossSeverity[];
}

export interface LossState {
  items: Loss[];
  compares: Compare[];
  loading: boolean;
  ready: boolean;
  error: string;
  filters: LossFilters;
  /** 比对台选择的两个拓本 */
  compareAId: string | null;
  compareBId: string | null;
  /** 编目侧保存失败重试队列（与巡查侧互不影响） */
  pendingSaves: PendingSave<LossRetryKind, Record<string, unknown>>[];
}

const initialState: LossState = {
  items: [],
  compares: [],
  loading: false,
  ready: false,
  error: '',
  filters: { keyword: '', types: [], severities: [] },
  compareAId: null,
  compareBId: null,
  pendingSaves: [],
};

export const loadLosses = createAsyncThunk('loss/load', async () => {
  const [losses, compares] = await Promise.all([db.losses.toArray(), db.compares.toArray()]);
  compares.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { losses: sortLosses(losses), compares };
});

export const createLoss = createAsyncThunk('loss/create', async (draft: LossDraft, { dispatch }) => {
  const now = Date.now();
  const row: Loss = { ...draft, id: createId('loss'), createdAt: now, updatedAt: now };
  await db.losses.put(row);
  await dispatch(loadLosses());
  return row;
});

export const updateLoss = createAsyncThunk(
  'loss/update',
  async (payload: { id: string; patch: Partial<Loss> }, { dispatch }) => {
    await db.losses.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
    await dispatch(loadLosses());
  },
);

export const removeLoss = createAsyncThunk('loss/remove', async (id: string, { dispatch }) => {
  await db.losses.delete(id);
  await dispatch(loadLosses());
});

export const batchUpdateLosses = createAsyncThunk(
  'loss/batch',
  async (payload: { ids: string[]; patch: Partial<Loss> }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const now = Date.now();
    const rows = state.loss.items
      .filter((item) => payload.ids.includes(item.id))
      .map((item) => ({ ...item, ...payload.patch, updatedAt: now }));
    if (rows.length > 0) await db.losses.bulkPut(rows);
    await dispatch(loadLosses());
  },
);

export const saveCompare = createAsyncThunk('compare/save', async (draft: CompareDraft, { dispatch }) => {
  const now = Date.now();
  const row: Compare = { ...draft, id: createId('cmp'), createdAt: now, updatedAt: now };
  await db.compares.put(row);
  await dispatch(loadLosses());
  return row;
});

export const updateCompare = createAsyncThunk(
  'compare/update',
  async (payload: { id: string; patch: Partial<Compare> }, { dispatch }) => {
    await db.compares.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
    await dispatch(loadLosses());
  },
);

export const removeCompare = createAsyncThunk('compare/remove', async (id: string, { dispatch }) => {
  await db.compares.delete(id);
  await dispatch(loadLosses());
});

/** 编目侧重试：保存拓本损泐失败后只在本侧重放，巡查侧数据不动 */
export const retryLossSave = createAsyncThunk(
  'loss/retry',
  async (fp: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    const pending = state.loss.pendingSaves.find((item) => item.fp === fp);
    if (!pending) return;
    if (pending.kind === 'loss/create') await dispatch(createLoss(pending.payload as LossDraft)).unwrap();
    else if (pending.kind === 'loss/update')
      await dispatch(
        updateLoss(pending.payload as { id: string; patch: Partial<Loss> }),
      ).unwrap();
    dispatch(dismissLossPending(fp));
  },
);

const lossSlice = createSlice({
  name: 'loss',
  initialState,
  reducers: {
    setLossKeyword(state, action: PayloadAction<string>) {
      state.filters.keyword = action.payload;
    },
    setLossTypes(state, action: PayloadAction<LossType[]>) {
      state.filters.types = action.payload;
    },
    setLossSeverities(state, action: PayloadAction<LossSeverity[]>) {
      state.filters.severities = action.payload;
    },
    resetLossFilters(state) {
      state.filters = { keyword: '', types: [], severities: [] };
    },
    setCompareA(state, action: PayloadAction<string | null>) {
      state.compareAId = action.payload;
    },
    setCompareB(state, action: PayloadAction<string | null>) {
      state.compareBId = action.payload;
    },
    /** 移除一条编目侧失败记录（放弃重试） */
    dismissLossPending(state, action: PayloadAction<string>) {
      state.pendingSaves = state.pendingSaves.filter((item) => item.fp !== action.payload);
    },
    /** 编目侧保存失败入本侧队列 */
    enqueueLossPending(
      state,
      action: PayloadAction<{ kind: LossRetryKind; payload: Record<string, unknown>; error: unknown }>,
    ) {
      state.pendingSaves.push(toPendingSave(action.payload.kind, action.payload.payload, action.payload.error));
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadLosses.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadLosses.fulfilled, (state, action) => {
        state.items = action.payload.losses;
        state.compares = action.payload.compares;
        state.loading = false;
        state.ready = true;
        state.error = '';
      })
      .addCase(loadLosses.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '损泐字位读取失败';
      })
      .addCase(retryLossSave.rejected, (state, action) => {
        const target = state.pendingSaves.find((item) => item.fp === action.meta.arg);
        if (target) target.error = action.error.message ?? '编目侧重试仍失败';
      });
  },
});

export const {
  setLossKeyword,
  setLossTypes,
  setLossSeverities,
  resetLossFilters,
  setCompareA,
  setCompareB,
  dismissLossPending,
  enqueueLossPending,
} = lossSlice.actions;

export const selectLossState = (state: RootState): LossState => state.loss;
export const selectLosses = (state: RootState): Loss[] => state.loss.items;
export const selectCompares = (state: RootState): Compare[] => state.loss.compares;

/** 派生选择器：关键字 + 类型 + 程度筛选（全库维度） */
export function selectFilteredLosses(state: RootState): Loss[] {
  const { items, filters } = state.loss;
  const keyword = filters.keyword.trim();
  return items.filter((loss) => {
    if (keyword.length > 0) {
      const haystack = `${loss.lineNo}${loss.charNo}${loss.note}`;
      if (!haystack.includes(keyword)) return false;
    }
    if (filters.types.length > 0 && !filters.types.includes(loss.type)) return false;
    if (filters.severities.length > 0 && !filters.severities.includes(loss.severity)) return false;
    return true;
  });
}

/** 某拓本在某碑刻下的损泐条数统计 */
export function selectLossCountByRubbing(state: RootState): Record<string, number> {
  const result: Record<string, number> = {};
  state.loss.items.forEach((loss) => {
    result[loss.rubbingId] = (result[loss.rubbingId] ?? 0) + 1;
  });
  return result;
}

export default lossSlice.reducer;
