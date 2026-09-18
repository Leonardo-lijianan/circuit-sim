// src/ui/StatusBarManager.ts

import type { Circuit } from '../types';

export class StatusBarManager {
  private compCountEl: HTMLElement | null;
  private wireCountEl: HTMLElement | null;
  private simStatusEl: HTMLElement | null;
  private cursorPosEl: HTMLElement | null;
  private zoomLevelEl: HTMLElement | null;
  private statusMsgEl: HTMLElement | null;
  private statusMsgTimer: number | null = null;

  constructor() {
    this.compCountEl = document.getElementById('compCount');
    this.wireCountEl = document.getElementById('wireCount');
    this.simStatusEl = document.getElementById('simStatus');
    this.cursorPosEl = document.getElementById('cursorPos');
    this.zoomLevelEl = document.getElementById('zoomLevel');
    this.statusMsgEl = document.getElementById('statusMsg');
  }

  /**
   * 更新缩放比例显示
   * @param scale - 缩放比例（1.0 = 100%）
   */
  updateZoom(scale: number): void {
    if (this.zoomLevelEl) {
      this.zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
    }
  }

  /**
   * 在状态栏显示临时警告（自动消失）
   */
  showWarning(msg: string, duration: number = 3000): void {
    if (!this.statusMsgEl) return;

    this.statusMsgEl.textContent = msg;
    this.statusMsgEl.classList.add('warning');

    if (this.statusMsgTimer !== null) {
      clearTimeout(this.statusMsgTimer);
    }
    this.statusMsgTimer = window.setTimeout(() => {
      if (this.statusMsgEl) {
        this.statusMsgEl.textContent = '';
        this.statusMsgEl.classList.remove('warning');
      }
      this.statusMsgTimer = null;
    }, duration);
  }

  /**
   * 立即清除警告
   */
  clearWarning(): void {
    if (!this.statusMsgEl) return;
    this.statusMsgEl.textContent = '';
    this.statusMsgEl.classList.remove('warning');
    if (this.statusMsgTimer !== null) {
      clearTimeout(this.statusMsgTimer);
      this.statusMsgTimer = null;
    }
  }

  updateCircuitStats(circuit: Circuit): void {
    if (this.compCountEl) {
      this.compCountEl.textContent = String(circuit.components.length);
    }
    if (this.wireCountEl) {
      this.wireCountEl.textContent = String(circuit.wires.length);
    }
  }

  updateCursorPos(x: number, y: number): void {
    if (this.cursorPosEl) {
      this.cursorPosEl.textContent = `(${Math.round(x)}, ${Math.round(y)})`;
    }
  }

  updateSimStatus(status: string): void {
    if (this.simStatusEl) {
      this.simStatusEl.textContent = status;
    }
  }
}