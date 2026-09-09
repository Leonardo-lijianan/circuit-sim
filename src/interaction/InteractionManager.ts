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