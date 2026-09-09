# Phase 2 完整任务清单

> **前置条件**：Phase 0（Tauri 骨架 + 目录结构）和 Phase 1（ComponentLoader + viewBox 解析 + 注册表）已完成。`__loader` 可用，`src/assets/comps/` 下已有 `led` 和 `resistor` 两个元件定义。

**Phase 2 目标**：在正式 UI 布局中，将 Phase 1 加载的数据渲染到 Canvas 上，形成可查看的静态电路图。


## 任务总览

```
Phase 2 任务依赖关系：

Task 2.1 (UI布局)
    ↓
Task 2.2 (Canvas管理)
    ↓
Task 2.3 (坐标映射工具)
    ↓
Task 2.4 (CircuitRenderer 基础)
    ├── 2.4a 背景层（网格）
    ├── 2.4b 连线层
    ├── 2.4c Fix层
    └── 2.4d Flex层
    ↓
Task 2.5 (Overlay层：选中高亮 + 引脚热区预留)
    ↓
Task 2.6 (集成到 main.ts：测试电路渲染)
    ↓
Task 2.7 (状态栏联动)
    ↓
Task 2.8 (验收测试)
```


## Task 2.1：UI 布局（右侧优先，互斥面板）

**目标**：将 `index.html` 从“控制台占位页”升级为正式 UI 布局，遵循 v1.2 蓝图设计。

**具体任务**：
1. 工具栏（顶部，48px）：
   - 左侧：标题 “⚡ 电路仿真系统”
   - 中间：模式切换按钮组 [选择] [连线] [放置]（当前模式高亮）
   - 右侧：仿真控制 [▶开始] [⏸暂停] [⏹停止] + [🗑清空]
   - 预留：导入/导出按钮（Phase 9 实现）

2. 主内容区：
   - 左侧/中间：Canvas 画布（flex:1，撑满剩余宽度）
   - 右侧：面板容器（固定宽度 240px）

3. 右侧面板（互斥切换）：
   - 默认显示“📦 元件库”（从 ComponentLoader 读取所有元件类型）
   - 每个元件显示为：小图标 + 名称（点击后进入 Place 模式）
   - 当选中元件时，切换为“🔧 参数面板”（动态生成表单）
   - 取消选中时，切回元件库

4. 状态栏（底部，28px）：
   - 元件数 / 连线数 / 仿真状态 / 鼠标坐标

**验收标准**：
- [ ] 窗口打开时显示完整布局（工具栏 + 画布 + 右侧面板 + 状态栏）
- [ ] 右侧面板默认显示元件库，包含 `led` 和 `resistor`
- [ ] 右侧面板不滚动溢出


## Task 2.2：Canvas 管理（尺寸自适应）

**目标**：Canvas 元素随容器大小自动调整，保持绘制清晰。

**具体任务**：
1. 在 `src/renderer/CanvasManager.ts` 中实现：
   - 获取 `#canvas-container` 元素
   - 创建 `<canvas id="circuitCanvas">`
   - `resize()` 方法：读取容器尺寸，设置 `canvas.width` 和 `canvas.height`（考虑 devicePixelRatio）
   - 监听 `ResizeObserver` 或窗口 `resize` 事件
   - 提供 `getContext()` 和 `getSize()` 接口

**验收标准**：
- [ ] Canvas 填满容器，不溢出、不出现滚动条
- [ ] 调整窗口大小时 Canvas 尺寸同步更新
- [ ] Canvas 绘制内容不模糊（正确处理 DPI）


## Task 2.3：坐标映射工具

**目标**：实现屏幕坐标 ↔ Canvas 物理坐标 ↔ 电路逻辑坐标的转换，供 Phase 2 绘制和 Phase 3 交互复用。

**具体任务**：
在 `src/utils/coordinates.ts` 中实现：
- `screenToCanvas(clientX, clientY, canvas)`：屏幕坐标 → Canvas 物理坐标
- `canvasToLogic(canvasX, canvasY, viewport)`：Canvas 物理坐标 → 电路逻辑坐标
- `logicToCanvas(logicX, logicY, viewport)`：电路逻辑坐标 → Canvas 物理坐标

**Phase 2 简化约定**：
- `viewport = { offsetX: 0, offsetY: 0, scale: 1.0 }`
- 逻辑坐标 == Canvas 物理坐标，但函数签名保持完整

**验收标准**：
- [ ] 三个转换函数可导出且类型正确
- [ ] 在 Phase 2 中，逻辑坐标与 Canvas 物理坐标相等


## Task 2.4：CircuitRenderer 分层渲染

**目标**：实现 6 层 Z-Index 渲染管线，当前先实现层 0-3（背景、连线、Fix、Flex），层 4-5 留空为 Phase 3 准备。

**具体任务**：

### 2.4a 背景层（层 0）
- 清空画布（填充深色背景 `#1e1e2e`）
- 绘制浅灰色网格线（`#313244`，线宽 0.5px，间距 20px）

### 2.4b 连线层（层 1）
- 遍历 `circuit.wires`
- 根据 `startComponentId`/`endComponentId` 找到对应元件
- 根据 `startPinId`/`endPinId` 从定义中获取引脚坐标
- 计算引脚世界坐标：`(comp.x + pin.x, comp.y + pin.y)`
- 绘制线段（颜色 `#a6adc8`，线宽 2px，两端带 4px 圆点）

### 2.4c Fix 层（层 2）
- 遍历 `circuit.components`
- 调用 `loader.getFixImage(type)` 获取图片
- 调用 `ctx.drawImage(img, comp.x, comp.y, comp.w, comp.h)`

### 2.4d Flex 层（层 3）
- 遍历 `circuit.components`
- 获取 `def.visual.states[comp.state]`（若 `comp.state` 为空则用 `default_state`）
- 遍历 `def.flex.units` 的所有单元
- 对每个单元：
  - 调用 `loader.getFlexUnit(type, unitId)` 获取缓存（含 offsetX/offsetY）
  - 从 `state.parts[unitId]` 获取控制参数（opacity/color/rotation）
  - 计算绘制位置：`dx = comp.x + offsetX`，`dy = comp.y + offsetY`
  - 保存上下文 → 应用 `globalAlpha`（透明度）→ 应用 `rotate`（旋转）→ 叠加颜色（`globalCompositeOperation = 'source-atop'`）→ 绘制 → 恢复上下文

**验收标准**：
- [ ] 网格正确显示
- [ ] 连线正确连接元件引脚
- [ ] 电阻显示其 fix.svg
- [ ] LED 的 fix.svg 和 flex/body.svg 叠加显示
- [ ] 修改 `comp.state` 为 `'on'` 时，LED 发光体变亮并变为橙色


## Task 2.5：Overlay 层预留（层 4 + 层 5）

**目标**：在渲染管线中预留层 4（临时连线）和层 5（选中高亮 + 引脚热区）的位置，当前为空实现，为 Phase 3 铺路。

**具体任务**：
- 在 `render()` 中，层 3 之后添加：
  - `drawTempWire()`：空实现（注释 “Phase 3 实现”）
  - `drawSelection()`：空实现（注释 “Phase 3 实现”）
  - `drawPinHighlight()`：空实现（注释 “Phase 3 实现”）

**验收标准**：
- [ ] `render()` 调用这些空函数时不报错


## Task 2.6：集成到 main.ts（测试电路渲染）

**目标**：在 `main.ts` 中构造测试电路并渲染到 Canvas。

**具体任务**：
1. 在 `main.ts` 中，`loader.loadAll()` 完成后：
   - 创建 `CircuitRenderer` 实例，传入 `loader`、`canvas`、`viewport`
   - 构造测试电路：
     - LED 元件 1 个（位置 `(200, 200)`，状态 `'off'`，参数 `forward_voltage: 1.8`）
     - 电阻元件 1 个（位置 `(400, 200)`，状态 `'default'`，参数 `resistance: 1000`）
     - 连线 1 条（LED 的 `k` → 电阻的 `p1`）
   - 调用 `renderer.render(testCircuit)`
2. 为测试电路提供状态切换入口（挂载到 `window`）：
   - `window.__toggleLED()`：切换 LED 的 state 为 `'on'` 或 `'off'`，触发重绘
   - 方便开发者在控制台验证 Flex 层效果

**验收标准**：
- [ ] 启动后画布上能看到 1 个 LED（灰色外壳 + 暗淡发光体）和 1 个电阻
- [ ] 两者之间有一条连线
- [ ] 控制台执行 `__toggleLED()` 后 LED 变亮/变暗


## Task 2.7：状态栏联动

**目标**：状态栏实时显示当前电路数据。

**具体任务**：
- 在 `render()` 执行时更新状态栏：
  - `#compCount`：`components.length`
  - `#wireCount`：`wires.length`
  - `#simStatus`：显示“停止”（Phase 5 才会变化）
  - `#cursorPos`：显示当前鼠标位置（鼠标移动时更新）
- 鼠标移动事件绑定到 Canvas，实时更新光标坐标显示

**验收标准**：
- [ ] 状态栏显示正确的元件数和连线数
- [ ] 鼠标在画布上移动时，坐标实时更新


## Task 2.8：验收测试清单

在 Phase 2 完成后，逐项验证：

| 编号 | 测试项 | 预期结果 | 状态 |
|------|--------|----------|------|
| T1 | 应用启动 | 正式 UI 布局显示，无报错 | ⬜ |
| T2 | 右侧面板 | 显示元件库（电阻、LED） | ⬜ |
| T3 | 画布显示 | 网格 + 电阻 + LED + 连线 | ⬜ |
| T4 | LED 亮灭 | `__toggleLED()` 使 LED 发光体变色 | ⬜ |
| T5 | 状态栏 | 元件数=2，连线数=1 | ⬜ |
| T6 | 窗口缩放 | Canvas 自适应，不变形 | ⬜ |


## 文件结构（Phase 2 新增）

```
src/
├── assets/comps/           # 已有（Phase 1）
├── loader/
│   └── ComponentLoader.ts  # 已有（Phase 1）
├── renderer/
│   ├── CanvasManager.ts    # 新增（Task 2.2）
│   ├── CircuitRenderer.ts  # 新增（Task 2.4）
│   └── layers/
│       ├── GridLayer.ts    # 新增（层0）
│       ├── WireLayer.ts    # 新增（层1）
│       ├── FixLayer.ts     # 新增（层2）
│       ├── FlexLayer.ts    # 新增（层3）
│       ├── TempLayer.ts    # 新增（层4，空实现）
│       └── OverlayLayer.ts # 新增（层5，空实现）
├── utils/
│   └── coordinates.ts      # 新增（Task 2.3）
├── types.ts                # 已有（Phase 1）
└── main.ts                 # 修改（Task 2.6）
```


## 执行顺序

1. **Task 2.1** → `index.html` + `styles.css`
2. **Task 2.2** → `CanvasManager.ts`
3. **Task 2.3** → `coordinates.ts`
4. **Task 2.4** → `CircuitRenderer.ts` + 各层文件
5. **Task 2.5** → 预留空函数
6. **Task 2.6** → 修改 `main.ts`
7. **Task 2.7** → 状态栏更新
8. **Task 2.8** → 验收测试