// src/ui/ToolbarManager.ts

import type { InteractionManager } from '../interaction/InteractionManager';

/**
 * ToolbarManager
 * 
 * 职责：
 * - 更新状态栏中显示当前模式/状态
 * 
 * 注意：
 * - 模式按钮已移除（选择/连线合并为智能模式）
 * - 状态栏显示由 mode + pending 共同决定
 */
export class ToolbarManager {
  private interaction: InteractionManager;

  constructor(interaction: InteractionManager) {
    this.interaction = interaction;

    // 注册状态变化回调
    this.interaction.onModeChange(() => this.updateModeUI());
    this.interaction.onPendingChange(() => this.updateModeUI());

    // 初始化
    this.updateModeUI();
  }

  private updateModeUI(): void {
    const modeDisplay = document.getElementById('modeDisplay');
    if (modeDisplay) {
      modeDisplay.textContent = this.interaction.getDisplayLabel();
    }
  }

  /**
   * 根据 Worker 状态更新仿真控制按钮的禁用状态
   * 
   *   idle/stopped: 开始✅ 暂停❌ 停止❌
   *   running:      开始❌ 暂停✅ 停止✅
   *   paused:       开始✅ 暂停❌ 停止✅
   */
  setSimState(state: 'idle' | 'running' | 'paused' | 'stopped'): void {
    const btnStart = document.getElementById('btnStart') as HTMLButtonElement | null;
    const btnPause = document.getElementById('btnPause') as HTMLButtonElement | null;
    const btnStop = document.getElementById('btnStop') as HTMLButtonElement | null;

    const canStart = state === 'idle' || state === 'stopped' || state === 'paused';
    const canPause = state === 'running';
    const canStop = state === 'running' || state === 'paused';

    if (btnStart) btnStart.disabled = !canStart;
    if (btnPause) btnPause.disabled = !canPause;
    if (btnStop) btnStop.disabled = !canStop;
  }
}
