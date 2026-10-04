/**
 * 原石巡查（Inspection）数据模型 —— 保管组一侧
 * 巡查单只照碑刻原石现场现状记录：碑面现状、防护处置，以及按字位补拆的原石残损。
 * 与编目侧（拓本 / 损泐）完全分离：拓本损泐不得回填巡查单。
 *
 * - Inspection：一张巡查单（一次现场巡查）
 * - InspectionDamage：巡查单上按「行号 + 字位」记录的原石残损
 * - 旧系统巡查单未按字位记录残损时，legacyDamageText 保留原始描述；
 *   升级时能按行号补拆的拆成 InspectionDamage，拆不出字位的老单 readonly=true 留只读。
 */
import type { LossSeverity, LossType } from './loss';

/** 巡查单 */
export interface Inspection {
  id: string;
  /** 所属碑刻 id（原石与拓本在此汇合） */
  steleId: string;
  /** 巡查单号，如 XC-0101 */
  sheetNo: string;
  /** 巡查日期 yyyy-MM-dd */
  inspectedAt: string;
  /** 巡查人（保管组） */
  inspector: string;
  /** 碑面现状（照原石现场记录） */
  surfaceStatus: string;
  /** 防护处置（如支顶、遮檐、防风化处理等） */
  protection: string;
  /**
   * 旧系统迁移：未拆到字位的原始残损描述。
   * 新登记的巡查单为空串。
   */
  legacyDamageText: string;
  /** 老单按行号也补拆不出字位时置 true，全单只读 */
  readonly: boolean;
  createdAt: number;
  updatedAt: number;
}

export type InspectionDraft = Omit<Inspection, 'id' | 'createdAt' | 'updatedAt'>;

/** 巡查单上的原石残损字位（照原石现状记录，字段口径与 Loss 对齐，便于按字位对账） */
export interface InspectionDamage {
  id: string;
  /** 所属巡查单 id */
  inspectionId: string;
  /** 冗余所属碑刻 id，便于按碑刻索引对账 */
  steleId: string;
  /** 行号，从 1 开始（对应碑面行号） */
  lineNo: number;
  /** 字位，行内第几字，从 1 开始 */
  charNo: number;
  /** 残损类型：缺字 / 裂痕 / 漫漶 / 石花 */
  type: LossType;
  /** 严重程度：轻 / 中 / 重 */
  severity: LossSeverity;
  /** 现场备注 */
  note: string;
  createdAt: number;
  updatedAt: number;
}

export type InspectionDamageDraft = Omit<InspectionDamage, 'id' | 'createdAt' | 'updatedAt'>;

export function createEmptyInspectionDraft(steleId: string): InspectionDraft {
  return {
    steleId,
    sheetNo: '',
    inspectedAt: new Date().toISOString().slice(0, 10),
    inspector: '',
    surfaceStatus: '',
    protection: '',
    legacyDamageText: '',
    readonly: false,
  };
}

export function createEmptyDamageDraft(inspectionId: string, steleId: string, lineNo = 1, charNo = 1): InspectionDamageDraft {
  return {
    inspectionId,
    steleId,
    lineNo,
    charNo,
    type: 'crack',
    severity: 'medium',
    note: '',
  };
}
