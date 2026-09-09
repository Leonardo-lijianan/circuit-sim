// src/ui/StatusBarManager.ts

import type { Circuit } from '../types';

export class StatusBarManager {
  private compCountEl: HTMLElement | null;
  private wireCountEl: HTMLElement | null;
  private simStatusEl: HTMLElement | null;
  private cursorPosEl: HTMLElement | null;

  constructor() {
    this.compCountEl = document.getElementById('compCount');
    this.wireCountEl = document.getElementById('wireCount');
    this.simStatusEl = document.getElementById('simStatus');
    this.cursorPosEl = document.getElementById('cursorPos');
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