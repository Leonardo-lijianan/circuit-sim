// src/manager/CircuitManager.ts

import type { ComponentInstance, Wire, Circuit, PinRef, Selection } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';

export class CircuitManager {
  private components: ComponentInstance[] = [];
  private wires: Wire[] = [];
  private selection: Selection | null = null;
  private nextId: number = 1;
  private nextWireId: number = 1;
  private loader: ComponentLoader;
  private onUpdateCallback?: (circuit: Circuit) => void;
  private onMessageCallback?: (msg: string) => void;

  constructor(loader: ComponentLoader) {
    this.loader = loader;
  }

  /**
   * 注册消息通知回调（供 UI 层展示提示）
   */
  onMessage(callback: (msg: string) => void): void {
    this.onMessageCallback = callback;
  }

  private notify(msg: string): void {
    this.onMessageCallback?.(msg);
  }

  // ============================================================
  // 数据查询
  // ============================================================

  getComponents(): ComponentInstance[] {
    return this.components;
  }

  getWires(): Wire[] {
    return this.wires;
  }

  getCircuit(): Circuit {
    return {
      components: this.components,
      wires: this.wires,
      selection: this.selection,
    };
  }

  getComponent(id: number): ComponentInstance | undefined {
    return this.components.find(c => c.id === id);
  }

  getWire(id: number): Wire | undefined {
    return this.wires.find(w => w.id === id);
  }

  // ---- 选择：统一 API ----
  select(sel: Selection | null): void {
    // 规范化：空数组 → null
    if (sel && sel.componentIds.length === 0 && sel.wireIds.length === 0) {
      this.selection = null;
    } else {
      this.selection = sel;
    }
    this.triggerUpdate();
  }

  getSelection(): Selection | null {
    return this.selection;
  }

  isSelected(kind: 'component' | 'wire', id: number): boolean {
    if (!this.selection) return false;
    if (kind === 'component') return this.selection.componentIds.includes(id);
    return this.selection.wireIds.includes(id);
  }

  /**
   * 删除当前选择（所有选中元件和电线）
   */
  deleteSelection(): void {
    if (!this.selection) return;
    const compIds = [...this.selection.componentIds];
    const wireIds = [...this.selection.wireIds];

    // 先删独立选中的电线
    for (const id of wireIds) this.removeWire(id);
    // 再删元件（元件删除会级联删关联电线）
    for (const id of compIds) this.removeComponent(id);
  }

  // ---- 选择：语法糖（单选，会清空其他选择） ----
  selectComponent(id: number | null): void {
    if (id === null) {
      this.select(null);
    } else {
      this.select({ componentIds: [id], wireIds: [] });
    }
  }

  selectWire(id: number | null): void {
    if (id === null) {
      this.select(null);
    } else {
      this.select({ componentIds: [], wireIds: [id] });
    }
  }

  // ---- 选择：多选 ----
  selectMany(componentIds: number[], wireIds: number[] = []): void {
    if (componentIds.length === 0 && wireIds.length === 0) {
      this.select(null);
    } else {
      this.select({
        componentIds: [...componentIds],
        wireIds: [...wireIds],
      });
    }
  }

  /**
   * 获取选中元件的实例（仅当恰好选中 1 个元件时返回，否则 null）
   * 用于参数面板
   */
  getSelected(): ComponentInstance | null {
    if (!this.selection) return null;
    if (this.selection.componentIds.length !== 1 || this.selection.wireIds.length !== 0) {
      return null;
    }
    return this.getComponent(this.selection.componentIds[0]) || null;
  }

  /**
   * 获取所有选中元件实例
   */
  getSelectedComponents(): ComponentInstance[] {
    if (!this.selection) return [];
    return this.selection.componentIds
      .map(id => this.getComponent(id))
      .filter((c): c is ComponentInstance => !!c);
  }

  /**
   * 获取所有选中电线实例
   */
  getSelectedWires(): Wire[] {
    if (!this.selection) return [];
    return this.selection.wireIds
      .map(id => this.getWire(id))
      .filter((w): w is Wire => !!w);
  }

  getWiresForComponent(compId: number): Wire[] {
    return this.wires.filter(
      w => w.startComponentId === compId || w.endComponentId === compId
    );
  }

  // ============================================================
  // 元件操作
  // ============================================================

  addComponent(type: string, x: number, y: number): ComponentInstance | null {
    const def = this.loader.getDefinition(type);
    if (!def) {
      this.notify(`未知元件类型: ${type}`);
      return null;
    }

    const w = 60;
    const h = 40;

    const comp: ComponentInstance = {
      id: this.nextId++,
      type,
      x,
      y,
      w,
      h,
      rotation: 0,
      params: this.getDefaultParams(def),
      state: def.visual.default_state || 'default',
    };

    this.components.push(comp);
    this.selectComponent(comp.id);
    this.triggerUpdate();
    return comp;
  }

  removeComponent(id: number): void {
    const relatedWires = this.getWiresForComponent(id);
    if (relatedWires.length > 0) {
      const wireIds = relatedWires.map(w => w.id);
      this.wires = this.wires.filter(w => !wireIds.includes(w.id));
      this.notify(`已删除 ${relatedWires.length} 条关联连线`);
    }

    this.components = this.components.filter(c => c.id !== id);

    // 从选择列表中移除
    if (this.selection) {
      this.selection.componentIds = this.selection.componentIds.filter(cid => cid !== id);
      if (this.selection.componentIds.length === 0 && this.selection.wireIds.length === 0) {
        this.selection = null;
      }
    }

    this.triggerUpdate();
  }

  moveComponent(id: number, x: number, y: number): void {
    const comp = this.getComponent(id);
    if (!comp) return;
    comp.x = x;
    comp.y = y;
    this.triggerUpdate();
  }

  /**
   * 批量移动（多选拖拽，Task 7.4）
   */
  moveComponents(moves: { id: number; x: number; y: number }[]): void {
    for (const m of moves) {
      const comp = this.getComponent(m.id);
      if (comp) {
        comp.x = m.x;
        comp.y = m.y;
      }
    }
    this.triggerUpdate();
  }

  /**
   * 用外部电路替换当前电路（用于导入）
   *
   * - 重置 selection
   * - 重算 nextId / nextWireId（避免与现有 id 冲突）
   */
  loadCircuit(circuit: Circuit): void {
    this.components = circuit.components;
    this.wires = circuit.wires;
    this.selection = null;

    const maxCompId = circuit.components.reduce((m, c) => Math.max(m, c.id), 0);
    const maxWireId = circuit.wires.reduce((m, w) => Math.max(m, w.id), 0);
    this.nextId = maxCompId + 1;
    this.nextWireId = maxWireId + 1;

    this.triggerUpdate();
  }

  /**
   * 清空所有元件和连线
   */
  clearCircuit(): void {
    this.components = [];
    this.wires = [];
    this.selection = null;
    this.nextId = 1;
    this.nextWireId = 1;
    this.triggerUpdate();
  }

  /**
   * 旋转选中元件 90°
   *
   * 返回新的旋转角度；如果不是元件或旋转失败则返回 null
   */
  rotateComponent(id: number, delta: number = 90): number | null {
    const comp = this.getComponent(id);
    if (!comp) return null;
    const current = comp.rotation || 0;
    comp.rotation = ((current + delta) % 360 + 360) % 360;
    this.triggerUpdate();
    return comp.rotation;
  }

  /**
   * 切换可交互元件的状态（目前仅支持 switch）
   * 
   * 约定：
   *   - 参数 `closed: boolean`
   *   - state 为 'on' / 'off'
   * 
   * 返回是否成功切换
   */
  toggleComponent(id: number): boolean {
    const comp = this.getComponent(id);
    if (!comp) return false;
    if (typeof comp.params.closed !== 'boolean') return false;

    comp.params.closed = !comp.params.closed;
    this.syncStateFromParams(comp);
    this.triggerUpdate();
    return true;
  }

  /**
   * 根据 params 同步 state（参数 → 状态 的约定）
   *
   * 目前约定：
   *   - 若元件有 boolean 参数 closed → state = closed ? 'on' : 'off'
   *
   * 后续如果有更多可交互元件，可扩展此方法。
   */
  private syncStateFromParams(comp: ComponentInstance): void {
    if (typeof comp.params.closed === 'boolean') {
      comp.state = comp.params.closed ? 'on' : 'off';
    }
  }

  // ============================================================
  // 连线操作
  // ============================================================

  addWire(start: PinRef, end: PinRef): Wire | null {
    if (start.componentId === end.componentId && start.pinId === end.pinId) {
      this.notify('不能连接到同一个引脚');
      return null;
    }

    // 同一元件的两个不同引脚被短接 → 允许但警告
    if (start.componentId === end.componentId) {
      this.notify('警告：同一元件的两引脚被短接');
    }

    const exists = this.wires.some(
      w =>
        (w.startComponentId === start.componentId && w.startPinId === start.pinId &&
         w.endComponentId === end.componentId && w.endPinId === end.pinId) ||
        (w.startComponentId === end.componentId && w.startPinId === end.pinId &&
         w.endComponentId === start.componentId && w.endPinId === start.pinId)
    );
    if (exists) {
      this.notify('该连线已存在');
      return null;
    }

    const wire: Wire = {
      id: this.nextWireId++,
      startComponentId: start.componentId,
      startPinId: start.pinId,
      endComponentId: end.componentId,
      endPinId: end.pinId,
    };

    this.wires.push(wire);
    this.triggerUpdate();
    return wire;
  }

  removeWire(id: number): void {
    this.wires = this.wires.filter(w => w.id !== id);

    // 从选择列表中移除
    if (this.selection) {
      this.selection.wireIds = this.selection.wireIds.filter(wid => wid !== id);
      if (this.selection.componentIds.length === 0 && this.selection.wireIds.length === 0) {
        this.selection = null;
      }
    }

    this.triggerUpdate();
  }

  // ============================================================
  // 参数操作
  // ============================================================

  updateParam(compId: number, paramId: string, value: any): void {
    const comp = this.getComponent(compId);
    if (!comp) return;
    comp.params[paramId] = value;
    this.syncStateFromParams(comp);
    this.triggerUpdate();
  }

  // ============================================================
  // 事件通知
  // ============================================================

  onUpdate(callback: (circuit: Circuit) => void): void {
    this.onUpdateCallback = callback;
  }

  forceUpdate(): void {
    this.triggerUpdate();
  }

  private triggerUpdate(): void {
    if (this.onUpdateCallback) {
      this.onUpdateCallback(this.getCircuit());
    }
  }

  // ============================================================
  // 私有工具
  // ============================================================

  private getDefaultParams(def: any): Record<string, any> {
    const params: Record<string, any> = {};
    for (const p of def.params) {
      params[p.id] = p.default;
    }
    return params;
  }
}