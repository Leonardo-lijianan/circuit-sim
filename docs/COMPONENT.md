# 元件定义规范 (COMPONENT)

> 本文档定义 comps/ 目录下每个元件的 meta.json 文件格式
>
> 面向读者：元件设计者、CompMaker 工具开发者
> 相关文档：MODELS.md（电气模型 API）

---

## 一、概述

每个元件是 comps/<name>/ 下的一个文件夹，包含：

| 文件 | 必需 | 说明 |
|:---|:---:|:---|
| meta.json | 是 | 元件定义（本文档描述） |
| fix.svg | 是 | 固定层图形（外壳、引脚底座） |
| flex/*.svg | 否 | 动态层图形（发光体、拨杆等） |

meta.json 描述元件的四个维度：
1. 视觉：引用哪些 SVG 文件
2. 拓扑：几个引脚、引脚位置
3. 参数：用户能改哪些值
4. 电气行为：引用哪个 Model（见 MODELS.md）

---

## 二、目录结构

```
comps/
└── <name>/
    ├── meta.json          # 必需
    ├── fix.svg            # 必需
    └── flex/              # 可选
        ├── <unit_a>.svg
        └── <unit_b>.svg
```

命名规则：
- <name> 仅限小写字母、数字、下划线（[a-z0-9_]）
- 单元文件名建议语义化（body / lever / glow / seg_a）

---

## 三、完整 Schema

```typescript
interface ComponentDefinition {
  schemaVersion?: string;         // 版本号，当前 "1.0"
  name: string;                   // 类型标识符，必须与目录名一致
  label: string;                  // 中文显示名

  fix: { file: "fix.svg" };       // 固定层（固定值）

  flex?: {                        // 动态层（可选）
    units: Record<string, {
      file: string;               // 如 "flex/lever.svg"
    }>;
  };

  pins: PinDefinition[];          // 引脚列表
  params: ParamDefinition[];      // 参数列表

  visual: {
    states: Record<string, {
      parts: Record<string, {
        opacity?: number;         // 0~1
        color?: string;           // 十六进制色
        rotation?: number;        // 角度
        rotationAnchor?: [number, number]; // 旋转轴（viewBox 坐标）
        offsetX?: number;
        offsetY?: number;
      }>;
    }>;
    default_state?: string;       // 默认状态名（缺省 "default"）
  };

  model: {
    func: string;                 // 模型名（见 MODELS.md）
    paramMap: Record<string, string>; // 模型参数 ← UI 参数
  };

  state_transition?: StateTransition; // 仿真驱动状态（可选）

  metadata?: Record<string, any>; // 自定义元数据（可选）
}
```

---

## 四、字段详解

### 4.1 schemaVersion（可选）

当前值："1.0"。用于未来不兼容变更时的版本区分。

### 4.2 name（必需）

元件的类型标识符，**必须与目录名一致**。仅限小写字母、数字、下划线。

```json
"name": "resistor"
```

### 4.3 label（必需）

用户界面中显示的名称（中文或英文皆可）。

```json
"label": "电阻"
```

### 4.4 fix（必需）

固定层引用，**只允许一个字段**：

```json
"fix": { "file": "fix.svg" }
```

fix.svg 是元件的静态骨架：外壳、引脚底座、丝印。**永不变化**。

### 4.5 flex（可选）

动态层引用。每个单元是一个独立 SVG 文件，可以有独立的状态控制。

```json
"flex": {
  "units": {
    "body":  { "file": "flex/body.svg" },
    "lever": { "file": "flex/lever.svg" }
  }
}
```

单元 ID（body / lever）会在 visual.states 中被引用。

### 4.6 pins（必需）

引脚定义列表。每个引脚包含：

```typescript
{
  id: string;              // 引脚标识符
  x: number;               // X 坐标（fix.svg 坐标系）
  y: number;               // Y 坐标
  label?: string;          // 显示标签，如 "+" "A"
  type?: 'passive' | 'input' | 'output' | 'bidirectional';
  hitRadius?: number;      // 点击/磁吸半径，默认 15
}
```

**极性元件**的引脚 id 必须遵循 MODELS.md 的约定：

| 元件类型 | 正端 | 负端 |
|:---|:---|:---|
| 电压源/电池 | pos | neg |
| 二极管/LED | a | k |

无极性元件可用 p1 / p2。

### 4.7 params（必需）

用户可调参数列表。每个参数包含：

```typescript
{
  id: string;              // 参数标识符（英文）
  label: string;           // 显示名（建议带单位）
  type: 'number' | 'string' | 'boolean' | 'select';
  default: any;            // 默认值
  min?: number;            // 最小值（number 类型）
  max?: number;
  step?: number;
  options?: string[];      // 选项列表（select 类型）
}
```

**paramMap 关联**：meta.json 的 model.paramMap 把 UI 参数名翻译成模型参数名。

### 4.8 visual（必需）

视觉状态表。每个状态定义一组 flex 单元的变换参数。

```json
"visual": {
  "states": {
    "off": {
      "parts": {
        "lever": { "rotation": -30, "rotationAnchor": [15, 20] }
      }
    },
    "on": {
      "parts": {
        "lever": { "rotation": 0, "rotationAnchor": [15, 20] }
      }
    }
  },
  "default_state": "off"
}
```

详见第五章"视觉系统详解"。

### 4.9 model（必需）

引用一个电气模型（定义见 MODELS.md）。

```json
"model": {
  "func": "ohm",
  "paramMap": { "R": "resistance" }
}
```

- func：模型名（Rust 侧的 SOLVER_REGISTRY 里必须存在）
- paramMap：`{ 模型参数名: UI 参数 id }`

**渲染时**：前端遍历 paramMap，把 instance.params[uiKey] 写入 params[rustKey]，发送给 Rust。

### 4.10 state_transition（可选）

仿真结果驱动的状态转换规则。三种模式：

**binary（二态）**：

```json
"state_transition": {
  "type": "binary",
  "condition": "electrical.current > 0.001",
  "true_state": "on",
  "false_state": "off"
}
```

condition 是一个 JavaScript 表达式，`electrical` 是 `{ voltage, current, power }`。

**map（值映射，用于数码管）**：

```json
"state_transition": {
  "type": "map",
  "source": "digit",
  "mapping": { "0": "digit_0", "1": "digit_1" },
  "default_state": "digit_0"
}
```

**direct_drive（直接驱动部件，用于点阵屏）**：

```json
"state_transition": {
  "type": "direct_drive",
  "parts": { "seg_a": "bit0", "seg_b": "bit1" }
}
```

### 4.11 metadata（可选）

任意自定义字段，不参与渲染或求解。可用于 CompMaker 记录作者、分类等。

```json
"metadata": {
  "author": "CompMaker",
  "category": "passive"
}
```

---

## 五、视觉系统详解

### 5.1 fix.svg 与 flex/*.svg 的分工

| 层 | 画什么 | 不画什么 |
|:---|:---|:---|
| fix.svg | 外壳、底座、引脚、丝印 | 任何会变化的部分 |
| flex/*.svg | 活动部件（发光体、拨杆、滑块） | 外壳、引脚 |

### 5.2 坐标系（关键）

- 每个 SVG 文件有独立的 viewBox
- fix.svg 的 viewBox 定义了元件的**局部坐标系**
- flex/*.svg 的 viewBox 可以不同，但**图形内容的位置**要与 fix.svg 对齐（通过渲染时的 offsetX/offsetY 处理）

### 5.3 SVG 支持的图元

flex/*.svg 走 DOMParser 解析（不支持浏览器原生渲染的全部特性），支持的图元：

| 图元 | 属性 |
|:---|:---|
| <circle> | cx, cy, r, fill, stroke, stroke-width, opacity |
| <rect> | x, y, width, height, fill, stroke, stroke-width, opacity |
| <path> | d, fill, stroke, stroke-width, opacity |
| <polygon> | points, fill, stroke, stroke-width, opacity |
| <line> | x1, y1, x2, y2, stroke, stroke-width, opacity |

**不支持的**：`<g>`（分组）、`<use>`、`<defs>`、`<style>`、transform 属性、CSS 类选择器。

### 5.4 rotationAnchor

指定旋转轴在 viewBox 坐标系中的位置：

```json
"lever": { "rotation": -30, "rotationAnchor": [15, 20] }
```

- 未指定时默认使用 viewBox 中心 `[vw/2, vh/2]`
- 常用于开关的拨杆绕一端旋转

---

## 六、完整示例

### 6.1 电阻（最简）

```json
{
  "schemaVersion": "1.0",
  "name": "resistor",
  "label": "电阻",
  "fix": { "file": "fix.svg" },
  "pins": [
    { "id": "p1", "x": 0,  "y": 20 },
    { "id": "p2", "x": 60, "y": 20 }
  ],
  "params": [
    { "id": "resistance", "label": "阻值 (Ω)", "type": "number", "default": 1000, "min": 1 }
  ],
  "visual": { "states": { "default": { "parts": {} } }, "default_state": "default" },
  "model": { "func": "ohm", "paramMap": { "R": "resistance" } }
}
```

### 6.2 LED（有极性 + 状态转换）

```json
{
  "name": "led",
  "label": "LED",
  "fix": { "file": "fix.svg" },
  "flex": { "units": { "body": { "file": "flex/body.svg" } } },
  "pins": [
    { "id": "a", "x": 0,  "y": 20 },
    { "id": "k", "x": 60, "y": 20 }
  ],
  "params": [
    { "id": "forward_voltage", "label": "正向压降 (V)", "type": "number", "default": 1.8 }
  ],
  "visual": {
    "states": {
      "off": { "parts": { "body": { "opacity": 0.1 } } },
      "on":  { "parts": { "body": { "opacity": 1, "color": "#ff4400" } } }
    },
    "default_state": "off"
  },
  "model": { "func": "diode", "paramMap": { "Vf": "forward_voltage" } },
  "state_transition": {
    "type": "binary",
    "condition": "electrical.current > 0.001",
    "true_state": "on",
    "false_state": "off"
  }
}
```

### 6.3 开关（rotationAnchor）

```json
{
  "name": "switch",
  "label": "开关",
  "fix": { "file": "fix.svg" },
  "flex": { "units": { "lever": { "file": "flex/lever.svg" } } },
  "pins": [
    { "id": "p1", "x": 0,  "y": 20 },
    { "id": "p2", "x": 60, "y": 20 }
  ],
  "params": [
    { "id": "closed", "label": "闭合", "type": "boolean", "default": false }
  ],
  "visual": {
    "states": {
      "off": { "parts": { "lever": { "rotation": -30, "rotationAnchor": [15, 20] } } },
      "on":  { "parts": { "lever": { "rotation": 0,   "rotationAnchor": [15, 20] } } }
    },
    "default_state": "off"
  },
  "model": { "func": "switch", "paramMap": { "closed": "closed" } }
}
```

---

## 七、与 MODELS.md 的关联

meta.json 的 model.paramMap 是连接两个文档的桥梁：

```
UI 参数 id              model.paramMap          模型参数名
(resistance)  ─────────►  { "R": "resistance" }  ─────────► (R)
```

- UI 参数 id 由本文档的 params 定义
- 模型参数名由 MODELS.md 定义
- paramMap 负责翻译

---

## 八、CompMaker 导出规范

CompMaker 工具导出元件时，必须满足：

1. 目录名 = meta.json 的 name 字段
2. 必须有 fix.svg，viewBox 内包含所有引脚端点
3. flex/ 目录内的每个 SVG 只画自己的图形
4. 引脚 id 遵循 MODELS.md 的极性约定（pos/neg、a/k）
5. 参数 id 遵循 MODELS.md 的参数名（如电阻的 resistance）
6. paramMap 必须覆盖 model 所需的全部参数

---

## 九、Schema 版本控制

当前版本："1.0"。

未来的不兼容变更（如字段重命名、结构改变）会提升版本号。
前端加载时会检查 schemaVersion，不匹配时给出警告（当前不阻塞）。

---

## 十、常见问题

**Q：为什么 fix.svg 和 flex/*.svg 要分开？**
A：fix 层只绘制一次，可以缓存；flex 层每帧绘制，性能敏感。

**Q：为什么 flex 里不支持 <g> 和 transform？**
A：当前渲染器用 DOMParser 逐图元解析，暂未实现分组。需要分组时用多个独立单元。

**Q：state 和 params.closed 的关系？**
A：state 决定视觉，params 决定电气。对于开关，前端约定 `closed === true` 时 state = 'on'。详见 MODELS.md 的 switch 章节。

**Q：一个元件能有多个 flex 单元吗？**
A：能。每个单元在 visual.states 的 parts 里独立控制。

---

本文档是 meta.json 的格式规范，任何 meta.json 结构变更都必须同步更新本文档。
