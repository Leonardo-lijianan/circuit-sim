# comps 元件包完整特性规范

> **版本**：v1.0  
> **适用范围**：所有放置在 `src/assets/comps/{type}/` 下的元件定义  
> **特性原则**：**一切由数据驱动，代码不硬编码任何元件类型或数值**


## 一、目录结构

```
src/assets/comps/{type}/
├── meta.json              # 元件定义（必须）
├── fix.svg                # 固定层图形（必须）
└── flex/                  # 动态层单元目录（可选）
    ├── {unit_a}.svg       # 动态单元 A
    ├── {unit_b}.svg       # 动态单元 B
    └── ...
```

**规则**：
- `{type}`：仅限小写字母、数字、下划线（`[a-z0-9_]+`）
- `fix.svg` 必须存在，绘制元件的**静态骨架**（外壳、引脚、底座、丝印）
- `flex/` 可选，只有当元件有**动态变化**（亮灭、旋转、位移、颜色变化）时才需要
- `flex/*.svg` 每个文件代表一个**最小变换单元**，可独立控制


## 二、meta.json 完整 Schema

```json
{
  "schemaVersion": "1.0",

  "name": "led",
  "label": "发光二极管",

  "fix": { "file": "fix.svg" },

  "flex": {
    "units": {
      "body": { "file": "flex/body.svg" }
    }
  },

  "pins": [
    { "id": "a", "x": 0, "y": 20, "label": "+", "hitRadius": 15 },
    { "id": "k", "x": 60, "y": 20, "label": "-", "hitRadius": 15 }
  ],

  "params": [
    { "id": "forward_voltage", "label": "正向压降 (V)", "type": "number", "default": 1.8, "min": 0.5, "max": 3.3 },
    { "id": "color", "label": "发光颜色", "type": "select", "default": "#ff4400", "options": ["#ff4400", "#ff0000", "#00ff00", "#0000ff", "#ffff00"] }
  ],

  "visual": {
    "states": {
      "off": {
        "parts": {
          "body": { "opacity": 0.1 }
        }
      },
      "on": {
        "parts": {
          "body": { "opacity": 1, "color": "#ff4400" }
        }
      }
    },
    "default_state": "off"
  },

  "model": {
    "func": "diode",
    "paramMap": { "Vf": "forward_voltage" }
  },

  "state_transition": {
    "type": "binary",
    "condition": "electrical.current > 0.001",
    "true_state": "on",
    "false_state": "off"
  },

  "metadata": {
    "author": "CompMaker",
    "category": "passive"
  }
}
```


## 三、字段详解

### 3.1 `name`（字符串，必须）

元件类型标识符，与目录名一致。

### 3.2 `label`（字符串，必须）

用户界面中显示的友好名称。

### 3.3 `fix`（对象，必须）

固定层配置：
- `file`：固定为 `"fix.svg"`

**特性**：`fix.svg` 中的颜色、形状、透明度是**静态的**，不会被任何状态覆盖。它代表元件的**物理骨架**。

### 3.4 `flex`（对象，可选）

动态层配置：
- `units`：动态单元注册表，键为单元 ID，值为文件路径

**特性**：
- 每个 `flex/*.svg` 使用与 `fix.svg` **相同的坐标空间**（viewBox 必须定义）
- `viewBox` 的 `min-x` 和 `min-y` 表示该单元在 `fix.svg` 坐标系中的偏移量，加载时自动解析
- 每个单元可被 `visual.states` 中的 `parts` 独立控制

### 3.5 `pins`（数组，必须）

引脚定义，每个引脚包含：
- `id`（字符串，必须）：引脚标识符，用于连线
- `x`（数字，必须）：在 `fix.svg` 坐标系中的 X 坐标
- `y`（数字，必须）：在 `fix.svg` 坐标系中的 Y 坐标
- `label`（字符串，可选）：显示标签
- `hitRadius`（数字，可选）：点击/磁吸半径，默认 15

**特性**：引脚坐标以 `fix.svg` 的 viewBox 为基准。连线时，导线端点落在 `(comp.x + pin.x, comp.y + pin.y)`。

### 3.6 `params`（数组，必须）

用户可调参数，每个参数包含：
- `id`（字符串，必须）：参数标识符
- `label`（字符串，必须）：显示名称
- `type`（字符串，必须）：`number` | `string` | `boolean` | `select`
- `default`（任意，必须）：默认值
- `min`（数字，可选）：最小值（number 类型）
- `max`（数字，可选）：最大值（number 类型）
- `step`（数字，可选）：步进值（number 类型）
- `options`（字符串数组，可选）：选项列表（select 类型）

**特性**：修改参数时，若仿真正在运行，自动触发热更新。

### 3.7 `visual`（对象，必须）

视觉状态定义：
- `states`：状态名 → 视觉参数映射
- `default_state`：默认状态名（未指定时使用 `"default"`）

每个状态的 `parts` 控制各动态单元：
- `opacity`：透明度 0~1（覆盖 SVG 原有透明度）
- `color`：颜色滤镜（十六进制 `#RRGGBB`）
- `rotation`：旋转角度（度），绕单元中心
- `offsetX` / `offsetY`：位移（逻辑像素）

**特性**：
- 状态中定义的 `opacity` 和 `color` **覆盖** SVG 自身的填充色和透明度
- 如果状态未控制某个单元，该单元保持默认（不可见）
- 状态切换由 `state_transition` 驱动

### 3.8 `model`（对象，必须）

电气模型：
- `func`（字符串，必须）：求解器函数名，在 Rust 的 `match` 表中注册
- `paramMap`（对象，必须）：参数映射，`{ Rust参数名: UI参数ID }`

**特性**：发送给 Rust 时，根据 `paramMap` 从 `params` 中提取数值。

### 3.9 `state_transition`（对象，可选）

状态转换规则，支持三种模式：

**模式 1：二态判断（binary）**
```json
{
  "type": "binary",
  "condition": "electrical.current > 0.001",
  "true_state": "on",
  "false_state": "off"
}
```

**模式 2：值映射表（map）**
```json
{
  "type": "map",
  "source": "digit",
  "mapping": {
    "0": "digit_0",
    "1": "digit_1"
  },
  "default_state": "default"
}
```

**模式 3：直接驱动（direct_drive）**
```json
{
  "type": "direct_drive",
  "parts": {
    "seg_a": "bit0",
    "seg_b": "bit1"
  }
}
```

**特性**：仿真结果返回后，自动执行状态转换，更新 `comp.state` 或 `comp.directParts`。

### 3.10 `metadata`（对象，可选）

元数据，供工具链使用（如 CompMaker、版本控制、分类标签）。


## 四、fix.svg + flex/*.svg 视觉规范

### 4.1 坐标系规则

| 规则 | 说明 |
| :--- | :--- |
| **统一坐标系** | `fix.svg` 和所有 `flex/*.svg` 使用相同的 viewBox |
| **viewBox 必须定义** | 格式：`min-x min-y width height` |
| **min-x / min-y 承载偏移** | `flex/*.svg` 的 `min-x`/`min-y` 表示该单元在 `fix.svg` 坐标系中的位置 |
| **viewBox 尺寸不限** | 但建议宽高乘积不超过 1,000,000 像素，避免内存过大 |

### 4.2 图形内容分工

| 文件 | 应该画什么 | 不应该画什么 |
| :--- | :--- | :--- |
| `fix.svg` | 外壳、底座、引脚、丝印、不变化的装饰 | 任何会变化的部分（发光体、拨杆、滑块） |
| `flex/body.svg` | 活动部件（发光体、拨杆、滑块） | 外壳、引脚、固定结构 |

### 4.3 颜色与透明度覆盖规则（重要！）

| 层级 | 来源 | 优先级 |
| :--- | :--- | :--- |
| 1. SVG 自身颜色 | `<path fill="#ff0000" opacity="0.5">` | 最低（默认值） |
| 2. `visual.states` 中的 `opacity` | `{ "opacity": 1 }` | 覆盖 SVG 的 `opacity` |
| 3. `visual.states` 中的 `color` | `{ "color": "#ff4400" }` | 覆盖 SVG 的 `fill`（通过 `source-atop` 叠色） |

**渲染顺序**：
1. 加载 SVG → 按原样绘制
2. 如果有 `opacity` → 应用 `globalAlpha`
3. 如果有 `color` → 使用 `globalCompositeOperation = 'source-atop'` 叠色

**这意味着**：
- 设计师可以在 SVG 中预设颜色（如发光体默认画成黄色）
- 运行时通过状态覆盖为任意颜色（如红色、绿色、蓝色）
- 如果状态不控制颜色，则使用 SVG 自身的颜色

**示例**：LED 在 `off` 状态不控制颜色，显示 SVG 自身的灰色；在 `on` 状态控制颜色为橙色，覆盖 SVG 的灰色。


## 五、状态控制完整机制

### 5.1 控制链路

```
仿真结果 (SolverOutput)
    ↓
state_transition 规则引擎
    ↓
comp.state = 'on' 或 comp.directParts = { ... }
    ↓
渲染器查找 visual.states[comp.state]
    ↓
读取 parts 中各单元的控制参数
    ↓
应用到 Canvas 绘制（覆盖 SVG 属性）
```

### 5.2 状态优先级

| 优先级 | 控制源 | 说明 |
| :--- | :--- | :--- |
| 1（最高） | `comp.directParts` | `direct_drive` 模式直接驱动，覆盖一切 |
| 2 | `visual.states[comp.state]` | 状态驱动的控制参数 |
| 3（最低） | SVG 自身属性 | 默认值，未被覆盖时生效 |

### 5.3 多个 flex 单元的独立控制

每个单元可以独立控制：
```json
{
  "states": {
    "digit_3": {
      "parts": {
        "seg_a": { "opacity": 1 },
        "seg_b": { "opacity": 1 },
        "seg_c": { "opacity": 1 },
        "seg_d": { "opacity": 1 },
        "seg_e": { "opacity": 1 },
        "seg_f": { "opacity": 0 },
        "seg_g": { "opacity": 1 },
        "seg_dp": { "opacity": 0 }
      }
    }
  }
}
```


## 六、加载与解析行为（关键）

### 6.1 加载流程

```
启动时：
  扫描 src/assets/comps/*/meta.json
    ↓
  解析 meta.json
    ↓
  加载 fix.svg（作为 Image）
    ↓
  如果 flex.units 存在：
    对每个单元：
      加载 flex/{unit}.svg
      解析 viewBox → 提取 min-x, min-y, width, height
      缓存为 Image + 偏移量
    ↓
  存入注册表 (Map<type, ComponentDefinition>)
```

### 6.2 解析机制

| SVG 元素 | 解析结果 | 用途 |
| :--- | :--- | :--- |
| `<svg viewBox="20 10 40 30">` | `offsetX: 20, offsetY: 10, width: 40, height: 30` | 绘制时偏移 |


## 七、运行时行为

### 7.1 所有元件共享的渲染逻辑

无论元件类型是什么（LED、电阻、数码管、开关），渲染逻辑是**完全通用**的：

1. 绘制 `fix.svg`（固定）
2. 读取 `comp.state`
3. 查找 `visual.states[state]`
4. 遍历 `flex.units`，应用 `parts` 控制参数
5. 绘制每个单元（应用透明度/颜色/旋转/位移）

**没有任何 `if (type === 'led')` 或 `if (type === 'switch')` 硬编码。**

### 7.2 状态切换行为

| 触发的状态切换 | 系统行为 |
| :--- | :--- |
| 仿真结果返回 | `state_transition` 自动执行 → `comp.state` 更新 → 重绘 |
| 用户手动切换（调试） | `comp.state` 更新 → 重绘 |
| 参数变化 | 重绘（若仿真正在运行，触发热更新） |

### 7.3 数据驱动保证

| 行为 | 是否硬编码？ |
| :--- | :--- |
| LED 亮灭颜色 `#ff4400` | ❌ 来自 `meta.json` |
| 开关拨杆旋转角度 | ❌ 来自 `meta.json` |
| 数码管段显组合 | ❌ 来自 `meta.json` |
| `opacity` 值 | ❌ 来自 `meta.json` |
| 渲染循环中画 `fix.svg` | ✅ 框架代码 |
| 渲染循环中画 `flex/*.svg` | ✅ 框架代码 |
| 应用 `globalAlpha` | ✅ 框架代码 |
| 应用 `source-atop` 叠色 | ✅ 框架代码 |

**所有业务数值（颜色、角度、透明度、组合）来自 `meta.json`，框架代码仅提供通用的渲染能力。**


## 八、完整示例：LED 元件包

```
src/assets/comps/led/
├── meta.json
├── fix.svg
└── flex/
    └── body.svg
```

### `meta.json`
```json
{
  "schemaVersion": "1.0",
  "name": "led",
  "label": "发光二极管",
  "fix": { "file": "fix.svg" },
  "flex": {
    "units": {
      "body": { "file": "flex/body.svg" }
    }
  },
  "pins": [
    { "id": "a", "x": 0, "y": 20, "label": "+" },
    { "id": "k", "x": 60, "y": 20, "label": "-" }
  ],
  "params": [
    { "id": "forward_voltage", "label": "正向压降 (V)", "type": "number", "default": 1.8, "min": 0.5, "max": 3.3 }
  ],
  "visual": {
    "states": {
      "off": { "parts": { "body": { "opacity": 0.1 } } },
      "on": { "parts": { "body": { "opacity": 1, "color": "#ff4400" } } }
    },
    "default_state": "off"
  },
  "model": {
    "func": "diode",
    "paramMap": { "Vf": "forward_voltage" }
  },
  "state_transition": {
    "type": "binary",
    "condition": "electrical.current > 0.001",
    "true_state": "on",
    "false_state": "off"
  }
}
```

### `fix.svg`
```svg
<svg viewBox="0 0 60 40" xmlns="http://www.w3.org/2000/svg">
  <circle cx="30" cy="20" r="14" fill="#666" stroke="#333" stroke-width="1.5"/>
  <polygon points="30,4 33,14 27,14" fill="#333"/>
  <polygon points="30,36 27,26 33,26" fill="#333"/>
</svg>
```

### `flex/body.svg`
```svg
<svg viewBox="14 6 32 28" xmlns="http://www.w3.org/2000/svg">
  <!-- 注意：off 状态使用灰色（默认），on 状态会被 meta.json 中的 color 覆盖 -->
  <circle cx="30" cy="20" r="12" fill="#888888" opacity="0.5"/>
</svg>
```