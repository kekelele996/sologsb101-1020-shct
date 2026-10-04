/**
 * 保存失败重试队列（编目侧 / 巡查侧各自独立使用）
 *
 * 两侧写入互不交叉：
 * - 编目室保存拓本 / 损泐失败：只在编目侧重试，巡查单不动
 * - 保管组保存巡查单 / 原石残损 / 核销失败：只在巡查侧重来，编目不重试
 *
 * 每个 slice 各自维护一份 PendingSave 队列，失败动作把载荷留在本侧，
 * 页面通过 <RetryBanner> 提示并允许重试；重试成功后出队。
 */

/** 一次失败的本地保存动作 */
export interface PendingSave<K extends string = string, P = unknown> {
  /** 队列内唯一标识（时间戳 + 随机串），出队用 */
  fp: string;
  /** 动作种类，重试时按它找回 thunk，如 'loss/create'、'inspection/create' */
  kind: K;
  /** 原始提交载荷（草稿或补丁），重试时原样重放 */
  payload: P;
  /** 最近一次失败原因 */
  error: string;
  /** 首次失败时间 */
  failedAt: number;
}

export function createPendingFp(): string {
  return `retry_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 构造一条失败记录 */
export function toPendingSave<K extends string, P>(
  kind: K,
  payload: P,
  error: unknown,
): PendingSave<K, P> {
  return {
    fp: createPendingFp(),
    kind,
    payload,
    error: error instanceof Error ? error.message : '本地保存失败',
    failedAt: Date.now(),
  };
}

/** 失败动作的提示文案 */
export function pendingSaveLabel(kind: string): string {
  const labels: Record<string, string> = {
    'stele/create': '新建碑刻',
    'stele/update': '保存碑刻',
    'rubbing/create': '登记拓本',
    'rubbing/update': '保存拓本',
    'loss/create': '标注损泐字位',
    'loss/update': '保存损泐字位',
    'seal/create': '登记钤印',
    'seal/update': '保存钤印',
    'inspection/create': '新建巡查单',
    'inspection/update': '保存巡查单',
    'damage/create': '补记原石残损',
    'damage/update': '保存原石残损',
    'reconciliation/resolve': '现场核查',
  };
  return labels[kind] ?? '本地保存';
}
