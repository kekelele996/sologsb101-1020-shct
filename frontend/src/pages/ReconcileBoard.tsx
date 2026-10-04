/**
 * /reconcile 拓本损泐 × 原石巡查残损 字位对账
 * 同一碑刻按字位把编目室的拓本损泐与保管组巡查单的原石残损对账：
 * - 已对上：巡查单照原石现状记了同字位残损
 * - 挂起：拓本标了损泐、巡查单没记 —— 等保管组现场看过再定，期间该拓本断代比对不放行
 * - 已核销：保管组现场确认原石无损（拓本自身问题）
 *
 * 现场处置两条路（都只发生在巡查侧）：
 * - 原石见损 → 去巡查单照现状补记（不得回填拓本），补记后字位自动转为「已对上」
 * - 原石无损 → 在本页登记核销
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AuditOutlined, CheckCircleOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import LossTag from '@/components/common/LossTag';
import StatBadge from '@/components/common/StatBadge';
import RetryBanner from '@/components/common/RetryBanner';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectSteles, setCurrentStele } from '@/stores/steleSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import {
  dismissInspectionPending,
  enqueueInspectionPending,
  removeReconciliation,
  resolveReconciliation,
  retryInspectionSave,
} from '@/stores/inspectionSlice';
import {
  RECONCILE_STATUS_COLOR,
  RECONCILE_STATUS_LABEL,
  RECONCILE_STATUS_OPTIONS,
  createEmptyReconciliationDraft,
  type ReconcileStatus,
} from '@/types/reconciliation';
import type { ReconciliationDraft } from '@/types/reconciliation';
import { encodeCoord } from '@/utils/collate';
import { useReconcile } from '@/hooks/useReconcile';
import type { ReconcileRow } from '@/utils/reconcile';
import { ROUTES } from '@/router';

const FILTER_KEYS = ['status'] as const;

export default function ReconcileBoard() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<ReconciliationDraft>();

  const steles = useAppSelector(selectSteles);
  const rubbings = useAppSelector(selectRubbings);
  const inspections = useAppSelector((state) => state.inspection.inspections);
  const pendingSaves = useAppSelector((state) => state.inspection.pendingSaves);
  const reconcile = useReconcile();

  const url = useFilterQuery(FILTER_KEYS);
  const [steleId, setSteleId] = useState<string>('');
  const [resolveRow, setResolveRow] = useState<ReconcileRow | null>(null);
  const [retryingFp, setRetryingFp] = useState<string | null>(null);

  const activeSteleId = steleId || steles[0]?.id || '';
  const stele = steles.find((item) => item.id === activeSteleId);

  const steleRows = useMemo(() => reconcile.rowsOfStele(activeSteleId), [activeSteleId, reconcile]);

  const counts = useMemo(
    () => ({
      pending: steleRows.filter((row) => row.status === 'pending').length,
      matched: steleRows.filter((row) => row.status === 'matched').length,
      cleared: steleRows.filter((row) => row.status === 'cleared').length,
    }),
    [steleRows],
  );

  const versionLabel = (rubbingId: string): string => {
    const rubbing = rubbings.find((item) => item.id === rubbingId);
    return rubbing ? `第 ${rubbing.versionNo} 版` : '已删除拓本';
  };

  const filteredRows = useMemo(() => {
    const statuses = (url.values.status ?? []) as ReconcileStatus[];
    const keyword = url.keyword.trim();
    return steleRows.filter((row) => {
      if (statuses.length > 0 && !statuses.includes(row.status)) return false;
      if (keyword.length > 0) {
        const haystack = `${encodeCoord(row.lineNo, row.charNo)}${row.loss.note}${
          row.inspectionDamage?.note ?? ''
        }${row.reconciliation?.reason ?? ''}`;
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [steleRows, url.keyword, url.values]);

  const selects: FilterSelectConfig[] = [
    {
      key: 'status',
      label: '对账状态',
      options: RECONCILE_STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label })),
    },
  ];

  const openResolve = (row: ReconcileRow): void => {
    setResolveRow(row);
    form.setFieldsValue(
      createEmptyReconciliationDraft(row.loss.id, row.rubbingId, row.steleId, row.lineNo, row.charNo),
    );
  };

  const submitResolve = async (): Promise<void> => {
    if (!resolveRow) return;
    const values = await form.validateFields();
    try {
      await dispatch(resolveReconciliation(values)).unwrap();
      message.success(`已核销 ${encodeCoord(values.lineNo, values.charNo)}：原石无损，挂起解除`);
      setResolveRow(null);
    } catch (error) {
      dispatch(
        enqueueInspectionPending({ kind: 'reconciliation/resolve', payload: values as unknown as Record<string, unknown>, error }),
      );
      message.error('核查登记保存失败，已挂在巡查侧重试队列');
      setResolveRow(null);
    }
  };

  const handleRetry = async (fp: string): Promise<void> => {
    setRetryingFp(fp);
    try {
      await dispatch(retryInspectionSave(fp)).unwrap();
      message.success('巡查侧重试成功');
    } catch {
      message.error('重试仍失败，记录继续留在巡查侧');
    } finally {
      setRetryingFp(null);
    }
  };

  const columns: ColumnsType<ReconcileRow> = [
    {
      title: '字位',
      key: 'coord',
      width: 100,
      sorter: (a, b) => (a.lineNo === b.lineNo ? a.charNo - b.charNo : a.lineNo - b.lineNo),
      render: (_v, row) => <Tag color="#2f3a34">{encodeCoord(row.lineNo, row.charNo)}</Tag>,
    },
    {
      title: '拓本',
      key: 'rubbing',
      width: 90,
      render: (_v, row) => <Tag>{versionLabel(row.rubbingId)}</Tag>,
    },
    {
      title: '拓本损泐（编目室）',
      key: 'loss',
      width: 230,
      render: (_v, row) => <LossTag type={row.loss.type} severity={row.loss.severity} note={row.loss.note} />,
    },
    {
      title: '巡查单原石残损（保管组）',
      key: 'damage',
      render: (_v, row) =>
        row.inspectionDamage ? (
          <Space direction="vertical" size={0}>
            <LossTag
              type={row.inspectionDamage.type}
              severity={row.inspectionDamage.severity}
              note={row.inspectionDamage.note}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {inspections.find((sheet) => sheet.id === row.inspectionDamage?.inspectionId)?.sheetNo ?? ''}
            </Typography.Text>
          </Space>
        ) : row.reconciliation ? (
          <Typography.Text type="secondary">现场核查原石无损：{row.reconciliation.reason || '未填原因'}</Typography.Text>
        ) : (
          <Tag color="error">巡查单未记</Tag>
        ),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      filters: [],
      render: (_v, row) => <Tag color={RECONCILE_STATUS_COLOR[row.status]}>{RECONCILE_STATUS_LABEL[row.status]}</Tag>,
    },
    {
      title: '现场处置',
      key: 'action',
      width: 200,
      render: (_v, row) => {
        if (row.status === 'pending') {
          return (
            <Space size={4} wrap>
              <Button size="small" type="link" icon={<CheckCircleOutlined />} onClick={() => openResolve(row)}>
                现场无损·核销
              </Button>
              <Button
                size="small"
                type="link"
                icon={<SafetyCertificateOutlined />}
                onClick={() => {
                  dispatch(setCurrentStele(row.steleId));
                  navigate(ROUTES.inspections);
                }}
              >
                见损·去补记
              </Button>
            </Space>
          );
        }
        if (row.status === 'cleared' && row.reconciliation) {
          return (
            <Popconfirm
              title="撤销核销"
              description="撤销后该字位重新挂起；若现场复查原石确损，请改到巡查单照现状补记。"
              okText="撤销核销"
              cancelText="取消"
              onConfirm={() =>
                void dispatch(removeReconciliation(row.reconciliation!.id))
                  .unwrap()
                  .then(() => message.success('已撤销核销，字位重新挂起'))
              }
            >
              <Button size="small" type="link" danger icon={<StopOutlined />}>
                撤销核销
              </Button>
            </Popconfirm>
          );
        }
        return <Typography.Text type="secondary" style={{ fontSize: 12 }}>字位已对上，无需处置</Typography.Text>;
      },
    },
  ];

  const blockedRubbings = useMemo(() => {
    const ids = new Set(steleRows.filter((row) => row.status === 'pending').map((row) => row.rubbingId));
    return rubbings.filter((rubbing) => ids.has(rubbing.id));
  }, [rubbings, steleRows]);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>拓本损泐 × 原石巡查 字位对账</h2>
          <p>同一碑刻按字位核对：拓本标了而巡查单没记的字位先挂起，等保管组现场看过再定；挂起未清前断代比对不放行。</p>
        </div>
        <Space wrap>
          <Select
            style={{ minWidth: 200 }}
            placeholder="选择碑刻"
            value={activeSteleId || undefined}
            options={steles.map((item) => ({ value: item.id, label: item.title }))}
            onChange={(value: string) => {
              setSteleId(value);
              dispatch(setCurrentStele(value));
            }}
          />
          <Button icon={<AuditOutlined />} onClick={() => navigate(ROUTES.inspections)}>
            巡查单
          </Button>
        </Space>
      </div>

      <RetryBanner
        sideLabel="保管组"
        pending={pendingSaves}
        retryingFp={retryingFp}
        onRetry={(fp) => void handleRetry(fp)}
        onDismiss={(fp) => dispatch(dismissInspectionPending(fp))}
      />

      <div className="gb-stat-row">
        <StatBadge label="挂起字位" value={counts.pending} suffix="处" tone="danger" />
        <StatBadge label="已对上" value={counts.matched} suffix="处" tone="success" />
        <StatBadge label="已核销" value={counts.cleared} suffix="处" />
        <StatBadge label="受挂起影响拓本" value={blockedRubbings.length} suffix="份" tone="warning" />
        <StatBadge label="全库挂起" value={reconcile.pendingTotal} suffix="处" tone="danger" />
      </div>

      {counts.pending > 0 ? (
        <Alert
          style={{ marginBottom: 14 }}
          type="error"
          showIcon
          message={`《${stele?.title ?? ''}》有 ${counts.pending} 处字位挂起，相关拓本断代比对暂不放行`}
          description={
            <Space direction="vertical" size={2}>
              <span>等保管组到现场看过：原石见损 → 在巡查单照现状补记（补记只来自现场，不拿拓本回填）；原石无损 → 登记核销。</span>
              <span>
                受影响拓本：
                {blockedRubbings.map((rubbing) => (
                  <Tag key={rubbing.id} color="error">
                    第 {rubbing.versionNo} 版
                  </Tag>
                ))}
              </span>
            </Space>
          }
        />
      ) : (
        <Alert
          style={{ marginBottom: 14 }}
          type="success"
          showIcon
          message="该碑刻没有挂起字位"
          description="拓本损泐均已与巡查单对上或经现场核销，相关拓本可正常进行断代比对。"
        />
      )}

      <FilterBar
        keyword={url.keyword}
        onKeywordChange={url.setKeyword}
        selects={selects}
        values={url.values}
        onValuesChange={url.setValues}
        onReset={url.reset}
        keywordPlaceholder="搜索字位 / 拓本备注 / 巡查备注 / 核销原因…"
        actions={<Typography.Text type="secondary">共 {filteredRows.length} 条对账字位</Typography.Text>}
      />

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card className="gb-table-card" styles={{ body: { padding: 0 } }}>
            {!activeSteleId || steleRows.length === 0 ? (
              <EmptyPanel
                title={!activeSteleId ? '还没有碑刻' : '该碑刻暂无拓本损泐可对账'}
                description={
                  !activeSteleId
                    ? '先在碑刻台账登记碑刻与拓本。'
                    : '编目室在损泐字位台标注后，系统会自动按字位与巡查单对账。'
                }
                size="small"
              />
            ) : (
              <Table<ReconcileRow>
                rowKey={(row) => row.loss.id}
                size="small"
                pagination={{ pageSize: 12 }}
                columns={columns}
                dataSource={filteredRows}
                rowClassName={(row) =>
                  row.status === 'pending' ? 'gb-reconcile-row is-pending' : 'gb-reconcile-row'
                }
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={resolveRow !== null}
        title={resolveRow ? `现场核查核销 · ${encodeCoord(resolveRow.lineNo, resolveRow.charNo)}` : ''}
        onCancel={() => setResolveRow(null)}
        onOk={() => void submitResolve()}
        okText="登记核销（原石无损）"
        cancelText="取消"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="仅当现场确认原石该字位完好时核销"
          description="核销后该字位不再挂起；若现场看到原石残损，请取消并去巡查单照现状补记，不能把拓本损泐回填巡查单。"
        />
        {resolveRow ? (
          <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
            <div>
              <Tag color="#2f3a34">{versionLabel(resolveRow.rubbingId)}</Tag>
              <LossTag type={resolveRow.loss.type} severity={resolveRow.loss.severity} />
              <Typography.Text type="secondary">{resolveRow.loss.note}</Typography.Text>
            </div>
          </Space>
        ) : null}
        <Form form={form} layout="vertical" preserve={false}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="verifier" label="现场核查人" rules={[{ required: true, message: '请填写核查人' }]} style={{ flex: 1 }}>
              <Input placeholder="保管组现场核查人" />
            </Form.Item>
            <Form.Item name="verifiedAt" label="核查日期" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="date" />
            </Form.Item>
          </Space>
          <Form.Item
            name="reason"
            label="核查结论"
            rules={[{ required: true, message: '请记录原石无损的核查结论' }]}
          >
            <Input.TextArea rows={3} placeholder="如：原石字口完好，拓本损泐为纸疤 / 拓制磨损，非石面残损。" />
          </Form.Item>
          <Form.Item name="lossId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="rubbingId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="steleId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="lineNo" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="charNo" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
