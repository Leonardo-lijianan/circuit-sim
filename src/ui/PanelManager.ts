// src/ui/PanelManager.ts

import type { ComponentLoader } from '../loader/ComponentLoader';
import type { PendingAction, ComponentInstance, Selection } from '../types';
import type { InteractionManager } from '../interaction/InteractionManager';  // ← Task 3.4 新增
import { ParamForm } from './ParamForm';

export type PanelMode = 'library' | 'params' | 'empty';

/**
 * 格式化电气数值：小于阈值时自动换算为 m 单位（mV / mA / mW）
 */
function formatValue(value: number | undefined, mainUnit: string, milliThreshold: number): string {
  if (value === undefined || value === null || !isFinite(value)) return '—';
  if (Math.abs(value) < milliThreshold) {
    return `${(value * 1000).toFixed(3)} m${mainUnit}`;
  }
  return `${value.toFixed(3)} ${mainUnit}`;
}

export class PanelManager {
  private panelContent: HTMLElement;
  private panelIcon: HTMLElement;
  private panelTitle: HTMLElement;
  private loader: ComponentLoader;
  private interaction: InteractionManager | null = null;  // ← 新增
  // 缓存上次的选择状态，避免 onUpdate 每帧都重建 DOM
  private lastSelectionKey: string | null = null;
  // 参数修改回调（由 main.ts 注入，避免直接依赖 CircuitManager）
  private paramChangeHandler: ((compId: number, paramId: string, value: any) => void) | null = null;
  // 当前显示的表单实例（Task 6.2 会用来同步外部更新）
  private currentForm: ParamForm | null = null;
  // 当前正在显示参数面板的元件 id（Task 6.3）
  private currentCompId: number | null = null;
  // 电气数据文字节点缓存（Task 6.3，只更新文字不重建 DOM）
  private electricalEls: {
    voltage: HTMLElement | null;
    current: HTMLElement | null;
    power: HTMLElement | null;
  } = { voltage: null, current: null, power: null };
  // 顶部「ID · 状态」文字节点缓存（Task 7.1 修复：状态同步）
  private headerInfoEl: HTMLElement | null = null;

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

  /**
   * 注入参数修改回调（Task 6.1）
   * 由 main.ts 提供，内部转给 CircuitManager.updateParam
   */
  setParamChangeHandler(
    handler: (compId: number, paramId: string, value: any) => void
  ): void {
    this.paramChangeHandler = handler;
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
   * 显示参数面板（Task 6.1）
   */
  showParams(comp: ComponentInstance): void {
    this.panelIcon.textContent = '🔧';
    this.panelTitle.textContent = '参数面板';
    this.panelContent.innerHTML = '';
    this.currentForm = null;
    this.currentCompId = comp.id;
    this.electricalEls = { voltage: null, current: null, power: null };
    this.headerInfoEl = null;

    const def = this.loader.getDefinition(comp.type);
    if (!def) {
      this.panelContent.innerHTML = `<div class="panel-hint">未找到元件定义</div>`;
      return;
    }

    // 顶部：元件名称 + ID + 状态
    const header = document.createElement('div');
    header.className = 'param-header';

    const labelLine = document.createElement('div');
    labelLine.className = 'param-header-label';
    labelLine.textContent = def.label;
    header.appendChild(labelLine);

    const infoLine = document.createElement('div');
    infoLine.className = 'param-header-info';
    infoLine.textContent = `ID: ${comp.id} · 状态: ${comp.state}`;
    header.appendChild(infoLine);
    this.headerInfoEl = infoLine;

    this.panelContent.appendChild(header);

    // 分隔线
    const hr = document.createElement('hr');
    hr.className = 'param-divider';
    this.panelContent.appendChild(hr);

    // 电气数据卡片（Task 6.3）
    this.panelContent.appendChild(this.createElectricalBlock(comp));

    // 分隔线
    const hr2 = document.createElement('hr');
    hr2.className = 'param-divider';
    this.panelContent.appendChild(hr2);

    // 参数表单
    const form = new ParamForm(def, comp, {
      onParamChange: (paramId, value) => {
        this.paramChangeHandler?.(comp.id, paramId, value);
      },
    });
    this.currentForm = form;
    this.panelContent.appendChild(form.getElement());
  }

  /**
   * 外部更新参数/状态后的同步（Task 6.2 + 7.1）
   * - 更新表单控件显示值（如 switch 的 checkbox）
   * - 更新顶部「状态: xxx」文字（如 LED 从 off → on）
   */
  refreshParams(comp: ComponentInstance): void {
    if (this.currentForm) {
      this.currentForm.updateValues(comp);
    }
    if (this.headerInfoEl) {
      const text = `ID: ${comp.id} · 状态: ${comp.state}`;
      if (this.headerInfoEl.textContent !== text) {
        this.headerInfoEl.textContent = text;
      }
    }
  }

  /**
   * 更新电气数据显示（Task 6.3）
   * 由 main.ts 的 onOutput 回调调用；只改文字，不重建 DOM
   */
  updateElectrical(comp: ComponentInstance): void {
    if (this.currentCompId !== comp.id) return;

    const e = comp.electrical;
    if (this.electricalEls.voltage) {
      this.setText(this.electricalEls.voltage, e ? formatValue(e.voltage, 'V', 1) : '—');
    }
    if (this.electricalEls.current) {
      this.setText(this.electricalEls.current, e ? formatValue(e.current, 'A', 0.01) : '—');
    }
    if (this.electricalEls.power) {
      this.setText(this.electricalEls.power, e ? formatValue(e.power, 'W', 0.01) : '—');
    }
  }

  /**
   * 创建电气数据卡片（内部使用）
   */
  private createElectricalBlock(comp: ComponentInstance): HTMLElement {
    const block = document.createElement('div');
    block.className = 'electrical-block';

    const makeRow = (label: string, key: 'voltage' | 'current' | 'power', text: string): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'electrical-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'label';
      labelEl.textContent = label;
      row.appendChild(labelEl);

      const valueEl = document.createElement('span');
      valueEl.className = 'value';
      valueEl.textContent = text;
      row.appendChild(valueEl);

      this.electricalEls[key] = valueEl;
      return row;
    };

    const e = comp.electrical;
    block.appendChild(makeRow('电压', 'voltage', e ? formatValue(e.voltage, 'V', 1) : '—'));
    block.appendChild(makeRow('电流', 'current', e ? formatValue(e.current, 'A', 0.01) : '—'));
    block.appendChild(makeRow('功率', 'power', e ? formatValue(e.power, 'W', 0.01) : '—'));

    return block;
  }

  /**
   * 更新文字节点（若内容不同才写入，避免不必要的重排）
   */
  private setText(el: HTMLElement, text: string): void {
    if (el.textContent !== text) {
      el.textContent = text;
    }
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
   * 根据选择状态切换面板
   * 
   * - 无选择 → 元件库
   * - 选中元件 → 参数面板
   * - 选中电线 / 其他 → 元件库（暂不支持电线的参数面板）
   * 
   * 幂等：如果选择状态未变，跳过重建，避免 onUpdate 每帧疯狂重建 DOM
   */
  update(selection: Selection | null, components: ComponentInstance[]): void {
    // 唯一 key 用于判断选择是否变化
    const key = selection
      ? `c:${selection.componentIds.join(',')};w:${selection.wireIds.join(',')}`
      : null;
    if (key === this.lastSelectionKey) return;
    this.lastSelectionKey = key;

    // 无选择 → 元件库
    if (
      !selection ||
      (selection.componentIds.length === 0 && selection.wireIds.length === 0)
    ) {
      this.showLibrary();
      return;
    }

    // 单选一个元件 → 参数面板
    if (selection.componentIds.length === 1 && selection.wireIds.length === 0) {
      const comp = components.find(c => c.id === selection.componentIds[0]);
      if (comp) {
        this.showParams(comp);
      } else {
        this.showLibrary();
      }
      return;
    }

    // 多选 → 显示统计
    this.showMultiSelection(selection);
  }

  /**
   * 多选时面板（Task 7.4）
   */
  showMultiSelection(selection: Selection): void {
    this.panelIcon.textContent = '📚';
    this.panelTitle.textContent = '多选';
    this.panelContent.innerHTML = '';
    this.currentForm = null;
    this.currentCompId = null;
    this.electricalEls = { voltage: null, current: null, power: null };
    this.headerInfoEl = null;

    const info = document.createElement('div');
    info.className = 'multi-selection-info';

    const compLine = document.createElement('div');
    compLine.className = 'multi-selection-line';
    compLine.innerHTML = `已选中 <strong>${selection.componentIds.length}</strong> 个元件`;
    info.appendChild(compLine);

    const wireLine = document.createElement('div');
    wireLine.className = 'multi-selection-line';
    wireLine.innerHTML = `已选中 <strong>${selection.wireIds.length}</strong> 条连线`;
    info.appendChild(wireLine);

    const hint = document.createElement('div');
    hint.className = 'multi-selection-hint';
    hint.textContent = '提示：按 D 键两次可删除全部选中';
    info.appendChild(hint);

    this.panelContent.appendChild(info);
  }
}