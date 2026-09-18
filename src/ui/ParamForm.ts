// src/ui/ParamForm.ts

import type { ComponentDefinition, ComponentInstance, ParamDefinition } from '../types';

export interface ParamFormOptions {
  onParamChange: (paramId: string, value: any) => void;
}

/**
 * ParamForm
 *
 * 根据 meta.json 的 params 定义动态生成表单控件。
 *
 * 支持的控件类型：
 *   - number  : input[type=number]（带 min/max/step）
 *   - boolean : checkbox
 *   - select  : select 下拉框
 *   - string  : input[type=text]
 */
export class ParamForm {
  private element: HTMLElement;
  private inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

  constructor(
    private def: ComponentDefinition,
    private comp: ComponentInstance,
    private options: ParamFormOptions
  ) {
    this.element = document.createElement('div');
    this.element.className = 'param-form';
    this.render();
  }

  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * 同步外部修改的显示值（不重建 DOM）
   * 用于 switch 状态切换、控制台改参数等场景
   */
  updateValues(comp: ComponentInstance): void {
    this.comp = comp;
    for (const paramDef of this.def.params) {
      const input = this.inputs.get(paramDef.id);
      if (!input) continue;
      const value = comp.params[paramDef.id];

      if (input instanceof HTMLInputElement) {
        if (input.type === 'checkbox') {
          input.checked = Boolean(value);
        } else {
          input.value = value != null ? String(value) : '';
        }
      } else if (input instanceof HTMLSelectElement) {
        input.value = value != null ? String(value) : '';
      }
    }
  }

  private render(): void {
    if (this.def.params.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'param-empty';
      empty.textContent = '该元件无可调参数';
      this.element.appendChild(empty);
      return;
    }

    for (const paramDef of this.def.params) {
      this.element.appendChild(this.createField(paramDef));
    }
  }

  private createField(paramDef: ParamDefinition): HTMLElement {
    const group = document.createElement('div');
    group.className = 'param-group';

    const inputId = `param-${this.comp.id}-${paramDef.id}`;
    const value = this.comp.params[paramDef.id];

    switch (paramDef.type) {
      case 'boolean': {
        // checkbox + label 同行
        const wrapper = document.createElement('label');
        wrapper.className = 'param-checkbox-wrapper';
        wrapper.htmlFor = inputId;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = inputId;
        checkbox.checked = Boolean(value);
        checkbox.addEventListener('change', () => {
          this.options.onParamChange(paramDef.id, checkbox.checked);
        });
        this.inputs.set(paramDef.id, checkbox);

        const text = document.createElement('span');
        text.textContent = paramDef.label;

        wrapper.appendChild(checkbox);
        wrapper.appendChild(text);
        group.appendChild(wrapper);
        break;
      }

      case 'number': {
        const label = document.createElement('label');
        label.className = 'param-label';
        label.htmlFor = inputId;
        label.textContent = paramDef.label;
        group.appendChild(label);

        const input = document.createElement('input');
        input.type = 'number';
        input.id = inputId;
        input.value = value != null ? String(value) : '';
        if (paramDef.min !== undefined) input.min = String(paramDef.min);
        if (paramDef.max !== undefined) input.max = String(paramDef.max);
        if (paramDef.step !== undefined) input.step = String(paramDef.step);

        input.addEventListener('change', () => {
          const v = parseFloat(input.value);
          if (!isNaN(v)) {
            this.options.onParamChange(paramDef.id, v);
          } else {
            // 输入非法 → 恢复显示值
            input.value = String(this.comp.params[paramDef.id] ?? '');
          }
        });
        this.inputs.set(paramDef.id, input);
        group.appendChild(input);
        break;
      }

      case 'select': {
        const label = document.createElement('label');
        label.className = 'param-label';
        label.htmlFor = inputId;
        label.textContent = paramDef.label;
        group.appendChild(label);

        const select = document.createElement('select');
        select.id = inputId;
        for (const opt of paramDef.options || []) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          select.appendChild(option);
        }
        select.value = String(value ?? paramDef.default ?? '');
        select.addEventListener('change', () => {
          this.options.onParamChange(paramDef.id, select.value);
        });
        this.inputs.set(paramDef.id, select);
        group.appendChild(select);
        break;
      }

      case 'string':
      default: {
        const label = document.createElement('label');
        label.className = 'param-label';
        label.htmlFor = inputId;
        label.textContent = paramDef.label;
        group.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.id = inputId;
        input.value = value != null ? String(value) : '';
        input.addEventListener('change', () => {
          this.options.onParamChange(paramDef.id, input.value);
        });
        this.inputs.set(paramDef.id, input);
        group.appendChild(input);
        break;
      }
    }

    return group;
  }
}
