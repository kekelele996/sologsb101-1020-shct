/**
 * 原石巡查单（Inspection）数据模型
 * 保管组对碑刻原石的巡查记录：只照原石现状记碑面现状与防护处置，
 * 残损按碑面行号 + 字位坐标记录，用于与编目室拓本损泐对账。
 * 拓本标了损泐而巡查单没记的字位先挂起，等保管组到现场核实。
 */
import type { LossSeverity, LossType } from './loss';

/** 挂起状态：待核实 / 已确认 / 已撤销 */
export type SuspensionStatus = 'pending' | 'confirmed' | 'cleared';

/** 巡查单残损字位：保管组在现场按碑面行号 + 字位记录的原石残损 */
export interface InspectionDamage {
  /** 行号，从 1 开始 */
  lineNo: number;
  /** 字位，行内第几字，从 1 开始 */
  charNo: number;
  /** 残损类型 */
  type: LossType;
  /** 严重程度 */
  severity: LossSeverity;
  /** 现场记录备注 */
  note: string;
}

/** 挂起字位：拓本标了损泐但巡查单未记，等保管组到现场看过再定 */
export interface Suspension {
  id: string;
  /** 提出挂起的拓本 id */
  rubbingId: string;
  /** 行号 */
  lineNo: number;
  /** 字位 */
  charNo: number;
  /** 挂起状态 */
  status: SuspensionStatus;
  /** 核实时间，未核实为 null */
  verifiedAt: number | null;
  /** 保管组现场核实说明 */
  verifyNote: string;
  /** 核实时认定的残损类型（confirmed 时必填，须现场记录，不得从拓本回填） */
  verifyType: LossType | null;
  /** 核实时认定的残损程度（confirmed 时必填，须现场记录，不得从拓本回填） */
  verifySeverity: LossSeverity | null;
}

/** 巡查单：保管组对原石的巡查记录，只照原石现状记 */
export interface Inspection {
  id: string;
  /** 所属碑刻 id */
  steleId: string;
  /** 巡查日期 yyyy-MM-dd */
  inspectDate: string;
  /** 巡查人 */
  inspector: string;
  /** 碑面现状 */
  surfaceState: string;
  /** 防护处置 */
  protection: string;
  /** 残损字位（按字位坐标记录） */
  damagePositions: InspectionDamage[];
  /** 挂起字位（拓本有损泐而巡查单未记，待现场核实） */
  suspensions: Suspension[];
  /** 旧单未拆字位的残损描述，升级时按碑面行号补拆 */
  legacyDamageNote: string;
  /** 拆字位状态：已拆 / 只读（拆不出来的老单留只读） */
  splitStatus: 'split' | 'readonly';
  createdAt: number;
  updatedAt: number;
}

export type InspectionDraft = Omit<Inspection, 'id' | 'createdAt' | 'updatedAt'>;

export const SUSPENSION_STATUS_LABEL: Record<SuspensionStatus, string> = {
  pending: '待核实',
  confirmed: '已确认',
  cleared: '已撤销',
};

export const SUSPENSION_STATUS_COLOR: Record<SuspensionStatus, string> = {
  pending: '#c9963c',
  confirmed: '#b03a2e',
  cleared: '#8c8c8c',
};

export const SUSPENSION_STATUS_OPTIONS: ReadonlyArray<{ value: SuspensionStatus; label: string }> = [
  { value: 'pending', label: '待核实' },
  { value: 'confirmed', label: '已确认残损' },
  { value: 'cleared', label: '已撤销' },
];

export const SPLIT_STATUS_LABEL: Record<Inspection['splitStatus'], string> = {
  split: '已拆字位',
  readonly: '只读老单',
};

export function createEmptyInspectionDraft(steleId: string): InspectionDraft {
  return {
    steleId,
    inspectDate: new Date().toISOString().slice(0, 10),
    inspector: '',
    surfaceState: '',
    protection: '',
    damagePositions: [],
    suspensions: [],
    legacyDamageNote: '',
    splitStatus: 'split',
  };
}

export function createEmptyInspectionDamage(): InspectionDamage {
  return { lineNo: 1, charNo: 1, type: 'blur', severity: 'medium', note: '' };
}
