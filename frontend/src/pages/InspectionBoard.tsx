/**
 * /inspections 原石巡查与对账
 * 保管组登记巡查单（碑面现状、防护处置、按字位记录的残损），
 * 同一碑刻按字位把拓本损泐和巡查单残损对账：
 * 拓本标了损泐而巡查单没记的字位先挂起，等保管组到现场看过再定；
 * 巡查单只照原石现状记，不拿拓本回填；挂起未核实前，该拓本断代比对不放行。
 * 消费 Inspection、Loss、Rubbing、Stele；复用 <LossTag>、<StatBadge>、<EmptyPanel>。
 */
import { useEffect, useMemo, useState } from 'react';
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
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import LossTag from '@/components/common/LossTag';
import StatBadge from '@/components/common/StatBadge';
import { useSaveRetry } from '@/hooks/useSaveRetry';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectSteles, setCurrentStele } from '@/stores/steleSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import { selectLosses } from '@/stores/lossSlice';
import {
  addInspectionDamage,
  createInspection,
  loadInspections,
  removeInspection,
  removeInspectionDamage,
  selectInspections,
  selectLatestInspectionByStele,
  setCurrentInspection,
  suspendPosition,
  updateInspection,
  verifySuspension,
} from '@/stores/inspectionSlice';
import {
  SPLIT_STATUS_LABEL,
  SUSPENSION_STATUS_COLOR,
  SUSPENSION_STATUS_LABEL,
  createEmptyInspectionDamage,
  createEmptyInspectionDraft,
  type Inspection,
  type InspectionDamage,
  type InspectionDraft,
  type SuspensionStatus,
} from '@/types/inspection';
import {
  LOSS_SEVERITY_COLOR,
  LOSS_SEVERITY_LABEL,
  LOSS_SEVERITY_OPTIONS,
  LOSS_TYPE_COLOR,
  LOSS_TYPE_LABEL,
  LOSS_TYPE_OPTIONS,
  type LossSeverity,
  type LossType,
} from '@/types/loss';
import { encodeCoord, reconcileLossesWithInspection } from '@/utils/collate';

const { TextArea } = Input;

export default function InspectionBoard() {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<InspectionDraft>();
  const [verifyForm] = Form.useForm();

  const steles = useAppSelector(selectSteles);
  const rubbings = useAppSelector(selectRubbings);
  const losses = useAppSelector(selectLosses);
  const inspections = useAppSelector(selectInspections);
  const currentInspectionId = useAppSelector((state) => state.inspection.currentInspectionId);
  const currentSteleId = useAppSelector((state) => state.stele.currentSteleId);

  const [steleId, setSteleId] = useState<string>('');
  const [rubbingId, setRubbingId] = useState<string>('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Inspection | null>(null);
  const [damageDraft, setDamageDraft] = useState<InspectionDamage>(createEmptyInspectionDamage());
  const [verifyTarget, setVerifyTarget] = useState<{ inspectionId: string; suspensionId: string } | null>(null);

  // 保管组保存失败只在巡查单侧重来
  const inspectionSave = useSaveRetry();

  useEffect(() => {
    if (steleId.length === 0) {
      setSteleId(currentSteleId ?? steles[0]?.id ?? '');
    }
  }, [currentSteleId, steleId, steles]);

  const steleRubbings = useMemo(
    () => rubbings.filter((rubbing) => rubbing.steleId === steleId).sort((a, b) => a.versionNo - b.versionNo),
    [rubbings, steleId],
  );
  const latestInspection = useAppSelector((state) => selectLatestInspectionByStele(state, steleId));
  const inspection = currentInspectionId
    ? inspections.find((item) => item.id === currentInspectionId) ?? latestInspection
    : latestInspection;

  useEffect(() => {
    if (inspection && inspection.steleId === steleId) {
      dispatch(setCurrentInspection(inspection.id));
    }
  }, [dispatch, inspection, steleId]);

  useEffect(() => {
    if (rubbingId.length === 0 && steleRubbings.length > 0) {
      setRubbingId(steleRubbings[0]?.id ?? '');
    }
  }, [rubbingId, steleRubbings]);

  const reconciliation = useMemo(() => {
    if (!inspection || !rubbingId) return null;
    const rubbingLosses = losses.filter((loss) => loss.rubbingId === rubbingId);
    return reconcileLossesWithInspection(rubbingLosses, inspection, rubbingId);
  }, [inspection, losses, rubbingId]);

  const stat = useMemo(() => {
    const steleInspections = inspections.filter((item) => item.steleId === steleId);
    const pending = steleInspections.reduce(
      (sum, item) => sum + item.suspensions.filter((s) => s.status === 'pending').length,
      0,
    );
    return {
      inspections: steleInspections.length,
      damages: steleInspections.reduce((sum, item) => sum + item.damagePositions.length, 0),
      suspensions: steleInspections.reduce((sum, item) => sum + item.suspensions.length, 0),
      pending,
    };
  }, [inspections, steleId]);

  const openCreate = (): void => {
    if (!steleId) {
      message.warning('请先选择碑刻');
      return;
    }
    setEditing(null);
    form.setFieldsValue(createEmptyInspectionDraft(steleId));
    setOpen(true);
  };

  const openEdit = (target: Inspection): void => {
    setEditing(target);
    form.setFieldsValue({
      steleId: target.steleId,
      inspectDate: target.inspectDate,
      inspector: target.inspector,
      surfaceState: target.surfaceState,
      protection: target.protection,
      damagePositions: target.damagePositions,
      suspensions: target.suspensions,
      legacyDamageNote: target.legacyDamageNote,
      splitStatus: target.splitStatus,
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const action = async (): Promise<void> => {
      if (editing) {
        await dispatch(updateInspection({ id: editing.id, patch: values })).unwrap();
      } else {
        await dispatch(createInspection(values)).unwrap();
      }
    };
    const ok = await inspectionSave.run(action);
    if (ok) {
      message.success(editing ? '巡查单已更新' : '巡查单已登记');
      setOpen(false);
      inspectionSave.reset();
    }
  };

  const handleAddDamage = async (): Promise<void> => {
    if (!inspection) return;
    if (inspection.splitStatus === 'readonly') {
      message.warning('只读老单不能补拆字位');
      return;
    }
    await dispatch(addInspectionDamage({ inspectionId: inspection.id, damage: damageDraft })).unwrap();
    setDamageDraft(createEmptyInspectionDamage());
    message.success(`已补记 ${encodeCoord(damageDraft.lineNo, damageDraft.charNo)} 字位残损`);
  };

  const handleSuspend = async (lineNo: number, charNo: number): Promise<void> => {
    if (!inspection || !rubbingId) return;
    await dispatch(suspendPosition({ inspectionId: inspection.id, rubbingId, lineNo, charNo })).unwrap();
    message.success(`已挂起 ${encodeCoord(lineNo, charNo)} 字位，等保管组现场核实`);
  };

  const openVerify = (inspectionId: string, suspensionId: string, status: SuspensionStatus): void => {
    setVerifyTarget({ inspectionId, suspensionId });
    verifyForm.setFieldsValue({ status, verifyNote: '', verifyType: null, verifySeverity: null });
  };

  const submitVerify = async (): Promise<void> => {
    if (!verifyTarget) return;
    const values = await verifyForm.validateFields();
    if (values.status === 'confirmed' && (!values.verifyType || !values.verifySeverity)) {
      message.warning('确认残损须现场记录类型与程度，不得从拓本回填');
      return;
    }
    await dispatch(
      verifySuspension({
        inspectionId: verifyTarget.inspectionId,
        suspensionId: verifyTarget.suspensionId,
        status: values.status,
        verifyNote: values.verifyNote ?? '',
        verifyType: values.verifyType ?? null,
        verifySeverity: values.verifySeverity ?? null,
      }),
    ).unwrap();
    message.success(values.status === 'confirmed' ? '已确认残损并记入巡查单' : '已撤销挂起');
    setVerifyTarget(null);
  };

  const damageColumns: ColumnsType<InspectionDamage> = [
    {
      title: '字位',
      key: 'coord',
      width: 110,
      render: (_v, record) => <Tag color="#2f3a34">{encodeCoord(record.lineNo, record.charNo)}</Tag>,
    },
    {
      title: '残损类型',
      dataIndex: 'type',
      width: 110,
      render: (value: LossType) => (
        <Tag color={LOSS_TYPE_COLOR[value]}>{LOSS_TYPE_LABEL[value]}</Tag>
      ),
    },
    {
      title: '程度',
      dataIndex: 'severity',
      width: 80,
      render: (value: LossSeverity) => <Tag color={LOSS_SEVERITY_COLOR[value]}>{LOSS_SEVERITY_LABEL[value]}</Tag>,
    },
    { title: '现场备注', dataIndex: 'note', render: (value: string) => <Typography.Text type="secondary">{value || '—'}</Typography.Text> },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_v, record) => (
        <Popconfirm
          title="删除该残损字位"
          okText="确认"
          cancelText="取消"
          onConfirm={() =>
            inspection
              ? dispatch(removeInspectionDamage({ inspectionId: inspection.id, lineNo: record.lineNo, charNo: record.charNo }))
              : undefined
          }
        >
          <Button size="small" type="link" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ];

  const reconcileColumns: ColumnsType<NonNullable<typeof reconciliation>['rows'][number]> = [
    {
      title: '字位',
      key: 'coord',
      width: 110,
      render: (_v, record) => <Tag color="#2f3a34">{encodeCoord(record.lineNo, record.charNo)}</Tag>,
    },
    {
      title: '对账结果',
      key: 'kind',
      width: 100,
      render: (_v, record) => {
        if (record.kind === 'matched') return <Tag color="#2f6f4f">一致</Tag>;
        if (record.kind === 'suspended') {
          if (!record.suspension) return <Tag color="#c9963c">待挂起</Tag>;
          return <Tag color={SUSPENSION_STATUS_COLOR[record.suspension.status]}>{SUSPENSION_STATUS_LABEL[record.suspension.status]}</Tag>;
        }
        return <Tag color="#3a6ea5">巡查另记</Tag>;
      },
    },
    {
      title: '拓本损泐',
      key: 'rubbing',
      width: 180,
      render: (_v, record) =>
        record.rubbingLoss ? (
          <LossTag type={record.rubbingLoss.type} severity={record.rubbingLoss.severity} note={record.rubbingLoss.note} size="small" />
        ) : (
          <Typography.Text type="secondary">无损泐</Typography.Text>
        ),
    },
    {
      title: '巡查单残损',
      key: 'inspection',
      width: 180,
      render: (_v, record) =>
        record.inspectionDamage ? (
          <Space size={4} wrap>
            <Tag color={LOSS_TYPE_COLOR[record.inspectionDamage.type]}>{LOSS_TYPE_LABEL[record.inspectionDamage.type]}</Tag>
            <Tag color={LOSS_SEVERITY_COLOR[record.inspectionDamage.severity]}>{LOSS_SEVERITY_LABEL[record.inspectionDamage.severity]}</Tag>
          </Space>
        ) : (
          <Typography.Text type="secondary">未记</Typography.Text>
        ),
    },
    {
      title: '核实说明',
      key: 'verify',
      render: (_v, record) => {
        if (record.kind !== 'suspended' || !record.suspension) return <Typography.Text type="secondary">—</Typography.Text>;
        return (
          <Space direction="vertical" size={0}>
            {record.suspension.verifyNote ? (
              <Typography.Text style={{ fontSize: 12 }}>{record.suspension.verifyNote}</Typography.Text>
            ) : null}
            {record.suspension.status === 'confirmed' && record.suspension.verifyType ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                现场认定：{LOSS_TYPE_LABEL[record.suspension.verifyType]}
                {record.suspension.verifySeverity ? `·${LOSS_SEVERITY_LABEL[record.suspension.verifySeverity]}` : ''}
              </Typography.Text>
            ) : null}
            {record.suspension.verifiedAt ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(record.suspension.verifiedAt).toLocaleString('zh-CN')}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_v, record) => {
        if (record.kind !== 'suspended') return null;
        if (!record.suspension) {
          return (
            <Button size="small" type="link" icon={<ClockCircleOutlined />} onClick={() => handleSuspend(record.lineNo, record.charNo)}>
              挂起
            </Button>
          );
        }
        if (record.suspension.status !== 'pending') return <Typography.Text type="secondary">已结案</Typography.Text>;
        return (
          <Space size={4}>
            <Button
              size="small"
              type="link"
              icon={<CheckCircleOutlined />}
              onClick={() => openVerify(inspection!.id, record.suspension!.id, 'confirmed')}
            >
              确认残损
            </Button>
            <Button size="small" type="link" onClick={() => openVerify(inspection!.id, record.suspension!.id, 'cleared')}>
              撤销挂起
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>原石巡查与对账</h2>
          <p>
            保管组登记原石巡查单（碑面现状、防护处置、按字位记录的残损），同一碑刻按字位把拓本损泐和巡查单残损对账；
            拓本标了损泐而巡查单没记的字位先挂起，等保管组到现场看过再定。
          </p>
        </div>
        <Space wrap>
          <Select
            style={{ minWidth: 220 }}
            placeholder="选择碑刻"
            value={steleId || undefined}
            options={steles.map((item) => ({ value: item.id, label: item.title }))}
            onChange={(value: string) => {
              setSteleId(value);
              dispatch(setCurrentStele(value));
            }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建巡查单
          </Button>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="巡查单" value={stat.inspections} suffix="张" tone="primary" />
        <StatBadge label="残损字位" value={stat.damages} suffix="条" tone="warning" />
        <StatBadge label="挂起字位" value={stat.suspensions} suffix="个" tone="info" />
        <StatBadge label="待核实" value={stat.pending} suffix="个" tone="danger" />
      </div>

      {inspectionSave.state.status === 'error' ? (
        <Alert
          style={{ marginBottom: 14 }}
          type="error"
          showIcon
          message={`巡查单保存失败：${inspectionSave.state.error}`}
          description="保管组保存失败只在巡查单侧重试，不影响拓本侧数据。"
          action={
            <Button size="small" danger onClick={() => void inspectionSave.retry()}>
              重试巡查单保存
            </Button>
          }
        />
      ) : null}

      {!inspection ? (
        <EmptyPanel
          title="该碑刻还没有巡查单"
          description="保管组首次巡查后登记巡查单，记录碑面现状与防护处置，并按字位记录原石残损。"
          actionText="新建巡查单"
          onAction={openCreate}
        />
      ) : (
        <Row gutter={16}>
          <Col xs={24} xl={10}>
            <Card
              size="small"
              title={
                <Space size={6} wrap>
                  <SafetyCertificateOutlined />
                  <span>最近巡查单</span>
                  {inspection.splitStatus === 'readonly' ? (
                    <Tag color="#8c8c8c">{SPLIT_STATUS_LABEL.readonly}</Tag>
                  ) : (
                    <Tag color="#2f6f4f">{SPLIT_STATUS_LABEL.split}</Tag>
                  )}
                </Space>
              }
              extra={
                <Space size={4}>
                  <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(inspection)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除该巡查单"
                    okText="确认"
                    cancelText="取消"
                    onConfirm={() =>
                      dispatch(removeInspection(inspection.id)).then(() => dispatch(loadInspections()))
                    }
                  >
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              }
            >
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space size={6} wrap>
                  <Tag>{inspection.inspectDate}</Tag>
                  <Tag color="gold">{inspection.inspector || '未填巡查人'}</Tag>
                </Space>
                <Typography.Text>碑面现状：{inspection.surfaceState || '未记'}</Typography.Text>
                <Typography.Text>防护处置：{inspection.protection || '未记'}</Typography.Text>
                {inspection.splitStatus === 'readonly' ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="只读老单"
                    description={`旧单残损描述未拆到字位：「${inspection.legacyDamageNote}」，按碑面行号补拆失败，留只读。`}
                  />
                ) : null}
              </Space>
            </Card>

            <Card size="small" title="残损字位记录" style={{ marginTop: 14 }}>
              {inspection.splitStatus === 'readonly' ? (
                <Typography.Text type="secondary">只读老单不能补拆字位。</Typography.Text>
              ) : (
                <>
                  <Space size={6} wrap style={{ marginBottom: 8 }}>
                    <InputNumber
                      size="small"
                      min={1}
                      max={200}
                      value={damageDraft.lineNo}
                      onChange={(v) => setDamageDraft({ ...damageDraft, lineNo: v ?? 1 })}
                      addonBefore="行"
                      style={{ width: 90 }}
                    />
                    <InputNumber
                      size="small"
                      min={1}
                      max={80}
                      value={damageDraft.charNo}
                      onChange={(v) => setDamageDraft({ ...damageDraft, charNo: v ?? 1 })}
                      addonBefore="字"
                      style={{ width: 90 }}
                    />
                    <Select
                      size="small"
                      style={{ width: 100 }}
                      value={damageDraft.type}
                      options={[...LOSS_TYPE_OPTIONS]}
                      onChange={(v: LossType) => setDamageDraft({ ...damageDraft, type: v })}
                    />
                    <Select
                      size="small"
                      style={{ width: 90 }}
                      value={damageDraft.severity}
                      options={[...LOSS_SEVERITY_OPTIONS]}
                      onChange={(v: LossSeverity) => setDamageDraft({ ...damageDraft, severity: v })}
                    />
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => void handleAddDamage()}>
                      补记
                    </Button>
                  </Space>
                  <Table<InspectionDamage>
                    rowKey={(record) => `${record.lineNo}:${record.charNo}`}
                    size="small"
                    pagination={false}
                    columns={damageColumns}
                    dataSource={inspection.damagePositions}
                    locale={{ emptyText: '暂无残损字位记录' }}
                  />
                </>
              )}
            </Card>
          </Col>

          <Col xs={24} xl={14}>
            <Card
              size="small"
              title="字位对账"
              extra={
                <Select
                  size="small"
                  style={{ minWidth: 180 }}
                  value={rubbingId || undefined}
                  placeholder="选择拓本"
                  options={steleRubbings.map((item) => ({
                    value: item.id,
                    label: `第 ${item.versionNo} 版 · ${item.dateGuess || '年代待考'}`,
                  }))}
                  onChange={(value: string) => setRubbingId(value)}
                />
              }
            >
              {!reconciliation ? (
                <EmptyPanel title="请选择拓本" description="选择要对账的拓本后，按字位比对拓本损泐与巡查单残损。" size="small" />
              ) : (
                <>
                  <div className="gb-stat-row" style={{ marginBottom: 12 }}>
                    <StatBadge label="一致" value={reconciliation.matchedCount} suffix="字" tone="success" />
                    <StatBadge label="挂起" value={reconciliation.suspendedCount} suffix="字" tone="warning" />
                    <StatBadge label="巡查另记" value={reconciliation.inspectionOnlyCount} suffix="字" tone="info" />
                    <StatBadge label="待核实" value={reconciliation.pendingSuspendedCount} suffix="字" tone="danger" />
                  </div>
                  {reconciliation.pendingSuspendedCount > 0 ? (
                    <Alert
                      style={{ marginBottom: 12 }}
                      type="warning"
                      showIcon
                      message={`该拓本有 ${reconciliation.pendingSuspendedCount} 个字位挂起未核实，断代比对暂不放行`}
                      description="等保管组到现场核实并结案后，断代比对才会放行。"
                    />
                  ) : null}
                  <Table<NonNullable<typeof reconciliation>['rows'][number]>
                    rowKey="key"
                    size="small"
                    pagination={{ pageSize: 8 }}
                    columns={reconcileColumns}
                    dataSource={reconciliation.rows}
                  />
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}

      <Modal
        open={open}
        title={editing ? '编辑巡查单' : '新建巡查单'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="steleId" hidden>
            <Input />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="inspectDate" label="巡查日期" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="inspector" label="巡查人" style={{ flex: 1 }}>
              <Input placeholder="如：保管组·老周" />
            </Form.Item>
          </Space>
          <Form.Item name="surfaceState" label="碑面现状">
            <TextArea rows={2} placeholder="如：碑面基本完好，第3行「壽」字右下有漫漶…" />
          </Form.Item>
          <Form.Item name="protection" label="防护处置">
            <TextArea rows={2} placeholder="如：已加装防护罩，每周巡查一次…" />
          </Form.Item>
          <Form.Item name="legacyDamageNote" label="旧单残损描述（升级补拆用）" extra="旧数据没把残损拆到字位，升级时按碑面行号补拆；拆不出来留只读。">
            <TextArea rows={2} placeholder="如：第4行 字口已平；第7行 漫漶不清" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={verifyTarget !== null}
        title="现场核实挂起字位"
        onCancel={() => setVerifyTarget(null)}
        onOk={() => void submitVerify()}
        okText="提交核实"
        cancelText="取消"
        destroyOnClose
      >
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message="巡查单只照原石现状记"
          description="确认残损须由保管组现场查看后记录类型与程度，不得拿拓本损泐回填。"
        />
        <Form form={verifyForm} layout="vertical">
          <Form.Item name="status" label="核实结论" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'confirmed', label: '确认残损（现场有残，记入巡查单）' },
                { value: 'cleared', label: '撤销挂起（现场完好或与现状不符）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="verifyNote" label="现场核实说明">
            <TextArea rows={2} placeholder="现场查看情况说明" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="verifyType" label="现场认定类型" style={{ flex: 1 }}>
              <Select allowClear options={[...LOSS_TYPE_OPTIONS]} placeholder="现场记录，不回填拓本" />
            </Form.Item>
            <Form.Item name="verifySeverity" label="现场认定程度" style={{ flex: 1 }}>
              <Select allowClear options={[...LOSS_SEVERITY_OPTIONS]} placeholder="现场记录，不回填拓本" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
