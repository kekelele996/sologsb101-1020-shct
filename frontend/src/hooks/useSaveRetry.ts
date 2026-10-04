/**
 * useSaveRetry：保存失败后只在本侧重试，不牵扯对侧。
 * 编目室保存失败 → 重试拓本侧（rubbingSlice），巡查单不动；
 * 保管组保存失败 → 重试巡查单侧（inspectionSlice），拓本不回滚。
 * 纯前端 IndexedDB 保存偶发失败（配额 / 隐私模式）时，用本钩子重放同一动作。
 */
import { useCallback, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

export interface SaveRetryState {
  status: SaveStatus;
  error: string;
}

export interface UseSaveRetryResult {
  state: SaveRetryState;
  /** 执行一次保存；失败后记录动作供 retry 重放。返回是否成功 */
  run: (action: () => Promise<void>) => Promise<boolean>;
  /** 重放最近一次保存动作（只动本侧）。返回是否成功 */
  retry: () => Promise<boolean>;
  /** 重置为初始状态 */
  reset: () => void;
  /** 是否正在保存 */
  saving: boolean;
}

export function useSaveRetry(): UseSaveRetryResult {
  const [state, setState] = useState<SaveRetryState>({ status: 'idle', error: '' });
  const lastActionRef = useRef<(() => Promise<void>) | null>(null);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    lastActionRef.current = action;
    setState({ status: 'saving', error: '' });
    try {
      await action();
      setState({ status: 'success', error: '' });
      return true;
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : '保存失败，请重试' });
      return false;
    }
  }, []);

  const retry = useCallback(async (): Promise<boolean> => {
    const action = lastActionRef.current;
    if (!action) return false;
    setState({ status: 'saving', error: '' });
    try {
      await action();
      setState({ status: 'success', error: '' });
      return true;
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : '保存失败，请重试' });
      return false;
    }
  }, []);

  const reset = useCallback((): void => {
    setState({ status: 'idle', error: '' });
    lastActionRef.current = null;
  }, []);

  return { state, run, retry, reset, saving: state.status === 'saving' };
}

export default useSaveRetry;
