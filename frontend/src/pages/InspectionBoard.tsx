/**
 * /inspections 原石巡查（保管组一侧）
 * 立巡查单：只照碑刻原石现场现状记录碑面现状、防护处置，并按字位登记原石残损。
 *
 * 铁律：
 * - 巡查单不能拿拓本回填 —— 补记残损表单只有行号 / 字位 / 类型 / 程度 / 现场备注，
 *   不读取、不预填任何拓本损泐。
 * - 旧数据未按字位记录的老单：升级时按碑面行号补拆；拆不出来的老单 readonly，只读。
 * - 保存失败只在巡查侧重来（RetryBanner），编目室数据不动。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  AuditOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import LossTag from '@/components/common/LossTag';
import StatBadge from '@/components/common/StatBadge';
import RetryBanner from '@/components/common/RetryBanner';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectSteles, setCurrentStele } from '@/stores/steleSlice';
import {
  createDamage,
  createInspection,
  dismissInspectionPending,
  enqueueInspectionPending,
  removeDamage,
  retryInspectionSave,
  updateDamage,
  updateInspection,
} from '@/stores/inspectionSlice';
import {
  createEmptyDamageDraft,
  createEmptyInspectionDraft,
  type Inspection,
  type InspectionDamage,
  type InspectionDamageDraft,
  type InspectionDraft,
} from '@/types/inspection';
import {
  LOSS_SEVERITY_OPTIONS,
  LOSS_TYPE_OPTIONS,
} from '@/types/loss';
import { encodeCoord } from '@/utils/collate';
import { ROUTES } from '@/router';
import { useReconcile } from '@/hooks/useReconcile';

export default function InspectionBoard() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [sheetForm] = Form.useForm<InspectionDraft>();
  const [damageForm] = Form.useForm<InspectionDamageDraft>();

  const steles = useAppSelector(selectSteles);
  const inspections = useAppSelector((state) => state.inspection.inspections);
  const damages = useAppSelector((state) => state.inspection.damages);
  const pendingSaves = useAppSelector((state) => state.inspection.pendingSaves);
  const reconcile = useReconcile();

  const [steleId, setSteleId] = useState<string>('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingSheet, setEditingSheet] = useState<Inspection | null>(null);
  const [damageOpen, setDamageOpen] = useState(false);
  const [editingDamage, setEditingDamage] = useState<InspectionDamage | null>(null);
  const [retryingFp, setRetryingFp] = useState<string | null>(null);

  const activeSteleId = steleId || steles[0]?.id || '';
  const stele = steles.find((item) => item.id === activeSteleId);

  const steleSheets = useMemo(
    () => inspections.filter((sheet) => sheet.steleId === activeSteleId),
    [inspections, activeSteleId],
  );

  const damagesOfSheet = (sheetId: string): InspectionDamage[] =>
    damages
      .filter((damage) => damage.inspectionId === sheetId)
      .sort((a, b) => (a.lineNo === b.lineNo ? a.charNo - b.charNo : a.lineNo - b.lineNo));

  const pendingCount = reconcile.pendingOfStele(activeSteleId);
  const readonlyCount = steleSheets.filter((sheet) => sheet.readonly).length;

  const stat = useMemo(() => {
    const active = steleSheets.filter((sheet) => !sheet.readonly).length;
    const damageCount = damages.filter((damage) => damage.steleId === activeSteleId).length;
    return {
      sheets: steleSheets.length,
      active,
      readonly: readonlyCount,
      damages: damageCount,
      pending: pendingCount,
    };
  }, [damages, pendingCount, readonlyCount, steleSheets, activeSteleId]);

  const nextSheetNo = (): string => {
    const prefix = activeSteleId.replace('stele_', 'XC-');
    const seq = steleSheets.length + 1;
    return `${prefix}${String(seq).padStart(2, '0')}`;
  };

  const openCreateSheet = (): void => {
    if (!activeSteleId) {
      message.warning('请先在碑刻台账中登记碑刻');
      return;
    }
    setEditingSheet(null);
    sheetForm.setFieldsValue({ ...createEmptyInspectionDraft(activeSteleId), sheetNo: nextSheetNo() });
    setSheetOpen(true);
  };

  const openEditSheet = (sheet: Inspection): void => {
    if (sheet.readonly) return;
    setEditingSheet(sheet);
    sheetForm.setFieldsValue({
      steleId: sheet.steleId,
      sheetNo: sheet.sheetNo,
      inspectedAt: sheet.inspectedAt,
      inspector: sheet.inspector,
      surfaceStatus: sheet.surfaceStatus,
      protection: sheet.protection,
      legacyDamageText: sheet.legacyDamageText,
      readonly: sheet.readonly,
    });
    setSheetOpen(true);
  };

  const submitSheet = async (): Promise<void> => {
    const values = await sheetForm.validateFields();
    try {
      if (editingSheet) {
        await dispatch(updateInspection({ id: editingSheet.id, patch: values })).unwrap();
        message.success('巡查单已按现场记录更新');
      } else {
        await dispatch(createInspection(values)).unwrap();
        message.success(`已立巡查单 ${values.sheetNo}`);
      }
      setSheetOpen(false);
    } catch (error) {
      // 保存失败只在巡查侧重试，编目侧不动
      dispatch(
        enqueueInspectionPending({
          kind: editingSheet ? 'inspection/update' : 'inspection/create',
          payload: editingSheet ? { id: editingSheet.id, patch: values } : values,
          error,
        }),
      );
      message.error('巡查单保存失败，已挂在本侧，可稍后重试；编目室数据未改动');
      setSheetOpen(false);
    }
  };

  const openCreateDamage = (sheet: Inspection): void => {
    if (sheet.readonly) {
      message.warning('该老单拆不出字位，仅保留只读；请新立一张巡查单照原石现状登记');
      return;
    }
    setEditingDamage(null);
    damageForm.setFieldsValue(createEmptyDamageDraft(sheet.id, sheet.steleId));
    setDamageOpen(true);
  };

  const openEditDamage = (damage: InspectionDamage, sheet: Inspection): void => {
    if (sheet.readonly) return;
    setEditingDamage(damage);
    damageForm.setFieldsValue({
      inspectionId: damage.inspectionId,
      steleId: damage.steleId,
      lineNo: damage.lineNo,
      charNo: damage.charNo,
      type: damage.type,
      severity: damage.severity,
      note: damage.note,
    });
    setDamageOpen(true);
  };

  const submitDamage = async (): Promise<void> => {
    const values = await damageForm.validateFields();
    const duplicated = damages.some(
      (item) =>
        item.inspectionId === values.inspectionId &&
        item.lineNo === values.lineNo &&
        item.charNo === values.charNo &&
        item.id !== editingDamage?.id,
    );
    if (duplicated) {
      message.warning('该巡查单此字位已记残损，请直接编辑原条目');
      return;
    }
    try {
      if (editingDamage) {
        await dispatch(updateDamage({ id: editingDamage.id, patch: values })).unwrap();
        message.success(`已按原石现状更新 ${encodeCoord(values.lineNo, values.charNo)}`);
      } else {
        await dispatch(createDamage(values)).unwrap();
        message.success(`已照原石现状补记 ${encodeCoord(values.lineNo, values.charNo)}`);
      }
      setDamageOpen(false);
    } catch (error) {
      dispatch(
        enqueueInspectionPending({
          kind: editingDamage ? 'damage/update' : 'damage/create',
          payload: editingDamage ? { id: editingDamage.id, patch: values } : values,
          error,
        }),
      );
      message.error('原石残损保存失败，已挂在巡查侧重试队列');
      setDamageOpen(false);
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

  const damageColumns = (sheet: Inspection): ColumnsType<InspectionDamage> => [
    {
      title: '字位',
      key: 'coord',
      width: 100,
      render: (_v, record) => <Tag color="#3f5d6b">{encodeCoord(record.lineNo, record.charNo)}</Tag>,
    },
    {
      title: '原石残损',
      key: 'type',
      width: 170,
      render: (_v, record) => <LossTag type={record.type} severity={record.severity} note={record.note} />,
    },
    {
      title: '现场备注',
      dataIndex: 'note',
      render: (value: string) => <Typography.Text type="secondary">{value || '未填'}</Typography.Text>,
    },
    ...(sheet.readonly
      ? []
      : [
          {
            title: '操作',
            key: 'action',
            width: 150,
            render: (_v: unknown, record: InspectionDamage) => (
              <Space size={4}>
                <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEditDamage(record, sheet)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该原石残损记录"
                  okText="确认"
                  cancelText="取消"
                  onConfirm={() => void dispatch(removeDamage(record.id)).then(() => message.success('已删除'))}
                >
                  <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]),
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>原石巡查单（保管组）</h2>
          <p>只照碑刻原石现场现状记录碑面、防护与字位残损；巡查单不拿拓本回填，保存失败仅在本侧重来。</p>
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
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateSheet}>
            新立巡查单
          </Button>
          <Button icon={<AuditOutlined />} onClick={() => navigate(ROUTES.reconcile)}>
            前往字位对账
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
        <StatBadge label="巡查单" value={stat.sheets} suffix="张" tone="primary" />
        <StatBadge label="在用巡查单" value={stat.active} suffix="张" tone="success" />
        <StatBadge label="只读老单" value={stat.readonly} suffix="张" tone="warning" />
        <StatBadge label="原石残损字位" value={stat.damages} suffix="处" tone="info" />
        <StatBadge label="本碑挂起字位" value={stat.pending} suffix="处" tone="danger" />
      </div>

      {pendingCount > 0 ? (
        <Alert
          style={{ marginBottom: 14 }}
          type="error"
          showIcon
          message={`本碑有 ${pendingCount} 处拓本损泐字位巡查单未记录，已挂起待现场核实`}
          description="挂起字位未核实前，相关拓本的断代比对不放行；请现场查看原石，见损则在巡查单照现状补记，确认无损则到对账页核销。"
          action={
            <Button size="small" danger onClick={() => navigate(ROUTES.reconcile)}>
              去对账核实
            </Button>
          }
        />
      ) : null}

      {readonlyCount > 0 ? (
        <Alert
          style={{ marginBottom: 14 }}
          type="warning"
          showIcon
          message={`有 ${readonlyCount} 张旧巡查单未能按碑面行号补拆到字位，已留只读`}
          description="老单原始残损描述无法定位到具体行字，不允许编辑或补记；如需继续记录请新立巡查单。"
        />
      ) : null}

      {!activeSteleId ? (
        <EmptyPanel title="还没有碑刻" description="先在碑刻台账登记碑刻，再由保管组立巡查单。" size="small" />
      ) : steleSheets.length === 0 ? (
        <EmptyPanel
          title="该碑刻还没有巡查单"
          description="保管组现场巡查后立单，只照原石现状记录；拓本损泐不能作为巡查单残损的来源。"
          actionText="新立巡查单"
          onAction={openCreateSheet}
        />
      ) : (
        <Row gutter={16}>
          <Col xs={24} xl={9}>
            <Card size="small" title={`巡查单列表 · ${stele?.title ?? ''}`} styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}>
              <Timeline
                items={steleSheets.map((sheet) => ({
                  color: sheet.readonly ? 'gray' : 'green',
                  children: (
                    <Space direction="vertical" size={2}>
                      <Space size={6} wrap>
                        <Typography.Text strong>{sheet.sheetNo}</Typography.Text>
                        {sheet.readonly ? <Tag>只读老单</Tag> : <Tag color="green">在用</Tag>}
                        <Tag>{sheet.inspectedAt}</Tag>
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        巡查人：{sheet.inspector || '未填'} · 原石残损 {damagesOfSheet(sheet.id).length} 处
                      </Typography.Text>
                      <Space size={4}>
                        {sheet.readonly ? (
                          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openEditSheet(sheet)}>
                            查看
                          </Button>
                        ) : (
                          <>
                            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEditSheet(sheet)}>
                              编辑
                            </Button>
                            <Button size="small" type="link" icon={<PlusOutlined />} onClick={() => openCreateDamage(sheet)}>
                              补记残损
                            </Button>
                          </>
                        )}
                      </Space>
                    </Space>
                  ),
                }))}
              />
            </Card>
          </Col>
          <Col xs={24} xl={15}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              {steleSheets.map((sheet) => {
                const rows = damagesOfSheet(sheet.id);
                return (
                  <Card
                    key={sheet.id}
                    size="small"
                    className="gb-table-card"
                    title={
                      <Space size={6} wrap>
                        <SafetyCertificateOutlined />
                        <span>{sheet.sheetNo}</span>
                        {sheet.readonly ? <Tag>只读老单</Tag> : null}
                      </Space>
                    }
                    extra={
                      !sheet.readonly ? (
                        <Button size="small" icon={<PlusOutlined />} onClick={() => openCreateDamage(sheet)}>
                          照原石补记字位
                        </Button>
                      ) : undefined
                    }
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Typography.Text style={{ fontSize: 13 }}>
                        <strong>碑面现状：</strong>
                        {sheet.surfaceStatus || '未记'}
                      </Typography.Text>
                      <Typography.Text style={{ fontSize: 13 }}>
                        <strong>防护处置：</strong>
                        {sheet.protection || '未记'}
                      </Typography.Text>
                      {sheet.legacyDamageText ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          <strong>老单原始描述：</strong>
                          {sheet.legacyDamageText}
                          {sheet.readonly ? '（按行号也拆不出字位，全单只读）' : '（已按行号补拆为下列字位）'}
                        </Typography.Text>
                      ) : null}
                      <Table<InspectionDamage>
                        rowKey="id"
                        size="small"
                        pagination={false}
                        columns={damageColumns(sheet)}
                        dataSource={rows}
                        locale={{
                          emptyText: sheet.readonly
                            ? '老单残损未能拆到字位，原始描述见上'
                            : '尚未按字位记录原石残损（只能现场补记，不得取自拓本）',
                        }}
                      />
                    </Space>
                  </Card>
                );
              })}
            </Space>
          </Col>
        </Row>
      )}

      {/* 巡查单表单 */}
      <Modal
        open={sheetOpen}
        title={editingSheet ? `编辑巡查单 ${editingSheet.sheetNo}` : '新立原石巡查单'}
        onCancel={() => setSheetOpen(false)}
        onOk={() => void submitSheet()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        {editingSheet?.readonly ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="该单为旧系统老单，残损拆不到字位，全单只读"
            description="可查看碑面现状、防护与原始描述；如需记录新情况请另立巡查单。"
          />
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="只照原石现场现状填写"
            description="巡查单是原石一侧的记录，不能用拓本上的损泐回填；现场见损请先保存本单，再按字位「照原石补记」。"
          />
        )}
        <Form form={sheetForm} layout="vertical" preserve={false} disabled={editingSheet?.readonly ?? false}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="sheetNo" label="巡查单号" rules={[{ required: true, message: '请填写巡查单号' }]} style={{ flex: 1 }}>
              <Input placeholder="如：XC-0101" />
            </Form.Item>
            <Form.Item name="inspectedAt" label="巡查日期" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="inspector" label="巡查人" style={{ flex: 1 }}>
              <Input placeholder="保管组巡查人" />
            </Form.Item>
          </Space>
          <Form.Item name="surfaceStatus" label="碑面现状（照原石记录）" rules={[{ required: true, message: '请记录现场碑面现状' }]}>
            <Input.TextArea rows={3} placeholder="如：碑面整体完好，第三行右下有旧损……" />
          </Form.Item>
          <Form.Item name="protection" label="防护处置">
            <Input.TextArea rows={2} placeholder="如：遮檐检修、防风化围挡、裂隙支顶监测……" />
          </Form.Item>
          <Form.Item name="steleId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="legacyDamageText" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="readonly" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* 原石残损字位表单：无任何拓本数据预填 */}
      <Modal
        open={damageOpen}
        title={editingDamage ? '编辑原石残损字位' : '照原石补记残损字位'}
        onCancel={() => setDamageOpen(false)}
        onOk={() => void submitDamage()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="仅记录现场看到的原石残损"
          description="不得据拓本损泐回填本单；补记后，拓本同字位损泐将自动对上、解除挂起。"
        />
        <Form form={damageForm} layout="vertical" preserve={false}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="lineNo" label="碑面行号" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={200} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="charNo" label="字位" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={80} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="type" label="残损类型" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...LOSS_TYPE_OPTIONS]} />
            </Form.Item>
            <Form.Item name="severity" label="严重程度" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...LOSS_SEVERITY_OPTIONS]} />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="现场备注">
            <Input placeholder="如：原石「壽」字右下确有漫漶" />
          </Form.Item>
          <Form.Item name="inspectionId" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="steleId" hidden>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
