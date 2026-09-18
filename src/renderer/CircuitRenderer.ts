// src/renderer/CircuitRenderer.ts

import type { ComponentLoader } from '../loader/ComponentLoader';
import type { Circuit, ComponentInstance, FlexUnitCache, PinRef } from '../types';
import type { Viewport } from '../utils/coordinates';
import type { SVGCommand } from '../loader/SVGParser';

export class CircuitRenderer {
  private ctx: CanvasRenderingContext2D;
  private loader: ComponentLoader;
  //private viewport: Viewport;

  constructor(
    ctx: CanvasRenderingContext2D,
    loader: ComponentLoader,
    // viewport: Viewport
  ) {
    this.ctx = ctx;
    this.loader = loader;
    // this.viewport = viewport;
  }

  render(
    circuit: Circuit,
    width: number,
    height: number,
    viewport: Viewport,
    overlays?: {
      place?: { type: string; x: number; y: number };
      wire?: { startX: number; startY: number; endX: number; endY: number; snapped: boolean };
      hoverPin?: PinRef;
    }
  ): void {
    const ctx = this.ctx;

    // 1. 清屏（屏幕坐标系）
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, width, height);

    // 2. 应用视口变换
    ctx.save();
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.scale, viewport.scale);

    // 3. 绘制内容（逻辑坐标系）
    this.drawGrid(width, height, viewport);
    this.drawWires(circuit);
    this.drawFixLayers(circuit);
    this.drawFlexLayers(circuit);
    if (overlays?.place) this.drawPreview(overlays.place);
    if (overlays?.wire) this.drawTempWire(overlays.wire);
    else if (overlays?.hoverPin) this.drawHoverPin(overlays.hoverPin, circuit);
    this.drawOverlay(circuit);

    ctx.restore();
  }

  private drawGrid(width: number, height: number, viewport: Viewport): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#313244';
    // 线宽按 scale 反缩放，保证视觉粗细恒定
    ctx.lineWidth = 0.5 / viewport.scale;

    const gridSize = 20;

    // 屏幕可视区域对应的逻辑坐标范围
    const logicLeft = (0 - viewport.offsetX) / viewport.scale;
    const logicTop = (0 - viewport.offsetY) / viewport.scale;
    const logicRight = (width - viewport.offsetX) / viewport.scale;
    const logicBottom = (height - viewport.offsetY) / viewport.scale;

    // 对齐到网格边界
    const startX = Math.floor(logicLeft / gridSize) * gridSize;
    const startY = Math.floor(logicTop / gridSize) * gridSize;
    const endX = Math.ceil(logicRight / gridSize) * gridSize;
    const endY = Math.ceil(logicBottom / gridSize) * gridSize;

    for (let x = startX; x <= endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }
  }

  private drawWires(circuit: Circuit): void {
    const ctx = this.ctx;
    for (const wire of circuit.wires) {
      const start = this.getPinWorldPos(wire.startComponentId, wire.startPinId, circuit.components);
      const end = this.getPinWorldPos(wire.endComponentId, wire.endPinId, circuit.components);
      if (!start || !end) continue;

      ctx.strokeStyle = '#a6adc8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.fillStyle = '#a6adc8';
      ctx.beginPath();
      ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawOneFix(comp: ComponentInstance): void {
    const fixImg = this.loader.getFixImage(comp.type);
    if (fixImg) {
      this.ctx.drawImage(fixImg, comp.x, comp.y, comp.w, comp.h);
    }
  }

  private drawFixLayers(circuit: Circuit): void {
    for (const comp of circuit.components) {
      this.drawOneFix(comp);
    }
  }

  private drawOneFlex(comp: ComponentInstance): void {
    const def = this.loader.getDefinition(comp.type);
    if (!def?.flex) return;
    const stateKey = comp.state || def.visual.default_state || 'default';
    const state = def.visual.states[stateKey];
    if (!state) return;
    for (const [unitId] of Object.entries(def.flex.units)) {
      const flexUnit = this.loader.getFlexUnit(comp.type, unitId);
      if (!flexUnit) continue;
      const partParams = state.parts?.[unitId] || {};
      this.drawFlexUnit(this.ctx, comp, flexUnit, partParams);
    }
  }

  private drawFlexLayers(circuit: Circuit): void {
    for (const comp of circuit.components) {
      this.drawOneFlex(comp);
    }
  }

  private drawFlexUnit(
    ctx: CanvasRenderingContext2D,
    comp: ComponentInstance,
    flexUnit: FlexUnitCache,
    partParams: {
      opacity?: number;
      color?: string;
      rotation?: number;
      rotationAnchor?: [number, number];
      offsetX?: number;
      offsetY?: number;
    }
  ): void {
    const { commands, viewBox } = flexUnit;
    const { vw, vh } = viewBox;
    const scaleX = comp.w / vw;
    const scaleY = comp.h / vh;

    // 处理旋转（整体变换）
    const rotation = partParams.rotation || 0;
    if (rotation !== 0) {
      ctx.save();

      // 旋转轴：默认 viewBox 中心，可通过 rotationAnchor 指定
      const anchorVb = partParams.rotationAnchor || [vw / 2, vh / 2];
      const cx = comp.x + anchorVb[0] * scaleX;
      const cy = comp.y + anchorVb[1] * scaleY;

      ctx.translate(cx, cy);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.translate(-cx, -cy);
      this.executeCommands(ctx, comp, commands, scaleX, scaleY, partParams);
      ctx.restore();
    } else {
      this.executeCommands(ctx, comp, commands, scaleX, scaleY, partParams);
    }
  }

  private drawPreview(preview: { type: string; x: number; y: number }): void {
    const ctx = this.ctx;
    const def = this.loader.getDefinition(preview.type);
    if (!def) return;

    const w = 60;
    const h = 40;

    // 构造一个临时的 ComponentInstance
    const fakeComp: ComponentInstance = {
      id: -1,
      type: preview.type,
      x: preview.x,
      y: preview.y,
      w,
      h,
      params: {},
      state: def.visual.default_state || 'default',
    };

    // 半透明绘制
    ctx.save();
    ctx.globalAlpha = 0.5;
    this.drawOneFix(fakeComp);
    this.drawOneFlex(fakeComp);
    ctx.restore();

    // 蓝色虚线边框
    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(preview.x - 2, preview.y - 2, w + 4, h + 4);
    ctx.setLineDash([]);
    ctx.restore();
  }

  /**
   * 绘制临时连线（Wire 模式）
   */
  private drawTempWire(wire: { startX: number; startY: number; endX: number; endY: number; snapped: boolean }): void {
    const ctx = this.ctx;

    ctx.save();

    // 虚线
    ctx.strokeStyle = '#a6adc8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(wire.startX, wire.startY);
    ctx.lineTo(wire.endX, wire.endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 起点圆点
    ctx.fillStyle = '#a6adc8';
    ctx.beginPath();
    ctx.arc(wire.startX, wire.startY, 4, 0, Math.PI * 2);
    ctx.fill();

    // 磁吸目标：放大高亮圈
    if (wire.snapped) {
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(wire.endX, wire.endY, 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制悬停引脚高亮（小圈）
   */
  private drawHoverPin(pinRef: PinRef, circuit: Circuit): void {
    const comp = circuit.components.find(c => c.id === pinRef.componentId);
    if (!comp) return;
    const def = this.loader.getDefinition(comp.type);
    if (!def) return;
    const pin = def.pins.find(p => p.id === pinRef.pinId);
    if (!pin) return;

    const ctx = this.ctx;
    const pinX = comp.x + pin.x;
    const pinY = comp.y + pin.y;

    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pinX, pinY, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 层 5：覆盖层（选中高亮）
   */
  private drawOverlay(circuit: Circuit): void {
    const sel = circuit.selection;
    if (!sel) return;

    if (sel.kind === 'component') {
      const comp = circuit.components.find(c => c.id === sel.id);
      if (comp) this.drawSelection(comp);
    } else if (sel.kind === 'wire') {
      const wire = circuit.wires.find(w => w.id === sel.id);
      if (wire) this.drawWireSelection(wire, circuit.components);
    }
  }

  /**
   * 绘制电线选中高亮：线条整体变蓝，粗细不变
   * 与元件选中的蓝色虚线框语义一致（蓝色 = 选中）
   */
  private drawWireSelection(wire: import('../types').Wire, components: ComponentInstance[]): void {
    const start = this.getPinWorldPos(wire.startComponentId, wire.startPinId, components);
    const end = this.getPinWorldPos(wire.endComponentId, wire.endPinId, components);
    if (!start || !end) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';

    // 线条变蓝（粗细、端点大小与原线完全一致）
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    // 端点圆点也变蓝
    ctx.fillStyle = '#89b4fa';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * 绘制选中高亮：蓝色虚线框 + 四角锚点
   */
  private drawSelection(comp: ComponentInstance): void {
    const ctx = this.ctx;
    const pad = 4;
    const s = 6;

    ctx.save();

    // 1. 蓝色虚线框
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      comp.x - pad,
      comp.y - pad,
      comp.w + pad * 2,
      comp.h + pad * 2
    );
    ctx.setLineDash([]);

    // 2. 四角锚点
    ctx.fillStyle = '#89b4fa';
    const corners = [
      [comp.x, comp.y],
      [comp.x + comp.w, comp.y],
      [comp.x, comp.y + comp.h],
      [comp.x + comp.w, comp.y + comp.h],
    ];
    for (const [x, y] of corners) {
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    ctx.restore();
  }

  private executeCommands(
    ctx: CanvasRenderingContext2D,
    comp: ComponentInstance,
    commands: SVGCommand[],
    scaleX: number,
    scaleY: number,
    partParams: { opacity?: number; color?: string; offsetX?: number; offsetY?: number }
  ): void {
    const offsetX = partParams.offsetX || 0;
    const offsetY = partParams.offsetY || 0;

    for (const cmd of commands) {
      const color = partParams.color || cmd.fill;
      const opacity = partParams.opacity !== undefined ? partParams.opacity : cmd.opacity;

      ctx.save();
      ctx.globalAlpha = opacity;

      switch (cmd.type) {
        case 'circle': {
          const cx = comp.x + (cmd.cx ?? 0) * scaleX + offsetX;
          const cy = comp.y + (cmd.cy ?? 0) * scaleY + offsetY;
          const r = (cmd.r ?? 0) * Math.min(scaleX, scaleY);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fill();
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1) * Math.min(scaleX, scaleY);
            ctx.stroke();
          }
          break;
        }
        case 'rect': {
          const x = comp.x + (cmd.x ?? 0) * scaleX + offsetX;
          const y = comp.y + (cmd.y ?? 0) * scaleY + offsetY;
          const w = (cmd.w ?? 0) * scaleX;
          const h = (cmd.h ?? 0) * scaleY;
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, w, h);
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1) * Math.min(scaleX, scaleY);
            ctx.strokeRect(x, y, w, h);
          }
          break;
        }
        case 'path': {
          // 路径需要缩放和偏移，用 transform
          ctx.save();
          ctx.translate(comp.x + offsetX, comp.y + offsetY);
          ctx.scale(scaleX, scaleY);
          const path = new Path2D(cmd.d ?? '');
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fill(path);
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1);
            ctx.stroke(path);
          }
          ctx.restore();
          break;
        }
        case 'polygon': {
          const pts = cmd.points ?? [];
          if (pts.length < 6) break;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) {
            const px = comp.x + pts[i] * scaleX + offsetX;
            const py = comp.y + pts[i + 1] * scaleY + offsetY;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          if (color && color !== 'none') {
            ctx.fillStyle = color;
            ctx.fill();
          }
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1) * Math.min(scaleX, scaleY);
            ctx.stroke();
          }
          break;
        }
        case 'line': {
          const x1 = comp.x + (cmd.x1 ?? 0) * scaleX + offsetX;
          const y1 = comp.y + (cmd.y1 ?? 0) * scaleY + offsetY;
          const x2 = comp.x + (cmd.x2 ?? 0) * scaleX + offsetX;
          const y2 = comp.y + (cmd.y2 ?? 0) * scaleY + offsetY;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          if (cmd.stroke && cmd.stroke !== 'none') {
            ctx.strokeStyle = cmd.stroke;
            ctx.lineWidth = (cmd.strokeWidth || 1) * Math.min(scaleX, scaleY);
            ctx.stroke();
          }
          break;
        }
      }
      ctx.restore();
    }
  }

  private getPinWorldPos(
    compId: number,
    pinId: string,
    components: ComponentInstance[]
  ): { x: number; y: number } | null {
    const comp = components.find(c => c.id === compId);
    if (!comp) return null;
    const def = this.loader.getDefinition(comp.type);
    if (!def) return null;
    const pin = def.pins.find(p => p.id === pinId);
    if (!pin) return null;
    return { x: comp.x + pin.x, y: comp.y + pin.y };
  }
}