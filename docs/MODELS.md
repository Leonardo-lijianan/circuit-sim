# 电路仿真模型规范 (MODELS)

> 本文档定义仿真引擎的电气模型 API
>
> 每个模型（Model）是一段封装好的电气行为逻辑，可被任意数量的元件（Component）复用。
> 元件通过 meta.json 的 model.func 字段引用模型。

---

## 一、概念层次

```
Instance（实例）
  ↓ 引用
Component（元件，comps/ 下的文件夹）
  ↓ 引用
Model（模型，Rust 代码里的 func）
```

| 层 | 位置 | 职责 | 谁定义 |
|:---|:---|:---|:---|
| Instance | 画布上的实例数据 | 具体参数值、位置、状态 | 用户操作 |
| Component | comps/ | 视觉(SVG)、引脚、UI 参数、引用 Model | 元件设计者（CompMaker） |
| Model | Rust solver/ 代码 | 电气行为、MNA 贡献、结果提取 | Rust 开发者 |

**核心原则**：
- 一个 Model 可服务上百个 Component
- 加新元件（如不同颜色的 LED）**不需要改 Rust 代码**
- 加新 Model（如运放）需要 Rust 开发

---

## 二、现有模型总览

| func | 中文名 | 端数 | 极性 | 参数 | 状态 |
|:---|:---|:---:|:---:|:---|:---:|
| ohm | 电阻 | 2 | 无 | R | 已实现 |
| voltage_source | 电压源 | 2 | 有 | V | 已实现 |
| current_source | 电流源 | 2 | 有 | I | 已实现 |
| diode | 二极管 | 2 | 有 | Vf, Ron | 已实现 |
| switch | 开关 | 2 | 无 | closed, Ron, Roff | 已实现 |
| ground | 参考地 | 1 | 特殊 | 无 | 已实现 |

---

## 三、模型详细规范

### 3.1 ohm — 电阻

**语义**：理想线性电阻，满足欧姆定律 V = I·R。

**引脚要求**：任意 2 个引脚，pins[0] = 正端，pins[1] = 负端。电流从 pins[0] 流入、从 pins[1] 流出（关联参考方向）。

**参数表**：

| 参数名 | 类型 | 默认值 | 单位 | 范围 | 说明 |
|:---|:---|:---:|:---:|:---|:---|
| R | number | 1000 | Ω | > 0 | 阻值 |

**MNA 贡献**（节点 a = pins[0]，节点 b = pins[1]）：

```
G = 1/R
A[a][a] += G;  A[b][b] += G
A[a][b] -= G;  A[b][a] -= G
```

**结果提取**：I = V / R

**meta.json 示例**：

```json
{
  "model": {
    "func": "ohm",
    "paramMap": { "R": "resistance" }
  },
  "params": [
    { "id": "resistance", "label": "阻值 (Ω)", "type": "number", "default": 1000 }
  ]
}
```

---

### 3.2 voltage_source — 电压源

**语义**：理想电压源，强制 V_pos - V_neg = V，电流由外部电路决定。

**引脚要求**：必须有 id 为 pos 的引脚（正端）和 id 为 neg 的引脚（负端）。引脚顺序无关，按 id 查找。

**参数表**：

| 参数名 | 类型 | 默认值 | 单位 | 说明 |
|:---|:---|:---:|:---:|:---|
| V | number | 无（必须提供） | V | 电动势 |

**MNA 贡献**：引入额外未知量 I_k（从外部流入 pos 端的电流）。

```
约束行 k:  V_pos - V_neg = V
KCL 列 k:  A[pos][k] += 1;  A[neg][k] -= 1
```

**结果提取**：I = x[k]（放电时为负），P = V·I（放电时为负）

**meta.json 示例**（电池）：

```json
{
  "model": {
    "func": "voltage_source",
    "paramMap": { "V": "voltage" }
  },
  "pins": [
    { "id": "neg", "x": 0,  "y": 20 },
    { "id": "pos", "x": 60, "y": 20 }
  ],
  "params": [
    { "id": "voltage", "label": "电压 (V)", "type": "number", "default": 1.5 }
  ]
}
```

---

### 3.3 current_source — 电流源

**语义**：理想电流源，强制从 pins[0] 流出电流 I，从 pins[1] 流入。

**参数表**：

| 参数名 | 类型 | 默认值 | 单位 | 说明 |
|:---|:---|:---:|:---:|:---|
| I | number | 无（必须提供） | A | 输出电流 |

**MNA 贡献**：B[a] += I; B[b] -= I

**结果提取**：I = -param（关联参考方向电流）

---

### 3.4 diode — 二极管（分段线性模型）

**语义**：单向导通。V < Vf 时近似断路；V ≥ Vf 时线性导通。

**引脚要求**：必须有 id 为 a 的引脚（阳极）和 id 为 k 的引脚（阴极）。正向偏置 V_a - V_k > 0。

**参数表**：

| 参数名 | 类型 | 默认值 | 单位 | 说明 |
|:---|:---|:---:|:---:|:---|
| Vf | number | 0.7 | V | 正向压降（LED 通常 1.8~3.3V） |
| Ron | number | 10 | Ω | 导通后内阻（LED 通常 50~500Ω） |

**内部常量**（不可配置）：Gmin = 1e-9 S（关断时极小电导，避免矩阵奇异）

**MNA 贡献**（非线性，用 v_guess 决定工作点）：

```
关断 (V < Vf):   G = Gmin
导通 (V >= Vf):  G = 1/Ron
                 B[a] += Vf/Ron;  B[b] -= Vf/Ron
```

**结果提取**：

```
V < Vf:  I = Gmin · V
V >= Vf: I = (V - Vf) / Ron
```

**meta.json 示例**（LED）：

```json
{
  "model": {
    "func": "diode",
    "paramMap": { "Vf": "forward_voltage" }
  },
  "pins": [
    { "id": "a", "x": 0,  "y": 20 },
    { "id": "k", "x": 60, "y": 20 }
  ],
  "params": [
    { "id": "forward_voltage", "label": "正向压降 (V)", "type": "number", "default": 1.8 }
  ]
}
```

---

### 3.5 switch — 开关

**语义**：可控通断的电阻。闭合时近似短路，断开时近似断路。

**引脚要求**：任意 2 个引脚，无极性。

**参数表**：

| 参数名 | 类型 | 默认值 | 单位 | 说明 |
|:---|:---|:---:|:---:|:---|
| closed | boolean | false | — | true = 闭合，false = 断开 |
| Ron | number | 0.01 | Ω | 闭合时导通电阻 |
| Roff | number | 1e9 | Ω | 断开时漏电阻 |

**MNA 贡献**：

```
G = closed ? 1/Ron : 1/Roff
A[a][a] += G;  A[b][b] += G
A[a][b] -= G;  A[b][a] -= G
```

**结果提取**：I = V / (closed ? Ron : Roff)

**前端交互**：Select 模式下选中开关 → 按空格键切换 closed

---

### 3.6 ground — 参考地

**语义**：不产生任何方程，仅标记一个节点为参考电位（0V）。

**引脚要求**：任意 1 个引脚；该引脚所在节点被标记为地节点。

**参数**：无

**MNA 贡献**：无（节点从矩阵中消去）

**结果提取**：返回 V=0, I=0, P=0

**地节点确定规则**（graph_builder 实现）：

每个连通分量独立确定参考地：
1. 优先：分量内的 GND 元件引脚
2. 次选：分量内第一个电压源的 neg 引脚
3. 都没有 → 报错 FloatingSubcircuit

这意味着：多个独立回路各自有各自的地，互不干扰。

---

## 四、如何新增一个模型

### 4.1 场景判断

| 你的需求 | 应该做什么 |
|:---|:---|
| 加一个 10kΩ 电阻 | 只加 comps 元件，用现有 ohm 模型 |
| 加一个蓝色 LED | 只加 comps 元件，用现有 diode 模型 |
| 加一个 555 定时器 | 用子电路（Phase 9 支持） |
| 加一个 NPN 三极管 | 新增 Rust 模型 npn |
| 加一个运放 | 新增 Rust 模型 opamp |

### 4.2 新增 Rust 模型的步骤

**步骤 1**：在 solver/models.rs 中声明参数规范

```rust
pub const NPN_DEFAULT_BETA: f64 = 100.0;

pub struct NpnParams {
    pub beta: f64,
    pub vbe_on: f64,
}

pub fn read_npn_params(comp: &SolverComponent) -> NpnParams {
    // ...
}
```

**步骤 2**：在 solver/matrix_builder.rs 中实现 MNA 填充

```rust
fn fill_npn(
    comp: &SolverComponent,
    ctx: &CircuitContext,
    n2m: &HashMap<usize, usize>,
    v_guess: &HashMap<usize, f64>,
    a: &mut DMatrix<f64>,
    b: &mut DVector<f64>,
) -> Result<(), SolverError> {
    // 1. 读取参数
    // 2. 计算等效电路（受控源）
    // 3. 填充矩阵
    Ok(())
}
```

**步骤 3**：在 build_mna 的 match 中注册

```rust
"npn" => fill_npn(comp, ctx, &node_matrix_index, v_guess, &mut a, &mut b),
```

**步骤 4**：在 solver/result_extractor.rs 中提取结果

**步骤 5**：如果是非线性元件，在 solver/nonlinear.rs::has_nonlinear 中登记

**步骤 6**：编写单元测试（在 core.rs 的 tests 模块中）

**步骤 7**：更新本文档

---

## 五、模型设计准则

### 5.1 命名

| 规则 | 说明 |
|:---|:---|
| func 用小写英文 | ohm / diode / npn |
| 引脚 id 语义化 | 无极性：p1 / p2；有极性：pos/neg、a/k、b/c/e |
| 参数名用物理符号 | R / V / I / Vf / Ron |

### 5.2 参数处理

- 必须参数（如电压源的 V）：缺失时报 SolverError::MissingParam
- 可选参数：声明默认值，缺失时用默认值
- 单位：本文档中显式标注

### 5.3 数值稳定性

- 避免 0 或无穷大参数 → 用 Gmin（1e-9）或 Roff（1e9）近似
- 非线性元件需要提供 v_guess 线性化路径
- 矩阵奇异时返回 SolverError::SingularMatrix

### 5.4 关联参考方向

所有模型统一使用关联参考方向（被动符号约定）：
- 电压 V：从正端到负端
- 电流 I：从正端流入
- 功率 P = V·I：P > 0 表示吸收，P < 0 表示发出

### 5.5 极性元件的引脚 id 约定

| 类型 | 正端 id | 负端 id |
|:---|:---:|:---:|
| 电压源 / 电池 | pos | neg |
| 二极管 / LED | a | k |
| NPN 三极管 | c / b | e |
| 运放 | in+ | in- |

极性元件的正负端由引脚 id 决定，不依赖 pins 数组顺序。

---

## 六、未来模型预留

### Phase 8：动态元件

| func | 说明 | 关键参数 |
|:---|:---|:---|
| capacitor | 电容 | C (F) |
| inductor | 电感 | L (H) |

需要瞬态分析（时间步进 + 微分方程）。

### Phase 8：半导体

| func | 说明 | 关键参数 |
|:---|:---|:---|
| npn | NPN 三极管 | beta, Vbe_on |
| pnp | PNP 三极管 | 同上 |
| nmos | N 沟道 MOSFET | Vth, Kp |
| pmos | P 沟道 MOSFET | 同上 |

### Phase 9：受控源与宏元件

| func | 说明 |
|:---|:---|
| vcvs | 电压控制电压源 |
| vccs | 电压控制电流源 |
| ccvs | 电流控制电压源 |
| cccs | 电流控制电流源 |
| ideal_opamp | 理想运放 |
| ideal_transformer | 理想变压器 |

### Phase 9：子电路（宏元件）

像 555 定时器、数码管这类由多个基础元件组合的元件，不需要新模型，而是通过子电路展开实现。

meta.json 中声明内部元件和连线：

```json
{
  "name": "timer_555",
  "subcircuit": {
    "components": [],
    "wires": []
  }
}
```

---

## 七、与前端的数据流

```
画布上的元件实例
    │
    │ ComponentLoader.extractSolverComponent()
    ▼
SolverComponent {
    id: 1,
    func: "ohm",
    params: { R: 1000 },
    pins: [{ id: "p1" }, { id: "p2" }]
}
    │
    │ invoke('solve_circuit') 或 send_command('UpdateInput')
    ▼
Rust Worker
    │
    │ match(func)
    ▼
fill_ohm(comp, ctx, ...)
    │
    │ MNA 求解
    ▼
SolverOutput {
    componentId: 1,
    voltage: 1.5,
    current: 0.0015,
    power: 0.00225
}
    │
    │ Channel 推回前端
    ▼
前端 applySimulationResults → 更新 comp.electrical → 重绘
```

关键点：
- 前端只传 func + 数值参数，不传电气行为
- Rust 只认 func，不关心元件的视觉、名称、位置
- paramMap 是前端的职责：把 UI 参数名翻译成模型参数名

---

## 八、变更记录

| 版本 | 日期 | 变更 |
|:---|:---|:---|
| 1.0 | Phase 5 | 初版：ohm / voltage_source / current_source / diode / switch / ground |

---

本文档是仿真引擎的 API 参考，任何模型的新增、修改、废弃都必须同步更新本文档。
