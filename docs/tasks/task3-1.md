**从 Task 3.1：交互模式状态机（InteractionManager）开始。**

它是所有交互的“大脑”，没有它，后续的放置、拖拽、连线都无法统一管理。这是最底层、最基础的模块。

我现在直接给出 **Task 3.1 的完整代码**，你直接创建文件并集成到 `main.ts` 中即可看到效果（模式切换 + 光标变化）。

---

## 第一步：创建 `src/interaction/InteractionManager.ts`

```typescript
// src/interaction/InteractionManager.ts

import type { Mode, PendingAction } from '../types';

export class InteractionManager {
  private mode: Mode = 'select';
  private pending: PendingAction = null;
  private onModeChangeCallback?: (mode: Mode) => void;
  private onPendingChangeCallback?: (pending: PendingAction) => void;

  // ============================================================
  // 模式管理
  // ============================================================

  getMode(): Mode {
    return this.mode;
  }

  setMode(newMode: Mode): void {
    // 如果切换到 Select，清理所有待完成操作
    if (newMode === 'select') {
      this.clearPending();
    }

    // 如果从 Wire 切换到其他模式，取消未完成的连线
    if (this.mode === 'wire' && this.pending?.kind === 'wire') {
      this.clearPending();
    }

    // 如果从 Place 切换到其他模式，取消待放置状态
    if (this.mode === 'place' && this.pending?.kind === 'place') {
      this.clearPending();
    }

    this.mode = newMode;
    this.updateCursor();
    this.onModeChangeCallback?.(newMode);
  }

  // ============================================================
  // Pending 操作管理
  // ============================================================

  getPending(): PendingAction {
    return this.pending;
  }

  setPending(action: PendingAction): void {
    this.pending = action;
    this.onPendingChangeCallback?.(action);
  }

  clearPending(): void {
    this.pending = null;
    this.onPendingChangeCallback?.(null);
  }

  // ============================================================
  // 快捷状态查询
  // ============================================================

  isSelectMode(): boolean {
    return this.mode === 'select';
  }

  isPlaceMode(): boolean {
    return this.mode === 'place';
  }

  isWireMode(): boolean {
    return this.mode === 'wire';
  }

  isPanMode(): boolean {
    return this.mode === 'pan';
  }

  isPending(): boolean {
    return this.pending !== null;
  }

  isPlacePending(): boolean {
    return this.pending?.kind === 'place';
  }

  isWirePending(): boolean {
    return this.pending?.kind === 'wire';
  }

  getPlaceType(): string | null {
    return this.pending?.kind === 'place' ? this.pending.type : null;
  }

  getWireStart(): { componentId: number; pinId: string } | null {
    return this.pending?.kind === 'wire' ? this.pending.start : null;
  }

  // ============================================================
  // 回调注册
  // ============================================================

  onModeChange(callback: (mode: Mode) => void): void {
    this.onModeChangeCallback = callback;
  }

  onPendingChange(callback: (pending: PendingAction) => void): void {
    this.onPendingChangeCallback = callback;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private updateCursor(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    switch (this.mode) {
      case 'select':
        canvas.style.cursor = 'default';
        break;
      case 'place':
        canvas.style.cursor = 'crosshair';
        break;
      case 'wire':
        canvas.style.cursor = 'pointer';
        break;
      case 'pan':
        canvas.style.cursor = 'grab';
        break;
    }
  }
}
```

---

## 第二步：更新 `src/types.ts`（添加缺失的交互类型）

确保 `types.ts` 中包含以下内容（如果已有则跳过）：

```typescript
// src/types.ts

// ===== 交互模式 =====
export type Mode = 'select' | 'place' | 'wire' | 'pan';

// ===== 引脚引用 =====
export interface PinRef {
  componentId: number;
  pinId: string;
}

// ===== 待完成操作 =====
export type PendingAction =
  | { kind: 'place'; type: string }
  | { kind: 'wire'; start: PinRef }
  | null;
```

---

## 第三步：集成到 `src/main.ts`

在 `main.ts` 中实例化 `InteractionManager`，并绑定工具栏按钮和键盘事件。

```typescript
// src/main.ts（片段，在现有代码基础上添加）

import { InteractionManager } from './interaction/InteractionManager';
// ... 其他导入

// ============================================================
// 创建 InteractionManager
// ============================================================

const interaction = new InteractionManager();

// 模式变化时更新 UI（工具栏高亮 + 模式显示）
interaction.onModeChange((mode) => {
  // 更新工具栏按钮高亮
  document.querySelectorAll('.mode-group button').forEach((btn) => {
    btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
  });

  // 更新模式显示文字
  const modeDisplay = document.getElementById('modeDisplay');
  if (modeDisplay) {
    const modeNames: Record<Mode, string> = {
      select: '选择',
      place: '放置',
      wire: '连线',
      pan: '平移',
    };
    modeDisplay.textContent = `模式: ${modeNames[mode]}`;
  }
});

// ============================================================
// 绑定工具栏模式按钮
// ============================================================

document.querySelectorAll('.mode-group button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = (btn as HTMLElement).dataset.mode as Mode;
    if (mode) interaction.setMode(mode);
  });
});

// ============================================================
// 绑定键盘快捷键
// ============================================================

document.addEventListener('keydown', (event) => {
  // 忽略输入框内的按键
  if (event.target instanceof HTMLInputElement) return;

  switch (event.key) {
    case '1':
      interaction.setMode('select');
      break;
    case '2':
      interaction.setMode('wire');
      break;
    case '3':
      interaction.setMode('place');
      break;
    case 'Escape':
      // 如果有 pending 操作，取消它；否则取消选中（Phase 3 后续实现）
      if (interaction.isPending()) {
        interaction.clearPending();
        interaction.setMode('select');
      }
      break;
    case ' ':
      event.preventDefault();
      // 预留 Pan 模式（Phase 3 后续）
      break;
  }
});
```

---

## 第四步：修改 `index.html` 确认按钮有 `data-mode` 属性

确保工具栏中的模式按钮有 `data-mode` 属性：

```html
<div class="mode-group">
  <button id="modeSelect" class="active" data-mode="select">选择</button>
  <button id="modeWire" data-mode="wire">连线</button>
  <button id="modePlace" data-mode="place">放置</button>
</div>
```

---

## 验收 Task 3.1

运行 `npm run tauri dev`，验证：

| 测试项 | 预期结果 |
|--------|----------|
| 点击工具栏按钮 | 对应按钮高亮，状态栏显示模式名称 |
| 按 `1`、`2`、`3` 快捷键 | 切换模式，工具栏同步高亮 |
| 光标变化 | Select→default, Place→crosshair, Wire→pointer |
| 按 `ESC` | 清空 pending（目前无 pending，只做模式切换） |

---

**Task 3.1 完成后，告诉我，我们接着做 Task 3.2（CircuitManager 数据管理）。**