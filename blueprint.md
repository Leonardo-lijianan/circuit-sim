# 电路仿真系统 - v1.1 终极完整施工蓝图

> **v1.1 更新说明**：本次更新在 v1.0 基础上，完整补充了视觉系统规范（`fix.svg` + `flex/*.svg` 多单元方案）、Flex 单元的 `viewBox` 偏移解析机制、多态状态转换（`state_transition` 扩展）、状态联动流程、以及 CompMaker 生态对接规范。所有 v1.0 原有内容全部保留，仅作增量补充与修正。


## 核心设计哲学（v1.1 铁律）

1. **前端全权负责“定义与视觉”**：`comps/` 目录的读取、`meta.json` 解析、SVG 缓存、渲染、状态转换规则，全部由前端完成。Rust **绝不碰任何文件路径或图片数据**。
2. **Rust 只认“数学抽象”**：Rust 不知道“电阻”“LED”是什么。它只接收：`func`(求解器名)、`params`(数值)、以及**构建拓扑必需的引脚连接信息（`pins` 和 `wires`）**。
3. **极简但完整的 IPC 合约**：发给 Rust 的数据**不含任何视觉字段**（无 `x,y` 坐标、无 `icon` 路径、无 `label`），但**必须包含用于图论建模的引脚 ID 和连线关系**。
4. **后台常驻+可休眠 Worker**：Rust 线程空闲时 `0% CPU`，运行时可被控制命令中断。
5. **零硬编码状态**：前端通过 `state_transition` 规则引擎驱动元件视觉切换，没有 `if(type === 'led')`。
6. **视觉与数据彻底分离**：所有视觉定义（`fix.svg` + `flex/*.svg` + `visual.states`）仅存在于前端 `meta.json` 中，Rust 完全不知情。
7. **坐标信息编码在 SVG 中**：`flex/*.svg` 的 `viewBox` 的 `min-x` 和 `min-y` 承载了该单元在 `fix.svg` 坐标系中的偏移量，加载时自动解析，运行时零坐标计算。
8. **状态转换支持多态**：`state_transition` 不仅支持二态（true/false），还支持值映射表（如数码管 0-9）和直接驱动模式。


## 一、项目总览与目标

桌面端电路原理图编辑与仿真工具。

**核心目标**：
- 前端驱动 UI，Rust 纯数学计算。
- 添加新元件：只需在 `comps/` 下新建文件夹（含 `meta.json` + `fix.svg` + `flex/*.svg`），并在 Rust 的 `match` 中新增一个求解函数（如果是全新电气行为）。**无需修改任何前端核心代码**。
- 高频仿真数据通过 `Channel` 推送，低频控制通过 `invoke`。
- 支持 CompMaker 工具导出的标准元件包。


## 二、技术选型（锁定版）

| 层级 | 技术 | 职责 |
| :--- | :--- | :--- |
| 桌面框架 | **Tauri v2** | 提供 `invoke` + `Channel`，异步 `tokio` 运行时。 |
| 前端 | **TypeScript + Vite + Canvas 2D** | 读取 `src/assets/comps/`、渲染、交互、状态机。 |
| Rust 后端 | **纯数学库**（`nalgebra`） | MNA 矩阵求解、牛顿迭代、浮地检测。**无 `std::fs`，无 `comps/` 依赖**。 |
| 通信 | **`invoke` (控制) + `Channel` (结果流)** | 控制指令 < 10Hz；结果推送 30Hz。 |
| 元件加载 | **`import.meta.glob` + `fetch`** | 前端工程化方案，无需 Tauri `fs` 插件。 |


## 三、总体架构分层图（v1.1 最终版）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        前端 UI 层 (TypeScript)                             │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ 元件抽屉    │ │ 画布交互   │ │ 参数面板     │ │ 工具栏              │ │
│  │ (comps/ 加载)│ │ (拖拽/连线)│ │ (动态表单)   │ │ (仿真控制/导入导出) │ │
│  └────────────┘ └────────────┘ └──────────────┘ └──────────────────────┘ │
│        │              │              │                    │                │
│        └──────────────┴──────────────┴────────────────────┘                │
│                                    │                                        │
│                          ┌─────────▼─────────┐                             │
│                          │  ComponentLoader  │                             │
│                          │  - 加载 meta.json │                             │
│                          │  - 解析 viewBox   │                             │
│                          │  - 缓存 SVG 图片  │                             │
│                          │  - 构建注册表     │                             │
│                          └─────────┬─────────┘                             │
│                                    │                                        │
│                          ┌─────────▼─────────┐                             │
│                          │  CircuitManager   │                             │
│                          │  - 维护电路数据   │                             │
│                          │  - 提取 SolverInput│                            │
│                          │  - 接收 Channel   │                             │
│                          │  - 应用状态转换   │                             │
│                          └─────────┬─────────┘                             │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
          ┌──────────────────────────┴──────────────────────────┐
          │  invoke (控制/更新)                                │ Channel (结果推送)
          ▼                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Rust 后台常驻 Worker (纯计算)                           │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  事件循环 (tokio::select!)                                          │  │
│  │  - IDLE/STOPPED: 阻塞于 recv()  →  0% CPU                         │  │
│  │  - PAUSED: 阻塞等待恢复信号  →  0% CPU                             │  │
│  │  - RUNNING: 每 10ms 定时唤醒 → 求解 → 继续休眠                     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│  ┌─────────────────────────────────▼────────────────────────────────────┐  │
│  │  求解器核心 (无 IO，无文件)                                         │  │
│  │  输入: SolverInput { func, params, pins, wires }                   │  │
│  │  1. 查 match 表获取求解函数 (ohm/diode/switch/...)                │  │
│  │  2. 构建图 (基于 wires 和 pins)                                   │  │
│  │  3. 浮地检测 (孤立子图检查)                                        │  │
│  │  4. 填充 MNA 矩阵 (线性 + 非线性牛顿)                              │  │
│  │  5. 返回 SolverOutput { id, voltage, current, power }              │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```


## 四、核心数据模型（v1.1 完整版）

### 4.1 元件目录结构（最终确定）

```
src/assets/comps/
└── {type}/
    ├── meta.json              # 元件定义（核心）
    ├── fix.svg                # 固定层（必须）
    └── flex/                  # 动态层目录（可选）
        ├── {unit_a}.svg       # 单元 A（如 seg_a）
        ├── {unit_b}.svg       # 单元 B（如 seg_b）
        └── ...                # 更多单元
```

**目录规则**：
- `{type}`：元件类型标识符，仅限小写字母、数字、下划线（`[a-z0-9_]+`）。
- `fix.svg`：**必须存在**，绘制元件的固定部分（外壳、引脚、底座）。
- `flex/`：**可选**，当元件有动态变化时才需要。每个 `{unit}.svg` 代表一个“最小变换单元”。
- 如果元件没有任何动态变化（如普通电阻、芯片），则 `flex/` 目录可以完全省略。

### 4.2 前端完整定义（来自 `src/assets/comps/*/meta.json`）

```typescript
// ===== 固定层 =====
interface FixLayer {
  file: "fix.svg";              // 固定文件名（固定）
}

// ===== 动态层（Flex 单元） =====
interface FlexUnitDefinition {
  file: string;                 // flex/{unitId}.svg
  // offsetX/offsetY 由加载器从 SVG viewBox 的 min-x/min-y 自动解析
  // 无需在 meta.json 中声明
}

interface FlexLayer {
  units: Record<string, FlexUnitDefinition>;  // 单元 ID → 文件路径
}

// ===== 引脚定义 =====
interface PinDefinition {
  id: string;                   // 如 "p1" 或 "a"
  x: number;                    // 在 fix.svg 坐标系中的 X 坐标
  y: number;                    // 在 fix.svg 坐标系中的 Y 坐标
  label?: string;               // 如 "+"、"-"、"A"
  type?: 'passive' | 'input' | 'output' | 'bidirectional';
  hitRadius?: number;           // 磁吸/点击半径（默认 15px）
}

// ===== 参数定义 =====
interface ParamDefinition {
  id: string;                   // 如 "resistance"
  label: string;                // 如 "阻值 (Ω)"
  type: 'number' | 'string' | 'boolean' | 'select';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];           // 用于 select 类型
}

// ===== 视觉状态 =====
interface VisualState {
  // 每个部件（flex 单元）的控制参数
  parts: Record<string, {
    opacity?: number;           // 透明度 0~1
    color?: string;             // 颜色滤镜（十六进制 #RRGGBB）
    rotation?: number;          // 旋转角度（度），绕该单元自身中心
    offsetX?: number;           // X 轴偏移（逻辑像素）
    offsetY?: number;           // Y 轴偏移（逻辑像素）
  }>;
}

interface VisualDefinition {
  states: Record<string, VisualState>;  // 状态名 → 视觉参数
  default_state?: string;               // 默认状态名（默认 "default"）
}

// ===== 电气模型 =====
interface ModelDefinition {
  func: string;                 // 求解器函数名，如 "ohm"、"diode"、"switch"
  paramMap: Record<string, string>;  // 参数映射，如 { "R": "resistance" }
}

// ===== 状态转换规则（多态） =====
type StateTransition =
  // 模式1：二态判断（用于 LED、开关等）
  | {
      type: 'binary';
      condition: string;        // 表达式，如 "electrical.current > 0.001"
      true_state: string;       // 满足时切换到的状态
      false_state: string;      // 不满足时切换到的状态
    }
  // 模式2：值映射表（用于数码管等）
  | {
      type: 'map';
      source: string;           // 从 electrical 中取值的字段名，如 "digit"
      mapping: Record<string, string>;  // 值 → 状态名，如 { "0": "digit_0", "1": "digit_1" }
      default_state?: string;   // 未匹配时的默认状态
    }
  // 模式3：直接驱动（用于点阵屏、自定义显示等）
  | {
      type: 'direct_drive';
      parts: Record<string, string>;  // 部件 ID → 数据源字段名
    };

// ===== 完整定义 =====
interface ComponentDefinition {
  // ---- 标识 ----
  name: string;                 // 类型标识符，如 "resistor"
  label: string;                // 显示名称，如 "电阻"
  schemaVersion?: string;       // 新增：Schema 版本控制，当前 "1.0"
  
  // ---- 固定层 ----
  fix: FixLayer;
  
  // ---- 动态层（可选） ----
  flex?: FlexLayer;
  
  // ---- 引脚 ----
  pins: PinDefinition[];
  
  // ---- 用户参数 ----
  params: ParamDefinition[];
  
  // ---- 视觉定义 ----
  visual: VisualDefinition;
  
  // ---- 电气模型 ----
  model: ModelDefinition;
  
  // ---- 状态转换规则 ----
  state_transition?: StateTransition;
  
  // ---- 元数据（可选） ----
  metadata?: Record<string, any>;
}
```

### 4.3 Flex 单元的 viewBox 规范（关键）

**所有 `flex/*.svg` 文件必须遵循以下规则**：

1. **必须定义 `viewBox`**：格式为 `"min-x min-y width height"`。
2. **`min-x` 和 `min-y`**：表示该单元在 `fix.svg` 坐标系中的偏移量。渲染时，单元图片的左上角将被放置在 `(comp.x + min-x, comp.y + min-y)` 位置。
3. **`width` 和 `height`**：表示该单元本身的尺寸。渲染时，该单元将按此尺寸绘制。
4. **坐标系一致性**：所有 `flex/*.svg` 使用与 `fix.svg` **相同的坐标空间**（即单位长度一致）。

**示例**：
```
fix.svg:                 viewBox="0 0 100 100"
flex/seg_a.svg:          viewBox="20 10 40 15"
                         ↑↑↑↑  ↑↑↑↑
                         min-x  min-y
                         该段左上角在 fix 坐标系的 (20, 10) 处
                         该段自身宽 40，高 15
```

**加载器行为**：
- 加载 `flex/*.svg` 时，解析其 `viewBox` 属性。
- 提取 `min-x` 作为 `offsetX`，`min-y` 作为 `offsetY`。
- 将 `offsetX`/`offsetY` 与图片对象一起存入注册表。
- **运行时渲染直接使用预解析的偏移量，无需再次解析 SVG**。

### 4.4 前端 → Rust 的极简负载（IPC 合约）

```typescript
// 发给 Rust 的元件描述（不含视觉，不含坐标）
interface SolverComponent {
  id: number;                    // 实例 ID
  func: string;                  // 求解器名，如 "ohm"
  params: Record<string, number | boolean>; // 解析后的数值
  pins: { id: string }[];        // ★ 必须！用于图论节点编号
}

// 连线描述
interface SolverWire {
  start: { componentId: number; pinId: string };
  end: { componentId: number; pinId: string };
}

// 完整求解输入
interface SolverInput {
  analysis: {
    type: 'dc' | 'ac' | 'transient';
    time_step?: number;
    final_time?: number;
    freq?: number;
  };
  components: SolverComponent[];
  wires: SolverWire[];
  // ★ 没有 visual，没有 label，没有 SVG 路径，没有 x/y 坐标
}
```

### 4.5 Rust → 前端的输出

```typescript
interface SolverOutput {
  componentId: number;
  voltage: number;   // 两端压降 (V)
  current: number;   // 流过电流 (A)
  power: number;     // 功率 (W)
  nodeVoltages?: Record<string, number>; // 可选，对地电压
}[]
```


## 五、前端核心模块（TypeScript）

### 5.1 元件加载器（ComponentLoader）

```typescript
class ComponentLoader {
  private registry = new Map<string, ComponentDefinition>();
  private imageCache = new Map<string, HTMLImageElement>();
  private flexUnitCache = new Map<string, { img: HTMLImageElement; offsetX: number; offsetY: number }>();

  async loadAll() {
    // 1. 使用 Vite 的 import.meta.glob 扫描所有 meta.json
    const metaModules = import.meta.glob('/src/assets/comps/*/meta.json', {
      eager: true,
      as: 'raw'
    });

    for (const [path, content] of Object.entries(metaModules)) {
      try {
        const def: ComponentDefinition = JSON.parse(content as string);
        await this.loadComponent(def);
      } catch (err) {
        console.error(`❌ 加载 ${path} 失败:`, err);
      }
    }
  }

  private async loadComponent(def: ComponentDefinition) {
    // 1. 校验必填字段
    if (!def.name || !def.label || !def.fix) {
      console.warn(`⚠️ 元件 ${def.name || '未命名'} 缺少必填字段，跳过`);
      return;
    }

    // 2. 加载 fix.svg
    const fixPath = `/src/assets/comps/${def.name}/fix.svg`;
    await this.loadImage(fixPath);

    // 3. 加载 flex 单元（如果有）
    if (def.flex) {
      for (const [unitId, unitDef] of Object.entries(def.flex.units)) {
        const flexPath = `/src/assets/comps/${def.name}/${unitDef.file}`;
        await this.loadFlexUnit(flexPath, unitId);
      }
    }

    // 4. 存入注册表
    this.registry.set(def.name, def);
    console.log(`  ✅ 加载元件: ${def.label} (${def.name})`);
  }

  private async loadFlexUnit(path: string, unitId: string) {
    // 1. 获取 SVG 文本内容
    const response = await fetch(path);
    const svgText = await response.text();

    // 2. 解析 viewBox
    const viewBoxMatch = svgText.match(/viewBox=["']([^"']*)["']/);
    if (!viewBoxMatch) {
      console.warn(`⚠️ ${path} 缺少 viewBox，跳过`);
      return;
    }
    const [minX, minY, width, height] = viewBoxMatch[1].split(/[\s,]+/).map(Number);

    // 3. 加载为图片
    const img = await this.loadImage(path);

    // 4. 缓存，附带偏移量
    this.flexUnitCache.set(path, { img, offsetX: minX, offsetY: minY });
  }

  // ---- 对外接口 ----
  getDefinition(type: string): ComponentDefinition | undefined {
    return this.registry.get(type);
  }

  getAllTypes(): string[] {
    return Array.from(this.registry.keys());
  }

  getFixImage(type: string): HTMLImageElement | undefined {
    return this.imageCache.get(`/src/assets/comps/${type}/fix.svg`);
  }

  getFlexUnit(type: string, unitId: string): { img: HTMLImageElement; offsetX: number; offsetY: number } | undefined {
    const def = this.registry.get(type);
    if (!def?.flex?.units?.[unitId]) return undefined;
    const path = `/src/assets/comps/${type}/${def.flex.units[unitId].file}`;
    return this.flexUnitCache.get(path);
  }

  // 提取 SolverComponent（剥离所有视觉字段）
  extractSolverComponent(instance: ComponentInstance): SolverComponent {
    const def = this.registry.get(instance.type)!;
    const params: Record<string, number | boolean> = {};
    for (const [rustKey, uiKey] of Object.entries(def.model.paramMap)) {
      params[rustKey] = instance.params[uiKey];
    }
    return {
      id: instance.id,
      func: def.model.func,
      params,
      pins: def.pins.map(p => ({ id: p.id })),
    };
  }
}
```

### 5.2 状态转换规则引擎（多态支持）

```typescript
class StateTransitionEngine {
  evaluate(
    rule: StateTransition,
    electrical: { voltage: number; current: number; power: number; [key: string]: any }
  ): string | Record<string, { opacity?: number; color?: string }> {
    switch (rule.type) {
      case 'binary': {
        const fn = new Function('electrical', `return ${rule.condition};`);
        return fn(electrical) ? rule.true_state : rule.false_state;
      }

      case 'map': {
        const value = electrical[rule.source];
        return rule.mapping[String(value)] || rule.default_state || 'default';
      }

      case 'direct_drive': {
        // 直接返回各部件的数据
        const parts: Record<string, { opacity?: number; color?: string }> = {};
        for (const [partId, sourceField] of Object.entries(rule.parts)) {
          const value = electrical[sourceField];
          if (value !== undefined) {
            parts[partId] = { opacity: typeof value === 'number' ? value : 1 };
          }
        }
        return parts;
      }

      default:
        return 'default';
    }
  }
}
```

### 5.3 状态联动完整流程

```typescript
// CircuitManager 中
private applySimulationResults(results: SolverOutput[]) {
  for (const res of results) {
    const comp = this.store.getComponent(res.id);
    if (!comp) continue;

    // 1. 写入电气数值
    comp.electrical = res;

    // 2. 获取状态转换规则
    const def = this.loader.getDefinition(comp.type);
    if (!def?.state_transition) continue;

    // 3. 执行状态转换
    const result = this.engine.evaluate(def.state_transition, comp.electrical);

    // 4. 应用结果
    if (typeof result === 'string') {
      // 模式1/2：返回状态名
      comp.state = result;
    } else if (typeof result === 'object') {
      // 模式3：直接驱动部件
      // 将 parts 控制参数合并到 visual.states 中
      comp.directParts = result;
    }
  }

  // 5. 触发重绘
  this.renderer.render();
}
```

### 5.4 前端发送极简负载给 Rust

```typescript
// CircuitManager 中
private buildSolverInput(): SolverInput {
  return {
    analysis: { type: 'dc' },
    components: this.store.components.map(c => 
      this.loader.extractSolverComponent(c)
    ),
    wires: this.store.wires.map(w => ({
      start: { componentId: w.startComponentId, pinId: w.startPinId },
      end: { componentId: w.endComponentId, pinId: w.endPinId },
    })),
  };
}
```


## 六、Rust 仿真内核（纯数学，无文件 IO）

### 6.1 求解器注册表（硬编码 `match`）

```rust
// src-tauri/src/solver/registry.rs
pub type SolverFn = fn(&SolverComponent, &CircuitContext) -> EquationContribution;

pub fn get_solver(func: &str) -> Option<SolverFn> {
    match func {
        "ohm" => Some(ohm_solver),
        "diode" => Some(diode_solver),
        "switch" => Some(switch_solver),
        "voltage_source" => Some(voltage_source_solver),
        "current_source" => Some(current_source_solver),
        _ => None, // 前端传了未实现的 func，返回错误
    }
}

fn ohm_solver(comp: &SolverComponent, _ctx: &CircuitContext) -> EquationContribution {
    let r = comp.params.get("R").unwrap_or(&1000.0);
    EquationContribution::LinearResistor { conductance: 1.0 / r }
}
// 二极管、开关等类似...
```

### 6.2 常驻 Worker 事件循环（保留可休眠）

```rust
// src-tauri/src/worker/mod.rs
pub enum SolverCommand {
    Start,
    Pause,
    Stop,
    UpdateInput(SolverInput),
    Shutdown,
}

pub async fn run_worker(
    mut cmd_rx: mpsc::UnboundedReceiver<SolverCommand>,
    result_tx: tauri::ipc::Channel<SolverOutput>,
) {
    let mut state = WorkerState::Idle;
    let mut current_input: Option<SolverInput> = None;

    loop {
        match state {
            WorkerState::Idle | WorkerState::Stopped => {
                // ★ 休眠：0% CPU
                if let Some(cmd) = cmd_rx.recv().await {
                    match cmd {
                        SolverCommand::Start if current_input.is_some() => state = WorkerState::Running,
                        SolverCommand::UpdateInput(input) => current_input = Some(input),
                        SolverCommand::Shutdown => break,
                        _ => {}
                    }
                }
            }
            WorkerState::Running => {
                tokio::select! {
                    _ = sleep(Duration::from_millis(10)) => {
                        if let Some(input) = &current_input {
                            if let Ok(output) = SolverCore::solve(input).await {
                                let _ = result_tx.send(output);
                            }
                        }
                    }
                    cmd = cmd_rx.recv() => {
                        if let Some(cmd) = cmd {
                            match cmd {
                                SolverCommand::Pause => state = WorkerState::Paused,
                                SolverCommand::Stop => state = WorkerState::Stopped,
                                SolverCommand::UpdateInput(input) => current_input = Some(input),
                                SolverCommand::Shutdown => break,
                                _ => {}
                            }
                        }
                    }
                }
            }
            WorkerState::Paused => {
                // ★ 暂停休眠
                tokio::select! {
                    _ = sleep(Duration::from_secs(u64::MAX)) => unreachable!(),
                    cmd = cmd_rx.recv() => {
                        if let Some(cmd) = cmd {
                            match cmd {
                                SolverCommand::Start => state = WorkerState::Running,
                                SolverCommand::Stop => state = WorkerState::Stopped,
                                SolverCommand::UpdateInput(input) => current_input = Some(input),
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }
}
```

### 6.3 求解核心：图构建 + MNA + 浮地检测

```rust
// src-tauri/src/solver/core.rs
impl SolverCore {
    pub fn solve(input: &SolverInput) -> Result<Vec<SolverOutput>, SolverError> {
        // 1. 构建图 (基于 wires 和 components 的 pins)
        let graph = GraphBuilder::build(input)?;
        
        // 2. 浮地检测：检查是否存在不包含地的孤立子图
        if let Some(floating_nodes) = graph.detect_floating_subcircuits() {
            return Err(SolverError::FloatingSubcircuit(floating_nodes));
        }
        
        // 3. 填充 MNA 矩阵（线性部分）
        let (mut A, mut b) = MatrixBuilder::build(input, &graph)?;
        
        // 4. 检查非线性元件
        let has_nonlinear = input.components.iter().any(|c| 
            matches!(c.func, "diode" | "transistor")
        );
        
        let solution = if has_nonlinear {
            NonlinearSolver::newton(&mut A, &mut b, input, &graph, 1e-6, 100)?
        } else {
            A.lu().solve(&b).ok_or(SolverError::SingularMatrix)?
        };
        
        // 5. 提取结果
        Ok(ResultExtractor::extract(&solution, input, &graph))
    }
}
```

**关键点**：`GraphBuilder` 利用 `SolverComponent.pins` 和 `SolverWire` 建立节点映射，完全不依赖坐标。


## 七、通信协议总结（v1.1 最终版）

| 操作 | 方向 | 方式 | 数据内容 | 大小 | 频率 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 加载 `comps/` 清单 | 前端本地 | `import.meta.glob` | JSON 文本 | ~10KB | 启动时 1 次 |
| 加载 `fix.svg` | 前端本地 | `fetch` + `Image` | SVG 图片 | ~5-50KB | 启动时 1 次 |
| 加载 `flex/*.svg` | 前端本地 | `fetch` + `Image` | SVG 图片 + viewBox 解析 | ~2-20KB/个 | 启动时 N 次 |
| 启动/暂停/停止 | 前端 → Rust | `invoke` | `{ cmd: "Start" }` | < 100B | < 10Hz |
| 更新电路参数 | 前端 → Rust | `invoke` | `SolverInput` (含拓扑+数值) | ~2KB | 按需（参数变化时） |
| 推送求解结果 | Rust → 前端 | `Channel` | `SolverOutput[]` (数值数组) | ~1KB | 30Hz |


## 八、状态转换与视觉联动完整流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        仿真开始                                 │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Rust 求解器返回 SolverOutput[]                                │
│  { componentId, voltage, current, power, nodeVoltages }        │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  CircuitManager.applySimulationResults()                      │
│  1. 将电气数值写入 comp.electrical                            │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  检查是否有 state_transition？                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  type: 'binary'  → 计算 condition 表达式               │ │
│  │                   → true_state 或 false_state           │ │
│  │  type: 'map'     → 查 electrical[source]                │ │
│  │                   → mapping[value] 或 default_state     │ │
│  │  type: 'direct_drive' → 直接映射到 parts               │ │
│  └───────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  更新 comp.state = 'on' 或 comp.directParts = { ... }         │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  渲染引擎读取 comp.state 或 comp.directParts                  │
│  1. 根据 state 查找 visual.states[state]                      │
│  2. 读取 parts 中各单元的 opacity/color/rotation/offset       │
│  3. 叠加 directParts（如果存在）                              │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Canvas 渲染                                                  │
│  1. 先画 fix.svg（整张绘制）                                 │
│  2. 对 flex 中每个单元：                                      │
│     a. 应用透明度 (globalAlpha)                              │
│     b. 叠加颜色 (globalCompositeOperation)                   │
│     c. 应用旋转/位移 (translate + rotate)                    │
│     d. drawImage 绘制（使用预解析的 offsetX/offsetY）        │
└─────────────────────────────────────────────────────────────────┘
```


## 九、CompMaker 生态对接规范

### 9.1 导出格式标准

CompMaker 导出的元件包必须符合以下目录结构：

```
{type}/
├── meta.json              # 必须，符合 ComponentDefinition Schema
├── fix.svg                # 必须，viewBox 可自定义
└── flex/                  # 可选，有动态元件时才需要
    ├── {unit_a}.svg       # viewBox 必须包含 min-x/min-y 偏移
    ├── {unit_b}.svg
    └── ...
```

### 9.2 CompMaker 导出约束

| 约束项 | 规则 |
| :--- | :--- |
| **`meta.json` 中的 `name`** | 必须与文件夹名一致 |
| **`fix.svg` 的 `viewBox`** | 定义了元件的整体坐标系，所有 flex 单元基于此坐标系定位 |
| **`flex/*.svg` 的 `viewBox`** | `min-x` 和 `min-y` 表示该单元在 fix 坐标系中的偏移量，由 CompMaker 自动计算并写入 |
| **`flex/*.svg` 的图形内容** | 只包含该单元自身的图形（在 `viewBox` 范围内），不包含外壳或引脚 |
| **`visual.states` 中的 `parts`** | 引用的 `unitId` 必须在 `flex.units` 中有定义 |
| **`state_transition` 中的 `mapping`** | 所有 value 的类型必须一致（如全部为数字或全部为字符串） |

### 9.3 Schema 版本控制

`meta.json` 中应包含 `schemaVersion` 字段，当前版本为 `"1.0"`：

```json
{
  "schemaVersion": "1.0",
  "name": "seven_segment",
  "label": "7段数码管",
  ...
}
```

未来如果引入不兼容的变更，则提升版本号（如 `"2.0"`），程序可根据版本号选择不同的解析策略。


## 十、开发路线图（v1.1 更新版）

| 阶段 | 任务 | 涉及方 | 产出 | v1.1 新增内容 |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 0** | Tauri v2 骨架 + Vite 配置 + 目录结构 | 前后端 | 空白窗口，`src/assets/comps/` 就绪 | 确认 `src/assets/comps/` 为最终路径 |
| **Phase 1** | **前端 `comps/` 加载器** + viewBox 解析 + 注册表构建 | 纯前端 | 注册表含完整视觉定义、Flex 偏移 | **新增：viewBox 解析、flex 单元缓存、多态 state_transition 类型定义** |
| **Phase 2** | 前端 Canvas 基础渲染（fix + flex 分层绘制） | 纯前端 | 静态电路图显示 | **新增：flex 单元叠加绘制、偏移量应用** |
| **Phase 3** | 前端交互（拖拽放置、磁吸连线、选中高亮） | 纯前端 | 可编辑电路图 | — |
| **Phase 4** | **Rust 纯数学求解器**（线性 + 非线性 + 浮地检测）+ 单元测试 | 纯后端 | `cargo test` 通过 | — |
| **Phase 5** | **实现常驻 Worker**（`select!` 休眠/唤醒）+ `invoke` + `Channel` 联调 | 前后端 | 发送 `SolverInput` 并接收结果 | — |
| **Phase 6** | 前端集成状态转换规则引擎（多态支持） | 纯前端 | 数码管显示数字、LED 自动亮灭 | **新增：map 和 direct_drive 模式支持** |
| **Phase 7** | 参数面板动态生成 + 热更新 | 前后端 | 改阻值实时重算 | — |
| **Phase 8** | AC/Transient 求解器 + 电流粒子动画 | 前后端 | 高级仿真 | — |
| **Phase 9** | 浮地高亮、JSON 导入导出、性能优化 | 前后端 | 最终发布版 | **新增：CompMaker 导出包导入支持** |


## 十一、总结：v1.1 相比 v1.0 的补充内容

| 补充项 | 说明 |
| :--- | :--- |
| **`fix.svg` + `flex/*.svg` 视觉系统** | 完整定义了固定层与多单元动态层的文件结构、坐标系规范、加载流程 |
| **Flex 单元 viewBox 偏移解析机制** | 明确了 `viewBox` 的 `min-x`/`min-y` 承载偏移量，加载时自动解析，运行时零坐标计算 |
| **多态状态转换（`state_transition`）** | 扩展为三种模式：`binary`（二态）、`map`（值映射）、`direct_drive`（直接驱动部件），覆盖所有元件类型 |
| **状态联动完整流程** | 补充了从仿真结果 → 状态转换 → 视觉状态 → Canvas 渲染的完整数据流图 |
| **CompMaker 生态对接规范** | 增加了导出格式标准、约束规则、Schema 版本控制，为工具链奠定基础 |
| **目录路径统一** | 明确所有元件定义位于 `src/assets/comps/`，使用 `import.meta.glob` + `fetch` 加载 |
| **Phase 1 任务细化** | 增加了 viewBox 解析、flex 单元缓存、多态状态转换类型定义等具体任务 |

**v1.1 做到了**：
- 前端该做的（视觉、交互、文件读取、SVG 解析）一点不少。
- Rust 该做的（矩阵求解、拓扑建模、浮地检测）样样齐全。
- 通信数据量最小化，职责边界清晰。
- 视觉系统完整可施工，CompMaker 可对接。
- 状态转换覆盖所有元件类型（LED、开关、数码管、点阵屏等）。