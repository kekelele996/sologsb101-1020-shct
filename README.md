# 碑帖拓片编目与版本比对台（gbrubbing）

面向碑刻拓片收藏机构编目员的本地化工具：把同一碑刻的不同拓本编目登记，标注损泐字位并做版本差异比对与断代辅助判断。

核心动作：**建立碑刻与所在地档案 → 登记拓本的拓法与纸墨尺寸钤印 → 逐行标注损泐字位 → 保管组立原石巡查单并按字位记录残损 → 拓本损泐与原石残损按字位对账（挂起等现场核实）→ 无挂起字位时执行同碑多版本比对与断代 → 导出编目卡**。

纯前端单页应用（React 18 + TypeScript + Ant Design + Vite + Redux Toolkit + React Router），**无后端、无数据库服务、无 API 服务**，全部数据保存在浏览器本地（IndexedDB / Dexie + 少量 localStorage 元数据）。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先复制环境变量模板
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

启动完成后访问：**http://localhost:22820**

常用命令：

```bash
docker compose ps                 # 查看服务状态（healthy 表示就绪）
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 代码改动后重新构建
```

> 端口可在 `.env` 中通过 `FRONTEND_PORT` 修改；容器名固定为 `${COMPOSE_PROJECT_NAME:-gbrubbing}-frontend`。
> 容器无状态：不连接数据库、不挂载命名卷，数据全部在浏览器本地；迁移设备请使用 `/export` 页的「导出 / 导入 JSON 备份」。

---

## 二、技术栈

| 分类 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | React 18（函数组件 + Hooks） | 页面按路由懒加载 |
| 语言 | TypeScript（`strict: true`，`noUnusedLocals`） | `npm run build` 内含 `tsc --noEmit` 类型检查 |
| UI 组件库 | Ant Design 5（含 `@ant-design/icons`） | 表格、表单、对话框、字位网格、徽标 |
| 构建工具 | Vite 5 | 开发服务器端口 22820 |
| 状态管理 | Redux Toolkit 2 + React Redux 9 | `steleSlice` / `rubbingSlice` / `lossSlice` / `inspectionSlice` + `store.ts` 类型化 hooks |
| 路由 | React Router 6（`createBrowserRouter`，history 模式） | nginx 侧配合 `try_files` 做 SPA fallback |
| 本地存储 | Dexie 4（IndexedDB 封装）+ localStorage | 含数据结构版本号，v1→v2 字位补拆、v2→v3 原石巡查接入与老巡查单按行号补拆迁移 |
| 容器化 | Docker 多阶段构建：`node:20-alpine` → `nginx:alpine` | 构建阶段类型检查 + 打包，运行阶段仅托管静态产物 |

---

## 三、本地开发方式

```bash
cd frontend
npm install
npm run dev        # 开发服务器 http://localhost:22820
npm run build      # 类型检查 + 生产构建，产物在 frontend/dist
npm run preview    # 本地预览构建产物（http://localhost:22820）
```

要求 Node.js 20 及以上（与 Docker 构建阶段镜像 `node:20-alpine` 保持一致）。

---

## 四、页面与路由

| 路由 | 页面 | 主要职责 | 消费模型 |
| --- | --- | --- | --- |
| `/steles` | 碑刻与所在地台账 | 新建碑刻、按年代与形制筛选（同步 URL query），卡片回显已收拓本数、损泐字位与最近断代结论 | Stele、Rubbing、Loss、Compare |
| `/rubbings` | 拓本登记 | 录入拓法、纸墨、尺寸与收藏号；同碑自动生成版本序号，钤印增删改与批量调整印别，批量改状态；显示挂起·断代未放行标记 | Rubbing、Seal、Stele、Reconciliation |
| `/losses` | 损泐字位标注台 | 行号 × 字位网格逐格标注，批量改严重程度；选定基准拓本即时高亮差异字位；显示每字位原石对账状态 | Loss、Rubbing、InspectionDamage、Reconciliation |
| `/inspections` | 原石巡查单（保管组） | 只照原石现场现状记录碑面现状、防护处置并按字位补记原石残损；老单补拆结果展示，拆不出字位的老单只读 | Inspection、InspectionDamage、Reconciliation |
| `/reconcile` | 拓本 × 巡查 字位对账 | 同碑按字位对账：已对上 / 挂起 / 已核销；挂起字位等保管组现场见损补记或无损核销 | Reconciliation、Loss、Inspection、InspectionDamage、Rubbing |
| `/compare` | 同碑多版本比对与断代 | 选定 A/B 两拓本，按字位坐标比对损泐集合并排展示差异；**任一方有挂起字位时禁止保存断代结论**；推断早本 / 晚本 / 同版 / 待考并落库 | Compare、Loss、Rubbing、Reconciliation |
| `/export` | 编目卡生成与导出 | 按碑刻生成编目卡（含巡查单与对账状态）、合订导出、钤印明细、JSON 导入导出、损泐台账 CSV、清空重播种 | 全部模型 |

`/` 与未匹配路径重定向到 `/steles`。筛选条件写入 URL query（`?kw=&method=&state=` 等），可直接分享带条件的链接。

---

## 五、数据模型

| 模型 | 文件 | 关键字段 | 说明 |
| --- | --- | --- | --- |
| Stele 碑刻 | `src/types/stele.ts` | `id` `title` `era` `location` `form`（碑/碣/摩崖/墓志） `sizeCm` `calligrapher` | 新建后进入拓本登记，卡片回显拓本数与差异条数 |
| Rubbing 拓本 | `src/types/rubbing.ts` | `id` `steleId` `versionNo` `method`（擦拓/扑拓/蝉翼拓） `paperType` `inkTone`（浓墨/淡墨） `sizeCm` `collectionNo` `dateGuess` `state`（待编目/已编目/待比对） | 同碑多份并存，版本序号自动生成 |
| Loss 损泐字位 | `src/types/loss.ts` | `id` `rubbingId` `lineNo` `charNo` `type`（缺字/裂痕/漫漶/石花） `severity`（轻/中/重） `note` | 按行列网格标注，同碑同字位自动并排对比 |
| Seal 钤印 | `src/types/seal.ts` | `id` `rubbingId` `sealText` `position` `transcription` `sealType`（收藏印/鉴赏印/作者印） | 按位置排序展示，支持批量改印别 |
| Compare 版本比对 | `src/types/compare.ts` | `id` `steleId` `rubbingIdA` `rubbingIdB` `diffCount` `conclusion`（早本/晚本/同版/待考） `operator` `date` | 选定两拓本即生成差异清单并回写断代结论；任一方有挂起字位时不放行 |
| Inspection 巡查单 | `src/types/inspection.ts` | `id` `steleId` `sheetNo` `inspectedAt` `inspector` `surfaceStatus` `protection` `legacyDamageText` `readonly` | 保管组只照原石现场现状记录；老单原文留存在 `legacyDamageText`，拆不出字位的 `readonly=true` 只读 |
| InspectionDamage 原石残损字位 | `src/types/inspection.ts` | `id` `inspectionId` `steleId` `lineNo` `charNo` `type` `severity` `note` | 巡查单按字位记录的原石残损，坐标口径与 Loss 一致，是对账的原石侧依据；只能现场补记，不得取自拓本 |
| Reconciliation 对账核销 | `src/types/reconciliation.ts` | `id` `lossId` `rubbingId` `steleId` `lineNo` `charNo` `reason` `verifier` `verifiedAt` | 仅落库「现场核查原石无损」的核销；挂起 / 已对上由两侧字位集合实时派生 |

数据结构版本号 `DB_SCHEMA_VERSION` 定义在 `src/utils/db.ts`，当前为 `v3`。
- v1→v2：`losses` 表增加 `charNo` 与 `[rubbingId+lineNo+charNo]` 复合索引，并在 Dexie `.upgrade()` 中按行号顺序为历史字位记录重建 `charNo`。
- v2→v3：新增 `inspections` / `inspectionDamages` / `reconciliations` 三表（原石巡查接入编目）。旧巡查单整段残损描述由 `splitLegacyDamageText()`（`src/utils/reconcile.ts`）按「第 N 行第 M 字」补拆为字位残损；任一分句定不到字位则整单置 `readonly` 只读，不做臆造拆分。

**两侧写入边界与重试**：编目室（碑刻 / 拓本 / 损泐 / 钤印 / 比对）与保管组（巡查单 / 原石残损 / 核销）的 thunk 事务只各自读写本侧表。编目保存失败只在编目侧重试（`RetryBanner`，巡查单不动），保管组保存失败只在巡查侧重来（编目不重放）；失败载荷留在各自 Redux 重试队列，页面可逐条重试或放弃。

---

## 六、目录结构

```
sologsb101-1020/
├── frontend/                     # 前端源码
│   ├── src/
│   │   ├── types/                # stele.ts rubbing.ts loss.ts seal.ts compare.ts inspection.ts reconciliation.ts
│   │   ├── stores/               # steleSlice.ts rubbingSlice.ts lossSlice.ts inspectionSlice.ts store.ts
│   │   ├── components/common/    # LossTag.tsx FilterBar.tsx StatBadge.tsx EmptyPanel.tsx RetryBanner.tsx
│   │   ├── hooks/                # useLossDiff.ts useIdbTable.ts useReconcile.ts
│   │   ├── pages/                # SteleList.tsx RubbingList.tsx LossBoard.tsx InspectionBoard.tsx ReconcileBoard.tsx CompareView.tsx ExportView.tsx
│   │   ├── router/               # index.tsx
│   │   ├── utils/                # collate.ts reconcile.ts saveRetry.ts db.ts export.ts
│   │   ├── styles/               # main.css
│   │   ├── App.tsx main.tsx
│   ├── public/favicon.svg
│   ├── index.html package.json tsconfig.json vite.config.ts
│   ├── Dockerfile                # 多阶段构建（node:20-alpine → nginx:alpine）
│   ├── nginx.conf                # SPA fallback + gzip + 静态资源缓存
│   └── .dockerignore
├── docker-compose.yml            # 顶层 name、container_name、端口映射
├── .env / .env.example           # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── .gitignore
└── README.md
```

分层约定：页面通过 `useSelector` / `dispatch` 读写 Redux，跨页状态不留在组件内部 `useState`；IndexedDB 读写由 slice 的 `createAsyncThunk` 统一封装，页面级只读订阅（如钤印明细）走 `useIdbTable()` 的 `liveQuery`；字位坐标编解码与差异算法集中在 `utils/collate.ts`，比对派生逻辑走 `useLossDiff()`。

---

## 七、数据存储说明

- **IndexedDB（Dexie，数据库名 `gbrubbing`）**：8 张业务表 `steles` / `rubbings` / `losses` / `seals` / `compares` / `inspections` / `inspectionDamages` / `reconciliations`，由 `src/utils/db.ts` 统一定义 schema、版本号与升级迁移；`initDatabase()` 首次打开时自动播种**四层互相引用**的演示数据（Stele → Rubbing → Loss / Seal，Stele → Inspection → InspectionDamage，另有 Stele → Compare 与一条 Reconciliation 核销样例，固定 id 如 `stele_01`、`rub_0101`、`loss_010101`、`insp_0101`），播种幂等，保证字位网格、对账台与比对台打开即有内容。演示数据含两张旧系统巡查单：一张可按行号补拆、一张拆不出字位置只读。
- **localStorage**：仅存元数据 —— `gbrubbing:db-version`（本地结构版本）、`gbrubbing:last-backup-at`（最近导出时间）、`gbrubbing:ui-prefs`（当前碑刻 / 拓本）。
- **备份**：`/export` 页可导出 JSON（8 张表全量数据 + 结构版本号），导入时校验 `app` 字段与各集合数组完整性（v2 旧备份缺巡查三表时按空集合导入），覆盖导入前二次确认；另有编目卡 TXT（含巡查单与对账状态）和损泐台账 CSV（含原石对账列）。
- **隐私与无状态**：数据不上传任何服务器，容器不挂载命名卷；清理浏览器站点数据或更换浏览器会丢失档案，请定期导出备份。

---

## 八、开发提示

- 类型检查与构建：`cd frontend && npm run build`（含 `tsc --noEmit`，必须零错误）。
- 端口一致性：开发服务器（`vite.config.ts`）、预览服务、compose 的 `FRONTEND_PORT` 默认值均为 `22820`。
- 若部署在中文路径下，`docker-compose.yml` 顶层的 `name: gbrubbing` 可保证项目名不为空，`docker compose config --quiet` 不会报错。
- 容器运行阶段执行了 `RUN chmod -R a+rX /usr/share/nginx/html`，避免宿主机静态资源权限为 0600 时 nginx worker 读取失败返回 403。
