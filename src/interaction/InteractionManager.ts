// src/interaction/InteractionManager.ts

import type { Mode, PendingAction } from '../types';

export class InteractionManager {
  private mode: Mode = 'select';
  private pending: PendingAction = null;
  private onModeChangeCallbacks: ((mode: Mode) => void)[] = []; // 支持多订阅者！！！
  private onPendingChangeCallbacks: ((pending: PendingAction) => void)[] = [];
  private onPlaceCallback?: (type: string, x: number, y: number) => void;  // ← Task 3.4 新增

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
    for (const cb of this.onModeChangeCallbacks) cb(newMode);
  }

  // ============================================================
  // Pending 操作管理
  // ============================================================

  getPending(): PendingAction {
    return this.pending;
  }

  setPending(action: PendingAction): void {
    this.pending = action;
    for (const cb of this.onPendingChangeCallbacks) cb(action);
  }

  clearPending(): void {
    this.pending = null;
    for (const cb of this.onPendingChangeCallbacks) cb(null);
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
    this.onModeChangeCallbacks.push(callback);
  }

  onPendingChange(callback: (pending: PendingAction) => void): void {
    this.onPendingChangeCallbacks.push(callback);
  }

  // ============================================================
  // Place 模式事件处理（由 Canvas 事件调用）
  // ============================================================

  /**
   * 处理鼠标按下事件（由 Canvas 事件监听调用）
   * 根据当前模式分发到不同的处理逻辑
   */
  handleMouseDown(x: number, y: number): void {
    switch (this.mode) {
      case 'place':
        this.handlePlaceClick(x, y);
        break;
      case 'wire':
        // Phase 3 后续 Task 实现
        break;
      case 'select':
        // Phase 3 后续 Task 实现（选中/拖拽）
        break;
      default:
        break;
    }
  }

  /**
   * Place 模式：点击画布放置元件
   */
  private handlePlaceClick(x: number, y: number): void {
    if (!this.isPlacePending()) {
      console.warn('⚠️ Place 模式下没有待放置的元件类型');
      return;
    }

    const type = this.getPlaceType();
    if (!type) return;

    // 通过回调通知外部创建元件
    if (this.onPlaceCallback) {
      // 计算元件左上角位置（居中放置）
      const w = 60;
      const h = 40;
      this.onPlaceCallback(type, x - w / 2, y - h / 2);
    }

    // 放置后清理 pending 并回到 Select 模式
    this.clearPending();
    this.setMode('select');
  }

  // ============================================================
  // Place 模式回调注册
  // ============================================================

  onPlace(callback: (type: string, x: number, y: number) => void): void {
    this.onPlaceCallback = callback;
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