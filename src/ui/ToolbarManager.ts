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
   * 根据 Worker 状态更新仿真控制按钮
   *
   *   主按钮：开始 / 暂停 / 继续（安全动作，蓝色高亮）
   *   次按钮：结束（危险动作，灰色，idle 时隐藏）
   *
   *   idle/stopped: 主[▶ 开始]  次[隐藏]
   *   running:      主[⏸ 暂停]  次[■ 结束]
   *   paused:       主[▶ 继续]  次[■ 结束]
   */
  setSimState(state: 'idle' | 'running' | 'paused' | 'stopped'): void {
    const primary = document.getElementById('btnSimPrimary') as HTMLButtonElement | null;
    const secondary = document.getElementById('btnSimSecondary') as HTMLButtonElement | null;
    if (!primary || !secondary) return;

    switch (state) {
      case 'idle':
      case 'stopped':
        primary.textContent = '▶ 开始';
        primary.classList.add('primary');
        secondary.style.display = 'none';
        break;
      case 'running':
        primary.textContent = '⏸ 暂停';
        primary.classList.add('primary');
        secondary.textContent = '■ 结束';
        secondary.style.display = '';
        break;
      case 'paused':
        primary.textContent = '▶ 继续';
        primary.classList.add('primary');
        secondary.textContent = '■ 结束';
        secondary.style.display = '';
        break;
    }
  }
}
