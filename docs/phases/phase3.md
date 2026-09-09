## Phase 3：前端交互系统 — 全面任务清单


# Phase 3 完整任务清单

> **前置条件**：Phase 0（Tauri 骨架）、Phase 1（ComponentLoader + SVGParser）、Phase 2（Canvas 渲染管线）全部完成。
>
> **Phase 3 目标**：将静态电路图升级为可交互的电路编辑器，支持放置元件、拖拽移动、连线、选中、删除等完整编辑操作。


## 任务总览

```
Phase 3 任务依赖关系：

Task 3.1 (交互状态机)
    ↓
Task 3.2 (CircuitManager 数据管理)
    ↓
┌───────────────────────┼───────────────────────────┐
│                       │                           │
▼                       ▼                           ▼
Task 3.3            Task 3.6                    Task 3.7
(碰撞检测器)         (选中高亮)                  (快捷键系统)
│                       │                           │
├───────┬───────────────┤                           │
│       │               │                           │
▼       ▼               ▼                           │
Task 3.4            Task 3.5                    Task 3.8
(放置元件)          (拖拽移动)                  (右键菜单)
│                       │                           │
└───────────┬───────────┘                           │
            │                                       │
            ▼                                       │
        Task 3.9                                    │
        (磁吸连线)                                  │
            │                                       │
            └───────────────────┬───────────────────┘
                                │
                                ▼
                        Task 3.10 (交互集成验收)
```


## Task 3.1：交互模式状态机（InteractionManager）

**目标**：实现 Select / Place / Wire / Pan 四种交互模式的完整状态管理。

**具体任务**：

### 3.1.1 模式定义与类型

在 `src/types.ts` 中新增：
```typescript
// ===== 交互模式 =====
export type Mode = 'select' | 'place' | 'wire' | 'pan';

// ===== 引脚引用 =====
export interface PinRef {
  componentId: number;
  pinId: string;
}

// ===== 待完成操作（Pending Action） =====
export type PendingAction =
  | { kind: 'place'; type: string }          // Place 模式：待放置的元件类型
  | { kind: 'wire'; start: PinRef }          // Wire 模式：已选中的起点引脚
  | null;                                    // 无未完成操作
```

**验收标准**：
- [ ] 类型定义完整，无 `any`
- [ ] 编译无报错

### 3.1.2 InteractionManager 类

创建 `src/interaction/InteractionManager.ts`：

```typescript
export class InteractionManager {
  private mode: Mode = 'select';
  private pending: PendingAction = null;
  private onModeChange?: (mode: Mode) => void;

  // ---- 核心 API ----
  getMode(): Mode;
  getPending(): PendingAction;
  setMode(newMode: Mode): void;
  setPending(action: PendingAction): void;
  clearPending(): void;

  // ---- 模式切换逻辑 ----
  // 切换到 select：清理所有 pending，恢复正常光标
  // 切换到 place：进入待放置模式（等待点击画布）
  // 切换到 wire：进入连线模式（等待点击引脚）
  // 切换到 pan：临时平移模式（可随时释放返回）
  isPending(): boolean;
  isPlaceMode(): boolean;
  isWireMode(): boolean;
}
```

**验收标准**：
- [ ] 模式切换正确更新内部状态
- [ ] 切换到 Select 时自动清空 pending
- [ ] 提供模式查询方法

### 3.1.3 工具栏模式按钮绑定

修改 `index.html` 的工具栏按钮，绑定点击事件：
- `#modeSelect` → 切换到 Select
- `#modeWire` → 切换到 Wire
- `#modePlace` → 切换到 Place
- 当前模式按钮高亮（`active` class）
- 模式切换时更新 `#modeDisplay` 文字

**验收标准**：
- [ ] 点击按钮切换模式，对应的按钮获得 `active` 高亮
- [ ] 模式名称在状态栏或工具栏正确显示
- [ ] 切换到 Select 时取消所有 pending 状态


## Task 3.2：CircuitManager（电路数据管理）

**目标**：建立电路数据的统一管理模块，提供增删改查和选择操作。

**具体任务**：

### 3.2.1 CircuitManager 类

创建 `src/manager/CircuitManager.ts`：

```typescript
import type { ComponentInstance, Wire, Circuit } from '../types';

export class CircuitManager {
  private components: ComponentInstance[] = [];
  private wires: Wire[] = [];
  private selectedId: number | null = null;
  private nextId: number = 1;

  // ---- 数据查询 ----
  getComponents(): ComponentInstance[];
  getWires(): Wire[];
  getCircuit(): Circuit;
  getComponent(id: number): ComponentInstance | undefined;
  getSelected(): ComponentInstance | null;
  getSelectedId(): number | null;

  // ---- 数据修改 ----
  addComponent(type: string, x: number, y: number): ComponentInstance;
  removeComponent(id: number): void;
  selectComponent(id: number | null): void;
  moveComponent(id: number, x: number, y: number): void;

  // ---- 连线操作 ----
  addWire(start: PinRef, end: PinRef): Wire | null;
  removeWire(id: number): void;
  getWiresForComponent(compId: number): Wire[];

  // ---- 参数操作 ----
  updateParam(compId: number, paramId: string, value: any): void;

  // ---- 事件通知 ----
  private triggerUpdate(): void;
  onUpdate(callback: (circuit: Circuit) => void): void;
}
```

### 3.2.2 删除级联逻辑

`removeComponent(id)` 必须：
1. 查找所有关联的连线（`startComponentId === id || endComponentId === id`）
2. 删除这些连线
3. 删除元件
4. 如果选中的是被删除的元件，取消选中
5. 触发 `onUpdate` 回调

**验收标准**：
- [ ] 删除元件时，所有关联连线自动删除
- [ ] 删除后选中状态正确清理
- [ ] `onUpdate` 回调正确触发


## Task 3.3：碰撞检测器（HitTester）

**目标**：实现精确的鼠标点击检测，区分引脚和元件。

**具体任务**：

创建 `src/utils/hitTest.ts`：

```typescript
// ---- 引脚检测（圆形） ----
export function hitTestPins(
  logicalX: number,
  logicalY: number,
  components: ComponentInstance[],
  loader: ComponentLoader
): PinRef | null;

// ---- 元件检测（矩形，逆序上层优先） ----
export function hitTestComponents(
  logicalX: number,
  logicalY: number,
  components: ComponentInstance[]
): number | null;

// ---- 磁吸检测（阈值 20px） ----
export function snapToNearestPin(
  logicalX: number,
  logicalY: number,
  components: ComponentInstance[],
  loader: ComponentLoader,
  threshold?: number
): { snapped: boolean; x: number; y: number; ref: PinRef | null };

// ---- 综合检测（先引脚后元件） ----
export function hitTest(
  logicalX: number,
  logicalY: number,
  components: ComponentInstance[],
  loader: ComponentLoader
): { kind: 'pin'; ref: PinRef } | { kind: 'component'; id: number } | { kind: 'none' };
```

**验收标准**：
- [ ] 引脚检测：鼠标距离引脚 < `hitRadius`（默认 15px）时返回引脚
- [ ] 元件检测：鼠标在元件矩形内时返回元件 ID（逆序，后添加的优先）
- [ ] 磁吸检测：鼠标距离引脚 < 20px 时，返回吸附后的坐标和引脚引用
- [ ] 综合检测：优先返回引脚，无引脚时返回元件，否则返回 `none`


## Task 3.4：放置元件（Place 模式）

**目标**：从右侧面板点击元件类型，在画布点击位置创建元件。

**具体任务**：

### 3.4.1 PanelManager 触发 Place 模式

修改 `src/ui/PanelManager.ts`：
- 点击元件库条目时，调用 `interactionManager.setMode('place')`
- 将选中的元件类型存入 pending：`{ kind: 'place', type: def.name }`
- 更新光标样式为 `crosshair`

### 3.4.2 Canvas 事件绑定

在 `main.ts` 中绑定 Canvas 鼠标事件：
- `mousedown` → 调用 `interactionManager.handleMouseDown`
- `mousemove` → 调用 `interactionManager.handleMouseMove`
- `mouseup` → 调用 `interactionManager.handleMouseUp`

### 3.4.3 Place 模式逻辑

`InteractionManager.handlePlaceMouseDown`：
1. 检查 `pending.kind === 'place'`
2. 获取鼠标逻辑坐标
3. 计算元件放置位置：`(mouseX - w/2, mouseY - h/2)`
4. 调用 `circuitManager.addComponent(type, x, y)`
5. 自动选中新放置的元件
6. 切换回 Select 模式

**验收标准**：
- [ ] 点击元件库条目 → 光标变为 `crosshair`，进入 Place 模式
- [ ] 点击画布 → 元件出现在点击位置（居中对齐）
- [ ] 新元件自动被选中（显示高亮）
- [ ] 自动回到 Select 模式
- [ ] 按 ESC 取消放置，回到 Select


## Task 3.5：拖拽移动元件（Select 模式）

**目标**：在 Select 模式下，点击并拖拽元件移动位置。

**具体任务**：

`InteractionManager.handleSelectMouseDown`：
1. 检测是否点击到元件（`hitTest` 返回 `component`）
2. 选中该元件
3. 记录拖拽起始位置：`dragStart = { x: logicX, y: logicY, compId }`
4. 光标变为 `grabbing`

`InteractionManager.handleSelectMouseMove`：
1. 如果 `isDragging`，计算偏移量：`dx = logicX - dragStart.x`
2. 更新元件位置：`comp.x += dx; comp.y += dy`
3. 更新 `dragStart` 为当前位置
4. 触发 `circuitManager.onUpdate` 重绘

`InteractionManager.handleSelectMouseUp`：
1. 结束拖拽状态
2. 光标恢复为 `default`

**区分点击与拖拽**：
- 鼠标移动距离 > 5px 视为拖拽
- 移动距离 ≤ 5px 且释放鼠标视为单击（选中元件）

**验收标准**：
- [ ] Select 模式下，点击元件可选中（显示高亮）
- [ ] 按住元件拖动，元件跟随鼠标移动
- [ ] 释放鼠标，元件停在最终位置
- [ ] 鼠标移动距离小于 5px 时视为点击（选中），大于 5px 视为拖拽
- [ ] 点击画布空白取消选中


## Task 3.6：选中高亮（Overlay 层）

**目标**：选中元件时绘制蓝色虚线框 + 四角锚点。

**具体任务**：

在 `CircuitRenderer` 中实现：

```typescript
drawOverlay(circuit: Circuit): void {
  // 层 5：覆盖层
  if (circuit.selectedId !== null) {
    const comp = circuit.components.find(c => c.id === circuit.selectedId);
    if (comp) this.drawSelection(comp);
  }
}

drawSelection(comp: ComponentInstance): void {
  // 1. 蓝色虚线框
  ctx.save();
  ctx.strokeStyle = '#89b4fa';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([4, 4]);
  const pad = 4;
  ctx.strokeRect(comp.x - pad, comp.y - pad, comp.w + pad * 2, comp.h + pad * 2);
  ctx.setLineDash([]);

  // 2. 四角锚点（6×6 实心方块）
  ctx.fillStyle = '#89b4fa';
  const s = 6;
  const corners = [
    [-1, -1], [1, -1], [-1, 1], [1, 1]
  ];
  for (const [cx, cy] of corners) {
    const x = comp.x + (cx === -1 ? 0 : comp.w) - (cx === -1 ? 0 : s) + (cx === 1 ? s : 0);
    const y = comp.y + (cy === -1 ? 0 : comp.h) - (cy === -1 ? 0 : s) + (cy === 1 ? s : 0);
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.restore();
}
```

**验收标准**：
- [ ] 选中元件时，蓝色虚线框显示在元件外围
- [ ] 四角锚点清晰可见
- [ ] 高亮在画布最上层，不被元件遮挡


## Task 3.7：磁吸连线（Wire 模式）

**目标**：实现完整的连线交互，包括引脚高亮、临时导线、磁吸吸附。

**具体任务**：

### 3.7.1 Wire 模式逻辑

`InteractionManager.handleWireMouseDown`：
1. 第一次点击：检测是否点击到引脚
   - 是 → 记录起点 `pending = { kind: 'wire', start: pinRef }`
   - 否 → 取消连线，回到 Select
2. 第二次点击：检测是否点击到引脚
   - 是 → 校验起点 ≠ 终点，调用 `circuitManager.addWire`
   - 否 → 取消连线，回到 Select

`InteractionManager.handleWireMouseMove`：
1. 如果 `pending` 是 Wire 模式，更新临时导线终点
2. 检测磁吸：调用 `snapToNearestPin`，吸附到最近的引脚
3. 更新临时导线预览（虚线 + 终点）

### 3.7.2 临时导线绘制

在 `CircuitRenderer` 中实现：
```typescript
drawTempWire(start: { x: number; y: number }, end: { x: number; y: number }): void {
  ctx.save();
  ctx.strokeStyle = '#a6adc8';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // 终点吸附圈（如果磁吸到引脚，画一个放大圆环）
  ctx.restore();
}
```

### 3.7.3 引脚磁吸视觉反馈

在 `CircuitRenderer.drawOverlay` 中：
- 如果鼠标悬停在引脚上（或磁吸到引脚），绘制高亮圆环
- 放大引脚半径：从 `hitRadius` 变为 `hitRadius + 4`
- 颜色变为亮蓝色 `#89b4fa`

### 3.7.4 连线完成与校验

`CircuitManager.addWire` 校验：
- 起点和终点不能是同一个引脚
- 不能存在重复连线（起点终点相同）
- 起点和终点必须存在

**验收标准**：
- [ ] Wire 模式点击引脚，开始绘制虚线临时导线
- [ ] 鼠标移动，临时导线实时更新
- [ ] 鼠标靠近引脚 < 20px 时，终点吸附到引脚中心
- [ ] 吸附时引脚高亮（放大 + 变色）
- [ ] 点击另一引脚，生成实线连线，回到 Select
- [ ] 点击空白或按 ESC，取消连线，回到 Select
- [ ] 不能连接到同一个引脚
- [ ] 不能创建重复连线


## Task 3.8：键盘快捷键系统

**目标**：支持完整的键盘快捷键操作。

**具体任务**：

在 `main.ts` 或新建 `src/keyboard/KeyboardManager.ts` 中实现：

```typescript
export class KeyboardManager {
  private keys: Set<string> = new Set();

  handleKeyDown(event: KeyboardEvent): void {
    // 忽略输入框
    if (event.target instanceof HTMLInputElement) return;

    switch (event.key) {
      case '1': interaction.setMode('select'); break;
      case '2': interaction.setMode('wire'); break;
      case '3': interaction.setMode('place'); break;
      case 'Escape':
        if (interaction.isPending()) {
          interaction.clearPending();
        } else if (circuitManager.getSelectedId() !== null) {
          circuitManager.selectComponent(null);
        }
        interaction.setMode('select');
        break;
      case 'Delete':
      case 'Backspace':
        const selected = circuitManager.getSelectedId();
        if (selected !== null) circuitManager.removeComponent(selected);
        break;
      case ' ':
        event.preventDefault();
        if (!this.keys.has('Space')) {
          this.keys.add('Space');
          interaction.setMode('pan'); // Phase 3 后续
        }
        break;
    }
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ' && this.keys.has('Space')) {
      this.keys.delete('Space');
      interaction.setMode('select');
    }
  }
}
```

**验收标准**：
- [ ] 按 `1` 切换到 Select 模式，工具栏同步高亮
- [ ] 按 `2` 切换到 Wire 模式
- [ ] 按 `3` 切换到 Place 模式
- [ ] 按 `ESC` 取消当前操作（连线/放置/选中）
- [ ] 按 `Delete` 删除选中元件（含关联连线）
- [ ] 输入框内按键不触发快捷键
- [ ] 按住 `Space` 临时进入 Pan 模式（后续实现，先预留）


## Task 3.9：删除功能（含确认对话框）

**目标**：删除元件时提供安全确认，尤其是涉及多根连线时。

**具体任务**：

### 3.9.1 级联删除确认

当删除元件时，如果该元件关联了 N 根连线：
- N = 0：直接删除
- N > 0：弹出确认对话框（或控制台提示）

```typescript
removeComponent(id: number, confirm?: boolean): void {
  const relatedWires = this.wires.filter(w =>
    w.startComponentId === id || w.endComponentId === id
  );
  if (relatedWires.length > 0 && !confirm) {
    // 触发 UI 确认流程
    this.emit('confirm-delete', { id, relatedWires });
    return;
  }
  // 执行删除...
}
```

### 3.9.2 删除后的 UI 反馈

- 元件从画布消失
- 关联连线消失
- 选中状态清除
- 状态栏更新
- 右侧面板切换回元件库

**验收标准**：
- [ ] 删除无连线元件，直接删除
- [ ] 删除有关联连线元件，提示确认
- [ ] 删除后状态栏正确更新
- [ ] 删除后右侧面板显示元件库


## Task 3.10：交互集成与验收

**目标**：验证所有交互功能协同工作，无冲突。

**具体任务**：

### 3.10.1 事件流程完整性

验证完整的用户操作路径：

| 路径 | 预期行为 |
|------|----------|
| 点击面板元件 → 点击画布 → 选中新元件 | 放置 + 自动选中 |
| 选中元件 → 拖拽 → 释放 | 移动位置 |
| 按 2 → 点击引脚 A → 点击引脚 B | 创建连线 |
| 按 1 → 点击元件 → 按 Delete | 删除元件 |
| 按 ESC → 拖拽过程中取消 | 取消当前操作 |

### 3.10.2 右侧面板与交互联动

- 选中元件 → 面板显示参数（Phase 7 完整实现，先显示占位信息）
- 取消选中 → 面板显示元件库
- 删除元件 → 面板切回元件库
- 放置新元件 → 面板显示该元件参数

### 3.10.3 边界情况处理

| 边界情况 | 处理方式 |
|----------|----------|
| 点击引脚启动连线，中途按 ESC | 取消连线，回到 Select |
| Place 模式下点击引脚 | 不放置元件（只响应画布空白点击） |
| 拖拽元件时经过其他元件 | 拖拽的元件在上层，不影响其他元件 |
| 删除元件时关联连线 | 级联删除或确认 |
| 同一引脚重复连线 | 拒绝（`addWire` 校验） |
| 起点终点是同一元件 | 允许（正常情况） |

**验收标准**：
- [ ] 所有操作路径通过测试
- [ ] 边界情况处理正确
- [ ] 无控制台报错
- [ ] 右侧面板状态正确切换


## Phase 3 验收测试清单

| 编号 | 测试项 | 预期结果 | 状态 |
|------|--------|----------|------|
| T3.1 | 模式切换 | 点击工具栏/快捷键切换模式，按钮高亮同步 | ⬜ |
| T3.2 | 放置元件 | 点击元件库 → 点击画布 → 元件出现并被选中 | ⬜ |
| T3.3 | 拖拽移动 | 选中元件 → 拖动 → 元件跟随移动 | ⬜ |
| T3.4 | 选中高亮 | 点击元件 → 蓝色虚线框 + 四角锚点 | ⬜ |
| T3.5 | 磁吸连线 | Wire 模式点击引脚 → 虚线 → 磁吸到另一引脚 → 生成连线 | ⬜ |
| T3.6 | 键盘快捷键 | 1/2/3/ESC/Delete 正常工作 | ⬜ |
| T3.7 | 删除级联 | 删除元件 → 关联连线自动删除 | ⬜ |
| T3.8 | 右侧面板联动 | 选中/取消选中 → 面板切换 | ⬜ |
| T3.9 | 边界情况 | 重复连线拒绝 / 自连接拒绝 / ESC 取消 | ⬜ |


## 文件结构（Phase 3 新增）

```
src/
├── interaction/
│   └── InteractionManager.ts    # 新增（Task 3.1）
├── manager/
│   └── CircuitManager.ts        # 新增（Task 3.2）
├── keyboard/
│   └── KeyboardManager.ts       # 新增（Task 3.8）
├── utils/
│   ├── coordinates.ts           # 已有（Phase 2）
│   └── hitTest.ts               # 新增（Task 3.3）
├── ui/
│   └── PanelManager.ts          # 修改（Task 3.4）
├── renderer/
│   └── CircuitRenderer.ts       # 修改（Task 3.6 + 3.7）
├── types.ts                     # 修改（新增交互类型）
└── main.ts                      # 修改（事件绑定 + 初始化）
```


## 执行顺序建议

1. **Task 3.1** → 交互模式状态机（基础骨架）
2. **Task 3.2** → CircuitManager（数据管理）
3. **Task 3.3** → 碰撞检测器（依赖 Task 3.1 的模式状态）
4. **Task 3.4** → 放置元件（依赖 Task 3.2 + 3.3）
5. **Task 3.5** → 拖拽移动（依赖 Task 3.2 + 3.3）
6. **Task 3.6** → 选中高亮（依赖 Task 3.2）
7. **Task 3.7** → 磁吸连线（依赖 Task 3.2 + 3.3 + 3.6）
8. **Task 3.8** → 键盘快捷键（依赖 Task 3.1）
9. **Task 3.9** → 删除功能（依赖 Task 3.2）
10. **Task 3.10** → 交互集成验收


## 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 事件监听与 Canvas 渲染冲突 | 频繁重绘导致性能下降 | 使用 `requestAnimationFrame` 节流 |
| 磁吸与拖拽冲突 | 拖拽时误触磁吸 | 拖拽时禁用磁吸（`isDragging === true` 时跳过） |
| 引脚检测与元件检测重叠 | 点击引脚时误选中元件 | 先检测引脚，再检测元件 |
| 右键菜单干扰 | 误触系统右键菜单 | `contextmenu` 事件 `preventDefault()` |
| 输入框内快捷键触发 | 修改参数时误触快捷键 | 检测 `event.target instanceof HTMLInputElement` |