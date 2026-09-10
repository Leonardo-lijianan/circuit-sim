// src/ui/PanelManager.ts

import type { ComponentLoader } from '../loader/ComponentLoader';
import type { PendingAction, ComponentInstance } from '../types';
import type { InteractionManager } from '../interaction/InteractionManager';  // ← Task 3.4 新增

export type PanelMode = 'library' | 'params' | 'empty';

export class PanelManager {
  private panelContent: HTMLElement;
  private panelIcon: HTMLElement;
  private panelTitle: HTMLElement;
  private loader: ComponentLoader;
  private interaction: InteractionManager | null = null;  // ← 新增

  constructor(loader: ComponentLoader) {
    this.loader = loader;

    const content = document.getElementById('panelContent');
    const icon = document.getElementById('panelIcon');
    const title = document.getElementById('panelTitle');

    if (!content) throw new Error('PanelManager: #panelContent not found');
    if (!icon) throw new Error('PanelManager: #panelIcon not found');
    if (!title) throw new Error('PanelManager: #panelTitle not found');

    this.panelContent = content;
    this.panelIcon = icon;
    this.panelTitle = title;

    // 默认显示元件库
    this.showLibrary();
  }

  // ← 新增：设置 InteractionManager 引用 (Task 3.4)
  setInteraction(interaction: InteractionManager): void {
    this.interaction = interaction;
    // 监听 pending 变化，更新高亮
   this.interaction.onPendingChange((pending) => {
     this.updateActiveItem(pending);
   });
  }

  /**
  * 根据 pending 更新元件库条目的高亮状态
  */
 private updateActiveItem(pending: PendingAction): void {
   // 清除所有条目的 active
   const items = this.panelContent.querySelectorAll('.library-item');
   items.forEach((el) => el.classList.remove('active'));

   // 如果当前是 place pending，给对应条目加 active
   if (pending?.kind === 'place') {
     const target = this.panelContent.querySelector(
       `.library-item[data-type="${pending.type}"]`
     );
     target?.classList.add('active');
   }
 }

  /**
   * 显示元件库
   */
  showLibrary(): void {
    this.panelIcon.textContent = '📦';
    this.panelTitle.textContent = '元件库';
    this.panelContent.innerHTML = '';

    const defs = this.loader.getAllDefinitions();

    if (defs.length === 0) {
      this.panelContent.innerHTML = `<div class="library-empty">暂无元件</div>`;
      return;
    }

    // 为每个元件生成一个条目
    for (const def of defs) {
      const item = document.createElement('div');
      item.className = 'library-item';
      item.dataset.type = def.name;

      // 尝试加载 fix.svg 作为预览图标
      const fixImg = this.loader.getFixImage(def.name);
      if (fixImg) {
        // 创建一个小图标
        const img = document.createElement('img');
        img.src = fixImg.src;
        img.alt = def.label;
        img.style.width = '28px';
        img.style.height = '28px';
        img.style.objectFit = 'contain';
        item.appendChild(img);
      } else {
        // 占位图标
        const placeholder = document.createElement('span');
        placeholder.textContent = '🔲';
        placeholder.style.fontSize = '24px';
        item.appendChild(placeholder);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = def.label;
      item.appendChild(nameSpan);

      // 显示引脚数量
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${def.pins.length}pin`;
      item.appendChild(badge);

      // ★ 点击元件条目 → 进入 Place 模式 （Task 3.4）
      item.addEventListener('click', () => {
        if (this.interaction) {
          // 设置待放置类型
          this.interaction.setPending({ kind: 'place', type: def.name });
          this.interaction.setMode('place');
          console.log(`📦 放置模式: ${def.label} (${def.name})`);
        } else {
          console.warn('⚠️ InteractionManager 未设置');
        }
      });

      this.panelContent.appendChild(item);
    }
  }

  /**
   * 显示参数面板（Phase 3/7 实现）
   */
  showParams(comp: ComponentInstance): void {
    this.panelIcon.textContent = '🔧';
    this.panelTitle.textContent = '参数面板';
    this.panelContent.innerHTML = '';

    // TODO: Phase 7 - 动态生成参数表单
    // 目前显示占位信息
    const def = this.loader.getDefinition(comp.type);
    this.panelContent.innerHTML = `
      <div class="param-info">
        <div style="margin-bottom: 8px; color: #cdd6f4;">
          <strong>${def?.label || comp.type}</strong>
        </div>
        <div style="font-size: 13px; color: #6c7086; margin-bottom: 4px;">
          元件 ID: <span class="highlight">${comp.id}</span>
        </div>
        <div style="font-size: 13px; color: #6c7086;">
          状态: <span class="highlight">${comp.state}</span>
        </div>
        <hr class="param-divider" />
        <div style="font-size: 13px; color: #6c7086; text-align: center; padding: 12px 0;">
          ⚙️ 参数面板将在 Phase 7 实现
        </div>
      </div>
    `;
  }

  /**
   * 清空面板
   */
  showEmpty(): void {
    this.panelIcon.textContent = '📭';
    this.panelTitle.textContent = '空';
    this.panelContent.innerHTML = `<div class="panel-hint">无内容</div>`;
  }

  /**
   * 根据选中状态切换面板
   * Phase 3 会用到
   */
  update(selectedId: number | null, components: ComponentInstance[]): void {
    if (selectedId === null) {
      this.showLibrary();
      return;
    }

    const comp = components.find(c => c.id === selectedId);
    if (comp) {
      this.showParams(comp);
    } else {
      this.showLibrary();
    }
  }
}