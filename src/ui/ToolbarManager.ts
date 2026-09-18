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
}
