// src/io/KeyboardManager.ts

import type { InteractionManager } from '../interaction/InteractionManager';
import type { CircuitManager } from '../manager/CircuitManager';
import type { StatusBarManager } from '../ui/StatusBarManager';

export class KeyboardManager {
  private interaction: InteractionManager;
  private circuitManager: CircuitManager;
  private statusBar: StatusBarManager;

  private keys: Set<string> = new Set();

  // d 键二次确认删除的待确认元件 id
  private pendingDeleteId: number | null = null;
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
      case '2':
        this.clearDeletePending();
        this.interaction.setMode('wire');
        break;
      case 'Escape':
        this.clearDeletePending();
        if (this.interaction.isPending()) {
          this.interaction.clearPending();
        }
        this.interaction.setMode('select');
        break;
      // d 键在 keyup 中处理（避免长按重复触发）
      case ' ':
        event.preventDefault();
        if (!this.keys.has('Space')) {
          this.keys.add('Space');
          // 预留 Pan 模式
          // this.interaction.setMode('pan');
        }
        break;
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
      case ' ':
        if (this.keys.has('Space')) {
          this.keys.delete('Space');
          // 预留：释放 Pan
          // this.interaction.setMode('select');
        }
        break;
    }
  }

  /**
   * d 键二次确认删除逻辑（在 keyup 中触发）
   * 第一次按 d：显示警告
   * 第二次按 d（3 秒内，同一元件）：真正删除
   */
  private handleDeleteKey(): void {
    const selectedId = this.circuitManager.getSelectedId();

    // 情况1：没有选中的元件
    if (selectedId === null) {
      this.clearDeletePending();
      this.statusBar.showWarning('没有选中的元件');
      return;
    }

    // 情况2：第一次按 d，或者选中的元件变了
    if (this.pendingDeleteId !== selectedId) {
      this.pendingDeleteId = selectedId;
      this.startDeleteTimer();
      this.statusBar.showWarning('再按一次 d 删除');
      return;
    }

    // 情况3：第二次按 d，且是同一元件 → 执行删除
    this.clearDeletePending();
    this.statusBar.clearWarning();
    this.circuitManager.removeComponent(selectedId);
  }

  private startDeleteTimer(): void {
    if (this.pendingDeleteTimer !== null) {
      clearTimeout(this.pendingDeleteTimer);
    }
    this.pendingDeleteTimer = window.setTimeout(() => {
      this.pendingDeleteId = null;
      this.pendingDeleteTimer = null;
      this.statusBar.clearWarning();
    }, KeyboardManager.DELETE_CONFIRM_TIMEOUT);
  }

  private clearDeletePending(): void {
    this.pendingDeleteId = null;
    if (this.pendingDeleteTimer !== null) {
      clearTimeout(this.pendingDeleteTimer);
      this.pendingDeleteTimer = null;
    }
  }
}
