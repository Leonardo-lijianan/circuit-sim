// src/io/KeyboardManager.ts

import type { InteractionManager } from '../interaction/InteractionManager';

export class KeyboardManager {
  private interaction: InteractionManager;
  private keys: Set<string> = new Set();

  constructor(interaction: InteractionManager) {
    this.interaction = interaction;
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
        this.interaction.setMode('select');
        break;
      case '2':
        this.interaction.setMode('wire');
        break;
      case '3':
        this.interaction.setMode('place');
        break;
      case 'Escape':
        if (this.interaction.isPending()) {
          this.interaction.clearPending();
        }
        this.interaction.setMode('select');
        break;
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
    if (event.key === ' ' && this.keys.has('Space')) {
      this.keys.delete('Space');
      // 预留：释放 Pan
      // this.interaction.setMode('select');
    }
  }
}