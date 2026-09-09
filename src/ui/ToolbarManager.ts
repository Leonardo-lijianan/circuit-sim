// src/ui/ToolbarManager.ts

import type { Mode } from '../types';
import type { InteractionManager } from '../interaction/InteractionManager';

export class ToolbarManager {
  private interaction: InteractionManager;

  constructor(interaction: InteractionManager) {
    this.interaction = interaction;

    // 绑定模式按钮
    this.bindModeButtons();

    // 注册模式变化回调（更新高亮）
    this.interaction.onModeChange((mode) => this.updateModeUI(mode));
  }

  private bindModeButtons(): void {
    document.querySelectorAll('.mode-group button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as Mode;
        if (mode) this.interaction.setMode(mode);
      });
    });
  }

  private updateModeUI(mode: Mode): void {
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
  }
}