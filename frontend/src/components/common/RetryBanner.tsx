/**
 * <RetryBanner> 保存失败重试横幅
 * 编目侧（拓本 / 损泐）与巡查侧（巡查单 / 原石残损 / 核销）各挂一份；
 * 只显示与重试本侧失败动作，绝不触碰另一侧数据。
 */
import { Alert, Button, Space, Tag, Typography } from 'antd';
import { CloseOutlined, RedoOutlined } from '@ant-design/icons';
import type { PendingSave } from '@/utils/saveRetry';
import { pendingSaveLabel } from '@/utils/saveRetry';

export interface RetryBannerProps {
  /** 本侧失败队列 */
  pending: PendingSave[];
  /** 重试单条；父级 dispatch 对应侧的 retry thunk */
  onRetry: (fp: string) => void;
  /** 放弃该条 */
  onDismiss: (fp: string) => void;
  /** 重试中（置灰按钮） */
  retryingFp?: string | null;
  /** 侧别文案，如「编目室」「保管组」 */
  sideLabel: string;
}

export function RetryBanner({ pending, onRetry, onDismiss, retryingFp, sideLabel }: RetryBannerProps) {
  if (pending.length === 0) return null;
  return (
    <Alert
      style={{ marginBottom: 14 }}
      type="warning"
      showIcon
      message={`${sideLabel}有 ${pending.length} 条保存失败，已留在本侧；${sideLabel === '保管组' ? '编目室数据不受影响' : '巡查单未作任何改动'}，请重试本侧保存。`}
      description={
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {pending.map((item) => (
            <Space key={item.fp} size={8} wrap>
              <Tag color="gold">{pendingSaveLabel(item.kind)}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {item.error}
              </Typography.Text>
              <Button
                size="small"
                type="primary"
                ghost
                icon={<RedoOutlined />}
                loading={retryingFp === item.fp}
                onClick={() => onRetry(item.fp)}
              >
                本侧重试
              </Button>
              <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => onDismiss(item.fp)}>
                放弃
              </Button>
            </Space>
          ))}
        </Space>
      }
    />
  );
}

export default RetryBanner;
