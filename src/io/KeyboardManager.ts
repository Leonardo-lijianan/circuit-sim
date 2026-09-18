// src/io/KeyboardManager.ts

import type { InteractionManager } from '../interaction/InteractionManager';
import type { CircuitManager } from '../manager/CircuitManager';
import type { StatusBarManager } from '../ui/StatusBarManager';

export class KeyboardManager {
  private interaction: InteractionManager;
  private circuitManager: CircuitManager;
  private statusBar: StatusBarManager;

  // d 键二次确认删除的待确认键（格式 "kind:id"）
  private pendingDeleteKey: string | null = null;
  private pendingDeleteTimer: number | null = null;
  private static DELETE_CONFIRM_TIMEOUT = 3000;

  constructor(deps: {
    interaction: InteractionManager;
    circuitManager: CircuitManager;
    statusBar: StatusBarManager;
  }) {
    this.interaction = deps.interaction;
    this.circuitManager = deps.circuitManager;
    this.statusBar = deps.statusBar;
    this.bindKeys();
  }

  private bindKeys(): void {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('keyup', this.handleKeyUp.bind(this));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // 忽略输入框内的按键
    if (event.target instanceof HTMLInputElement) return;

    switch (event.key) {
      case '1':
        this.clearDeletePending();
        this.interaction.setMode('select');
        break;
      case 'Escape':
        this.clearDeletePending();
        if (this.interaction.isPending()) {
          this.interaction.clearPending();
        }
        this.interaction.setMode('select');
        break;
      case ' ':
        // 空格键：切换选中元件（如果支持）
        event.preventDefault();
        this.handleSpaceToggle();
        break;
      case 'r':
      case 'R':
        // R 键：旋转选中元件 90°
        event.preventDefault();
        this.handleRotate();
        break;
      // d 键在 keyup 中处理（避免长按重复触发）
    }
  }

  /**
   * 空格键：切换当前选中元件的状态
   * 仅对支持 toggle 的元件有效（如 switch）
   */
  private handleSpaceToggle(): void {
    const sel = this.circuitManager.getSelection();
    if (!sel || sel.kind !== 'component') return;
    this.circuitManager.toggleComponent(sel.id);
  }

  /**
   * R 键：旋转当前选中元件 90°
   */
  private handleRotate(): void {
    const sel = this.circuitManager.getSelection();
    if (!sel || sel.kind !== 'component') return;
    const newRotation = this.circuitManager.rotateComponent(sel.id, 90);
    if (newRotation !== null) {
      this.statusBar.showWarning(`旋转 ${newRotation}°`);
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    // 忽略输入框内的按键
    if (event.target instanceof HTMLInputElement) return;

    switch (event.key) {
      case 'd':
      case 'D':
        this.handleDeleteKey();
        break;
    }
  }

  /**
   * d 键二次确认删除逻辑（在 keyup 中触发）
   * 第一次按 d：显示警告
   * 第二次按 d（3 秒内，同一元件）：真正删除
   */
  private handleDeleteKey(): void {
    const selection = this.circuitManager.getSelection();

    // 情况1：没有选中的对象
    if (!selection) {
      this.clearDeletePending();
      this.statusBar.showWarning('没有选中的对象');
      return;
    }

    // 唯一标识（kind + id）
    const selKey = `${selection.kind}:${selection.id}`;

    // 情况2：第一次按 d，或者选中的对象变了
    if (this.pendingDeleteKey !== selKey) {
      this.pendingDeleteKey = selKey;
      this.startDeleteTimer();
      this.statusBar.showWarning('再按一次 d 删除');
      return;
    }

    // 情况3：第二次按 d，且是同一对象 → 执行删除
    this.clearDeletePending();
    this.statusBar.clearWarning();
    this.circuitManager.deleteSelection();
  }

  private startDeleteTimer(): void {
    if (this.pendingDeleteTimer !== null) {
      clearTimeout(this.pendingDeleteTimer);
    }
    this.pendingDeleteTimer = window.setTimeout(() => {
      this.pendingDeleteKey = null;
      this.pendingDeleteTimer = null;
      this.statusBar.clearWarning();
    }, KeyboardManager.DELETE_CONFIRM_TIMEOUT);
  }

  private clearDeletePending(): void {
    this.pendingDeleteKey = null;
    if (this.pendingDeleteTimer !== null) {
      clearTimeout(this.pendingDeleteTimer);
      this.pendingDeleteTimer = null;
    }
  }
}
