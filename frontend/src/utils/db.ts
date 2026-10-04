/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据结构版本号与升级迁移逻辑
 *   v1 → v2：Loss 增加 charNo 与复合索引，并按行号顺序重建历史字位记录
 *   v2 → v3：接入原石巡查 —— 新增 inspections / inspectionDamages / reconciliations
 *            旧巡查单未拆字位的残损描述按「第 N 行第 M 字」补拆，拆不出的老单置只读
 * - 八张业务表的增删改查与整库导入导出
 * - 首次打开自动播种四层互相引用的演示数据（幂等）
 * 纯前端应用：不依赖任何后端服务或数据库。
 */
import Dexie, { type Table } from 'dexie';
import type { Stele } from '@/types/stele';
import type { Rubbing } from '@/types/rubbing';
import type { Loss } from '@/types/loss';
import type { Seal } from '@/types/seal';
import type { Compare } from '@/types/compare';
import type { Inspection, InspectionDamage } from '@/types/inspection';
import type { Reconciliation } from '@/types/reconciliation';
import { sortLosses } from './collate';
import { splitLegacyDamageText } from './reconcile';

/** 数据库名（README 与导出文件均使用该名称） */
export const DB_NAME = 'gbrubbing';

/** 当前数据结构版本号（v3：接入原石巡查与字位对账） */
export const DB_SCHEMA_VERSION = 3;

/** localStorage 侧少量元数据键 */
export const LS_KEYS = {
  dbVersion: 'gbrubbing:db-version',
  lastBackupAt: 'gbrubbing:last-backup-at',
  uiPrefs: 'gbrubbing:ui-prefs',
} as const;

export interface UiPrefs {
  lastSteleId: string | null;
  lastRubbingId: string | null;
}

export const DEFAULT_UI_PREFS: UiPrefs = { lastSteleId: null, lastRubbingId: null };

export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(LS_KEYS.uiPrefs);
    if (!raw) return { ...DEFAULT_UI_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      lastSteleId: typeof parsed.lastSteleId === 'string' ? parsed.lastSteleId : null,
      lastRubbingId: typeof parsed.lastRubbingId === 'string' ? parsed.lastRubbingId : null,
    };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export function writeUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(LS_KEYS.uiPrefs, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function stampDbVersion(): void {
  try {
    localStorage.setItem(LS_KEYS.dbVersion, String(DB_SCHEMA_VERSION));
  } catch {
    /* ignore */
  }
}

export function readLastBackupAt(): string | null {
  try {
    return localStorage.getItem(LS_KEYS.lastBackupAt);
  } catch {
    return null;
  }
}

export function writeLastBackupAt(value: string): void {
  try {
    localStorage.setItem(LS_KEYS.lastBackupAt, value);
  } catch {
    /* ignore */
  }
}

class RubbingDatabase extends Dexie {
  steles!: Table<Stele, string>;
  rubbings!: Table<Rubbing, string>;
  losses!: Table<Loss, string>;
  seals!: Table<Seal, string>;
  compares!: Table<Compare, string>;
  inspections!: Table<Inspection, string>;
  inspectionDamages!: Table<InspectionDamage, string>;
  reconciliations!: Table<Reconciliation, string>;

  constructor() {
    super(DB_NAME);

    // v1：初版结构（历史字位记录仅有 lineNo）
    this.version(1).stores({
      steles: 'id, title, era, form, updatedAt',
      rubbings: 'id, steleId, versionNo, method, state, updatedAt',
      losses: 'id, rubbingId, lineNo, type, severity, updatedAt',
      seals: 'id, rubbingId, sealType, updatedAt',
      compares: 'id, steleId, rubbingIdA, rubbingIdB, conclusion, updatedAt',
    });

    // v2：Loss 增加 charNo 与 [rubbingId+lineNo+charNo] 复合索引，并按行号顺序重建历史字位记录
    this.version(2).stores({
      steles: 'id, title, era, form, location, updatedAt',
      rubbings: 'id, steleId, versionNo, method, inkTone, state, updatedAt',
      losses: 'id, rubbingId, lineNo, charNo, [rubbingId+lineNo+charNo], type, severity, updatedAt',
      seals: 'id, rubbingId, sealType, position, updatedAt',
      compares: 'id, steleId, rubbingIdA, rubbingIdB, conclusion, date, updatedAt',
    });

    // v3：接入原石巡查 —— 巡查单 / 原石残损字位 / 对账核销
    this.version(DB_SCHEMA_VERSION)
      .stores({
        steles: 'id, title, era, form, location, updatedAt',
        rubbings: 'id, steleId, versionNo, method, inkTone, state, updatedAt',
        losses: 'id, rubbingId, lineNo, charNo, [rubbingId+lineNo+charNo], type, severity, updatedAt',
        seals: 'id, rubbingId, sealType, position, updatedAt',
        compares: 'id, steleId, rubbingIdA, rubbingIdB, conclusion, date, updatedAt',
        inspections: 'id, steleId, sheetNo, inspectedAt, readonly, updatedAt',
        inspectionDamages:
          'id, inspectionId, steleId, lineNo, charNo, [steleId+lineNo+charNo], type, severity, updatedAt',
        reconciliations: 'id, steleId, rubbingId, lossId, lineNo, charNo, verifiedAt, updatedAt',
      })
      .upgrade(async (tx) => {
        // v2 字位补拆迁移（保留原逻辑）
        const lossTable = tx.table<Loss>('losses');
        const allLosses = await lossTable.toArray();
        const byRubbing = new Map<string, Loss[]>();
        allLosses.forEach((loss) => {
          byRubbing.set(loss.rubbingId, [...(byRubbing.get(loss.rubbingId) ?? []), loss]);
        });
        const rebuiltLosses: Loss[] = [];
        byRubbing.forEach((list) => {
          // 按行号排序后，为缺失 charNo 的历史记录在行内顺序补位
          const sorted = [...list].sort((a, b) => a.lineNo - b.lineNo);
          const counter = new Map<number, number>();
          sorted.forEach((loss) => {
            const used = counter.get(loss.lineNo) ?? 0;
            const charNo = typeof loss.charNo === 'number' && loss.charNo > 0 ? loss.charNo : used + 1;
            counter.set(loss.lineNo, Math.max(used, charNo));
            rebuiltLosses.push({ ...loss, charNo, updatedAt: Date.now() });
          });
        });
        await lossTable.bulkPut(sortLosses(rebuiltLosses));

        // 巡查侧是新表：仅在为空（从 v1/v2 升级）时补入演示巡查单，
        // 并把旧巡查单整段残损描述按碑面行号补拆为字位残损；拆不出字位的老单留只读。
        const inspectionTable = tx.table<Inspection>('inspections');
        if ((await inspectionTable.count()) === 0) {
          const steleIds = new Set((await tx.table<Stele>('steles').toArray()).map((row) => row.id));
          const rubbingIds = new Set((await tx.table<Rubbing>('rubbings').toArray()).map((row) => row.id));
          const lossIds = new Set((await tx.table<Loss>('losses').toArray()).map((row) => row.id));
          const seed = buildInspectionSeed(Date.now());
          const inspections = seed.inspections.filter((row) => steleIds.has(row.steleId));
          const damages = seed.damages.filter((row) => steleIds.has(row.steleId));
          const reconciliations = seed.reconciliations.filter(
            (row) => steleIds.has(row.steleId) && rubbingIds.has(row.rubbingId) && lossIds.has(row.lossId),
          );
          if (inspections.length > 0) {
            await inspectionTable.bulkPut(inspections);
            await tx.table<InspectionDamage>('inspectionDamages').bulkPut(damages);
            await tx.table<Reconciliation>('reconciliations').bulkPut(reconciliations);
          }
        }
      });
  }
}

export const db = new RubbingDatabase();

/** 生成主键：短前缀 + 时间戳 + 随机串 */
export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** 打开数据库并在首次使用时播种演示数据（幂等） */
export async function initDatabase(): Promise<void> {
  await db.open();
  stampDbVersion();
  if ((await db.steles.count()) === 0) {
    await seedDatabase();
  }
}

/* ------------------------------ 播种数据 ------------------------------ */
/* 四层互相引用：Stele → Rubbing →（Loss / Seal）＋ Stele → Inspection → InspectionDamage，另含对账核销 */

export async function seedDatabase(): Promise<void> {
  const now = Date.now();
  const day = 86400000;

  const steles: Stele[] = [
    {
      id: 'stele_01',
      title: '礼器碑',
      era: '东汉永寿二年',
      location: '山东曲阜孔庙',
      form: 'stele',
      sizeCm: '227×93',
      calligrapher: '佚名（隶书）',
      createdAt: now - day * 60,
      updatedAt: now - day * 3,
    },
    {
      id: 'stele_02',
      title: '石门颂',
      era: '东汉建和二年',
      location: '陕西汉中石门',
      form: 'cliff',
      sizeCm: '261×205',
      calligrapher: '王升（隶书）',
      createdAt: now - day * 48,
      updatedAt: now - day * 2,
    },
    {
      id: 'stele_03',
      title: '颜勤礼碑',
      era: '唐大历十四年',
      location: '陕西西安碑林',
      form: 'stele',
      sizeCm: '268×92',
      calligrapher: '颜真卿（楷书）',
      createdAt: now - day * 36,
      updatedAt: now - day * 1,
    },
  ];

  const rubbings: Rubbing[] = [
    { id: 'rub_0101', steleId: 'stele_01', versionNo: 1, method: 'rub', paperType: '宣纸', inkTone: 'thick', sizeCm: '210×88', collectionNo: 'TB-0101', dateGuess: '明拓', state: 'cataloged', createdAt: now - day * 50, updatedAt: now - day * 10 },
    { id: 'rub_0102', steleId: 'stele_01', versionNo: 2, method: 'cicada', paperType: '棉连纸', inkTone: 'light', sizeCm: '208×86', collectionNo: 'TB-0102', dateGuess: '清拓', state: 'toCompare', createdAt: now - day * 44, updatedAt: now - day * 6 },
    { id: 'rub_0201', steleId: 'stele_02', versionNo: 1, method: 'pat', paperType: '皮纸', inkTone: 'thick', sizeCm: '250×196', collectionNo: 'TB-0201', dateGuess: '清中期拓', state: 'cataloged', createdAt: now - day * 40, updatedAt: now - day * 5 },
    { id: 'rub_0202', steleId: 'stele_02', versionNo: 2, method: 'rub', paperType: '棉连纸', inkTone: 'light', sizeCm: '248×194', collectionNo: 'TB-0202', dateGuess: '清晚期拓', state: 'toCatalog', createdAt: now - day * 34, updatedAt: now - day * 4 },
    { id: 'rub_0301', steleId: 'stele_03', versionNo: 1, method: 'rub', paperType: '净皮宣', inkTone: 'thick', sizeCm: '260×90', collectionNo: 'TB-0301', dateGuess: '民国拓', state: 'toCatalog', createdAt: now - day * 20, updatedAt: now - day * 2 },
  ];

  const losses: Loss[] = [
    { id: 'loss_010101', rubbingId: 'rub_0101', lineNo: 3, charNo: 7, type: 'blur', severity: 'light', note: '「壽」字右下漫漶', createdAt: now - day * 30, updatedAt: now - day * 30 },
    { id: 'loss_010102', rubbingId: 'rub_0101', lineNo: 5, charNo: 2, type: 'stoneFlower', severity: 'medium', note: '石花漫及「年」字', createdAt: now - day * 30, updatedAt: now - day * 29 },
    { id: 'loss_010103', rubbingId: 'rub_0101', lineNo: 9, charNo: 11, type: 'missing', severity: 'heavy', note: '「禮」字缺末笔', createdAt: now - day * 28, updatedAt: now - day * 28 },
    { id: 'loss_010201', rubbingId: 'rub_0102', lineNo: 3, charNo: 7, type: 'blur', severity: 'medium', note: '晚拓，「壽」字已损', createdAt: now - day * 24, updatedAt: now - day * 24 },
    { id: 'loss_010202', rubbingId: 'rub_0102', lineNo: 9, charNo: 11, type: 'missing', severity: 'heavy', note: '「禮」字全缺', createdAt: now - day * 24, updatedAt: now - day * 22 },
    { id: 'loss_010203', rubbingId: 'rub_0102', lineNo: 12, charNo: 4, type: 'crack', severity: 'medium', note: '碑面斜裂一道', createdAt: now - day * 22, updatedAt: now - day * 22 },
    { id: 'loss_020101', rubbingId: 'rub_0201', lineNo: 2, charNo: 5, type: 'crack', severity: 'light', note: '崖面细裂', createdAt: now - day * 18, updatedAt: now - day * 18 },
    { id: 'loss_020201', rubbingId: 'rub_0202', lineNo: 2, charNo: 5, type: 'crack', severity: 'light', note: '崖面细裂（同前）', createdAt: now - day * 20, updatedAt: now - day * 20 },
    { id: 'loss_020202', rubbingId: 'rub_0202', lineNo: 6, charNo: 3, type: 'blur', severity: 'medium', note: '晚拓，「頌」字已漫漶', createdAt: now - day * 18, updatedAt: now - day * 18 },
    { id: 'loss_030101', rubbingId: 'rub_0301', lineNo: 4, charNo: 3, type: 'blur', severity: 'heavy', note: '民国拓，字口已平', createdAt: now - day * 10, updatedAt: now - day * 10 },
  ];

  const seals: Seal[] = [
    { id: 'seal_0101', rubbingId: 'rub_0101', sealText: '端方藏碑', position: '右下角', transcription: '端方（匋斋）收藏印', sealType: 'collection', createdAt: now - day * 40, updatedAt: now - day * 40 },
    { id: 'seal_0102', rubbingId: 'rub_0101', sealText: '匋斋鉴赏', position: '左下角', transcription: '端方鉴赏印', sealType: 'appraisal', createdAt: now - day * 40, updatedAt: now - day * 40 },
    { id: 'seal_0103', rubbingId: 'rub_0102', sealText: '艺风堂', position: '卷尾', transcription: '缪荃孙艺风堂藏书印', sealType: 'collection', createdAt: now - day * 30, updatedAt: now - day * 30 },
    { id: 'seal_0201', rubbingId: 'rub_0201', sealText: '石门旧拓', position: '左上角', transcription: '藏家自钤印', sealType: 'author', createdAt: now - day * 26, updatedAt: now - day * 26 },
  ];

  const compares: Compare[] = [
    { id: 'cmp_0101', steleId: 'stele_01', rubbingIdA: 'rub_0101', rubbingIdB: 'rub_0102', diffCount: 3, conclusion: 'early', operator: '傅砚', date: '2026-03-06', createdAt: now - day * 5, updatedAt: now - day * 5 },
    { id: 'cmp_0201', steleId: 'stele_02', rubbingIdA: 'rub_0201', rubbingIdB: 'rub_0202', diffCount: 1, conclusion: 'late', operator: '傅砚', date: '2026-03-08', createdAt: now - day * 3, updatedAt: now - day * 3 },
  ];

  const inspectionSeed = buildInspectionSeed(now);

  await db.transaction(
    'rw',
    [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.inspections, db.inspectionDamages, db.reconciliations],
    async () => {
      await db.steles.bulkPut(steles);
      await db.rubbings.bulkPut(rubbings);
      await db.losses.bulkPut(losses);
      await db.seals.bulkPut(seals);
      await db.compares.bulkPut(compares);
      await db.inspections.bulkPut(inspectionSeed.inspections);
      await db.inspectionDamages.bulkPut(inspectionSeed.damages);
      await db.reconciliations.bulkPut(inspectionSeed.reconciliations);
    },
  );
}

/* --------------------- 巡查侧演示数据（含老单补拆） --------------------- */

interface InspectionSeed {
  inspections: Inspection[];
  damages: InspectionDamage[];
  reconciliations: Reconciliation[];
}

/**
 * 巡查侧演示数据：
 * - 正常巡查单（照原石现状记录）：insp_0101 / insp_0201
 * - 旧系统迁移老单：insp_0301（残损描述可按行号补拆）、insp_0302（拆不出字位 → 只读）
 * 补拆结果由 materializeLegacyInspections 统一生成，保证「升级补拆」与「新库播种」口径一致。
 */
export function buildInspectionSeed(now: number): InspectionSeed {
  const day = 86400000;

  const inspections: Inspection[] = [
    {
      id: 'insp_0101',
      steleId: 'stele_01',
      sheetNo: 'XC-0101',
      inspectedAt: '2026-02-18',
      inspector: '卫山',
      surfaceStatus: '碑面整体完好，第三行右下、第九行有旧损；碑阳中部有近期拓制留痕。',
      protection: '碑亭遮檐完好，加装防风化围挡，禁止近拓。',
      legacyDamageText: '',
      readonly: false,
      createdAt: now - day * 16,
      updatedAt: now - day * 16,
    },
    {
      id: 'insp_0201',
      steleId: 'stele_02',
      sheetNo: 'XC-0201',
      inspectedAt: '2026-02-20',
      inspector: '卫山',
      surfaceStatus: '摩崖崖面第二行有细裂一道，裂隙无扩展；其余字口清晰。',
      protection: '裂隙支顶监测，季度复测。',
      legacyDamageText: '',
      readonly: false,
      createdAt: now - day * 14,
      updatedAt: now - day * 14,
    },
    {
      id: 'insp_0301',
      steleId: 'stele_03',
      sheetNo: 'XC-0301（旧）',
      inspectedAt: '2025-11-02',
      inspector: '邵巡',
      surfaceStatus: '旧系统抄录，残损未按字位登记。',
      protection: '旧单未记防护处置。',
      // 可按行号补拆的老单原文
      legacyDamageText: '第三行第七字有细裂纹一道；第四行第三字漫漶，字口已平；第五行第二字石花一处。',
      readonly: false,
      createdAt: now - day * 120,
      updatedAt: now - day * 120,
    },
    {
      id: 'insp_0302',
      steleId: 'stele_03',
      sheetNo: 'XC-0302（旧）',
      inspectedAt: '2025-08-15',
      inspector: '邵巡',
      surfaceStatus: '旧系统抄录，残损未按字位登记。',
      protection: '旧单未记防护处置。',
      // 无法定位到字位的老单原文 → 补拆失败 → 只读
      legacyDamageText: '碑额左下角风化较重，石筋处有数道裂纹，具体字位待现场核。',
      readonly: false,
      createdAt: now - day * 200,
      updatedAt: now - day * 200,
    },
  ];

  const damages: InspectionDamage[] = [
    { id: 'idmg_010101', inspectionId: 'insp_0101', steleId: 'stele_01', lineNo: 3, charNo: 7, type: 'blur', severity: 'medium', note: '原石「壽」字右下确有漫漶', createdAt: now - day * 16, updatedAt: now - day * 16 },
    { id: 'idmg_010102', inspectionId: 'insp_0101', steleId: 'stele_01', lineNo: 9, charNo: 11, type: 'missing', severity: 'heavy', note: '原石「禮」字末笔确缺', createdAt: now - day * 16, updatedAt: now - day * 16 },
    { id: 'idmg_020101', inspectionId: 'insp_0201', steleId: 'stele_02', lineNo: 2, charNo: 5, type: 'crack', severity: 'light', note: '崖面细裂，与拓本所现一致', createdAt: now - day * 14, updatedAt: now - day * 14 },
  ];

  // 旧单按碑面行号补拆；拆不出来的老单置只读
  materializeLegacyInspections(inspections, damages);

  const reconciliations: Reconciliation[] = [
    {
      id: 'rec_010102',
      lossId: 'loss_010102',
      rubbingId: 'rub_0101',
      steleId: 'stele_01',
      lineNo: 5,
      charNo: 2,
      reason: '原石该字位完好，所谓石花为拓本纸疤，非石面残损。',
      verifier: '卫山',
      verifiedAt: '2026-02-18',
      createdAt: now - day * 16,
      updatedAt: now - day * 16,
    },
  ];

  return { inspections, damages, reconciliations };
}

/**
 * 对 legacyDamageText 非空的老巡查单按行号补拆：
 * - 每个实义分句都带「第 N 行第 M 字」→ 拆成原石残损字位，单子可继续使用
 * - 任一分句定不到字位 → 不拆，单子 readonly 留只读
 */
export function materializeLegacyInspections(inspections: Inspection[], damages: InspectionDamage[]): void {
  inspections
    .filter((sheet) => sheet.legacyDamageText.trim().length > 0)
    .forEach((sheet) => {
      const result = splitLegacyDamageText(sheet.legacyDamageText);
      if (!result.complete) {
        sheet.readonly = true;
        return;
      }
      sheet.readonly = false;
      const stamp = Date.now();
      result.items.forEach((item, index) => {
        damages.push({
          id: `idmg_${sheet.id.replace('insp_', '')}${String(index + 1).padStart(2, '0')}`,
          inspectionId: sheet.id,
          steleId: sheet.steleId,
          lineNo: item.lineNo,
          charNo: item.charNo,
          type: item.type,
          severity: item.severity,
          note: `【老单补拆】${item.note}`,
          createdAt: stamp,
          updatedAt: stamp,
        });
      });
    });
}

/* ------------------------------ 整库导入导出 ------------------------------ */

export interface RubbingSnapshot {
  app: typeof DB_NAME;
  schemaVersion: number;
  exportedAt: string;
  steles: Stele[];
  rubbings: Rubbing[];
  losses: Loss[];
  seals: Seal[];
  compares: Compare[];
  inspections: Inspection[];
  inspectionDamages: InspectionDamage[];
  reconciliations: Reconciliation[];
}

export async function exportSnapshot(): Promise<RubbingSnapshot> {
  const [steles, rubbings, losses, seals, compares, inspections, inspectionDamages, reconciliations] = await Promise.all([
    db.steles.toArray(),
    db.rubbings.toArray(),
    db.losses.toArray(),
    db.seals.toArray(),
    db.compares.toArray(),
    db.inspections.toArray(),
    db.inspectionDamages.toArray(),
    db.reconciliations.toArray(),
  ]);
  return {
    app: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    steles,
    rubbings,
    losses,
    seals,
    compares,
    inspections,
    inspectionDamages,
    reconciliations,
  };
}

/** 校验导入文件结构，返回错误文案（空串表示通过）；兼容 v2 旧备份（无巡查三表） */
export function validateSnapshot(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '文件内容不是合法的 JSON 对象';
  const snapshot = input as Partial<RubbingSnapshot>;
  if (snapshot.app !== DB_NAME) return `备份文件不属于本项目（app=${String(snapshot.app)}）`;
  const keys: Array<keyof RubbingSnapshot> = ['steles', 'rubbings', 'losses', 'seals', 'compares'];
  for (const key of keys) {
    if (!Array.isArray(snapshot[key])) return `备份文件缺少 ${String(key)} 集合`;
  }
  return '';
}

const ALL_TABLES = [
  'steles',
  'rubbings',
  'losses',
  'seals',
  'compares',
  'inspections',
  'inspectionDamages',
  'reconciliations',
] as const;

export async function clearAllTables(): Promise<void> {
  await db.transaction(
    'rw',
    [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.inspections, db.inspectionDamages, db.reconciliations],
    async () => {
      await Promise.all([
        db.steles.clear(),
        db.rubbings.clear(),
        db.losses.clear(),
        db.seals.clear(),
        db.compares.clear(),
        db.inspections.clear(),
        db.inspectionDamages.clear(),
        db.reconciliations.clear(),
      ]);
    },
  );
}

export async function importSnapshot(snapshot: RubbingSnapshot): Promise<void> {
  await clearAllTables();
  await db.transaction(
    'rw',
    [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.inspections, db.inspectionDamages, db.reconciliations],
    async () => {
      await db.steles.bulkPut(snapshot.steles);
      await db.rubbings.bulkPut(snapshot.rubbings);
      await db.losses.bulkPut(snapshot.losses);
      await db.seals.bulkPut(snapshot.seals);
      await db.compares.bulkPut(snapshot.compares);
      // v2 旧备份没有巡查三表，按空集合导入
      await db.inspections.bulkPut(snapshot.inspections ?? []);
      await db.inspectionDamages.bulkPut(snapshot.inspectionDamages ?? []);
      await db.reconciliations.bulkPut(snapshot.reconciliations ?? []);
    },
  );
}

export async function resetDatabase(): Promise<void> {
  await clearAllTables();
  await seedDatabase();
}

export async function countAll(): Promise<Record<string, number>> {
  const [steles, rubbings, losses, seals, compares, inspections, inspectionDamages, reconciliations] = await Promise.all([
    db.steles.count(),
    db.rubbings.count(),
    db.losses.count(),
    db.seals.count(),
    db.compares.count(),
    db.inspections.count(),
    db.inspectionDamages.count(),
    db.reconciliations.count(),
  ]);
  return { steles, rubbings, losses, seals, compares, inspections, inspectionDamages, reconciliations };
}

/** 级联删除碑刻 → 拓本 → 损泐 / 钤印 / 比对；巡查侧三表同碑记录一并删除（保管组按碑独立留痕） */
export async function removeSteleCascade(steleId: string): Promise<void> {
  const rubbingIds = (await db.rubbings.where('steleId').equals(steleId).toArray()).map((row) => row.id);
  const inspectionIds = (await db.inspections.where('steleId').equals(steleId).toArray()).map((row) => row.id);
  await db.transaction(
    'rw',
    [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.inspections, db.inspectionDamages, db.reconciliations],
    async () => {
      if (rubbingIds.length > 0) {
        await db.losses.where('rubbingId').anyOf(rubbingIds).delete();
        await db.seals.where('rubbingId').anyOf(rubbingIds).delete();
      }
      if (inspectionIds.length > 0) {
        await db.inspectionDamages.where('inspectionId').anyOf(inspectionIds).delete();
      }
      await db.reconciliations.where('steleId').equals(steleId).delete();
      await db.inspectionDamages.where('steleId').equals(steleId).delete();
      await db.inspections.where('steleId').equals(steleId).delete();
      await db.rubbings.where('steleId').equals(steleId).delete();
      await db.compares.where('steleId').equals(steleId).delete();
      await db.steles.delete(steleId);
    },
  );
}

/** 级联删除拓本 → 损泐 / 钤印 / 涉及的比对记录；该拓本的对账核销随之删除（巡查单不动） */
export async function removeRubbingCascade(rubbingId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.rubbings, db.losses, db.seals, db.compares, db.reconciliations],
    async () => {
      await db.losses.where('rubbingId').equals(rubbingId).delete();
      await db.seals.where('rubbingId').equals(rubbingId).delete();
      await db.reconciliations.where('rubbingId').equals(rubbingId).delete();
      const compares = await db.compares.toArray();
      const affected = compares.filter((row) => row.rubbingIdA === rubbingId || row.rubbingIdB === rubbingId);
      if (affected.length > 0) await db.compares.bulkDelete(affected.map((row) => row.id));
      await db.rubbings.delete(rubbingId);
    },
  );
}

/** 重排某碑刻下拓本的版本序号，保证连续 */
export async function renumberRubbings(steleId: string): Promise<void> {
  const rows = await db.rubbings.where('steleId').equals(steleId).toArray();
  const sorted = [...rows].sort((a, b) => (a.versionNo === b.versionNo ? a.createdAt - b.createdAt : a.versionNo - b.versionNo));
  await db.rubbings.bulkPut(sorted.map((row, index) => ({ ...row, versionNo: index + 1, updatedAt: Date.now() })));
}

export { ALL_TABLES };
