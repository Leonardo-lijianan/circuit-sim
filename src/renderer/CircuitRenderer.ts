// src/renderer/CircuitRenderer.ts

import type { ComponentLoader } from '../loader/ComponentLoader';
import type { Circuit, ComponentInstance, FlexUnitCache, PinRef } from '../types';
import type { Viewport } from '../utils/coordinates';
import type { SVGCommand } from '../loader/SVGParser';
import { getPinWorldPos, getRotatedAABB, getWirePath, getPinDirection } from '../utils/geometry';
import { GRID_SIZE } from '../utils/grid';
import { routeOrthogonal } from '../routing';
import type { Point } from '../utils/geometry';
import type { RectWithId } from '../routing';

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
      marquee?: { x: number; y: number; w: number; h: number };
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
    if (overlays?.marquee) this.drawMarquee(overlays.marquee);

    ctx.restore();
  }

  private drawGrid(width: number, height: number, viewport: Viewport): void {
    const ctx = this.ctx;

    // 屏幕可视区域对应的逻辑坐标范围
    const logicLeft = (0 - viewport.offsetX) / viewport.scale;
    const logicTop = (0 - viewport.offsetY) / viewport.scale;
    const logicRight = (width - viewport.offsetX) / viewport.scale;
    const logicBottom = (height - viewport.offsetY) / viewport.scale;

    // 缩得很远时隐藏细网格，避免屏幕上一片灰
    const drawMinor = viewport.scale >= 0.4;

    // ---------- 1. 细网格（GRID_SIZE = 20px）----------
    if (drawMinor) {
      const startX = Math.floor(logicLeft / GRID_SIZE) * GRID_SIZE;
      const startY = Math.floor(logicTop / GRID_SIZE) * GRID_SIZE;
      const endX = Math.ceil(logicRight / GRID_SIZE) * GRID_SIZE;
      const endY = Math.ceil(logicBottom / GRID_SIZE) * GRID_SIZE;

      ctx.strokeStyle = '#313244';
      ctx.lineWidth = 0.5 / viewport.scale;

      ctx.beginPath();
      for (let x = startX; x <= endX; x += GRID_SIZE) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (let y = startY; y <= endY; y += GRID_SIZE) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();
    }

    // ---------- 2. 粗网格（5 × GRID_SIZE = 100px）----------
    const MAJOR = GRID_SIZE * 5;
    const majorStartX = Math.floor(logicLeft / MAJOR) * MAJOR;
    const majorStartY = Math.floor(logicTop / MAJOR) * MAJOR;
    const majorEndX = Math.ceil(logicRight / MAJOR) * MAJOR;
    const majorEndY = Math.ceil(logicBottom / MAJOR) * MAJOR;

    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 1 / viewport.scale;

    ctx.beginPath();
    for (let x = majorStartX; x <= majorEndX; x += MAJOR) {
      ctx.moveTo(x, majorStartY);
      ctx.lineTo(x, majorEndY);
    }
    for (let y = majorStartY; y <= majorEndY; y += MAJOR) {
      ctx.moveTo(majorStartX, y);
      ctx.lineTo(majorEndX, y);
    }
    ctx.stroke();
  }

  private drawWires(circuit: Circuit): void {
    const ctx = this.ctx;
    for (const wire of circuit.wires) {
      const start = this.getPinWorldPos(wire.startComponentId, wire.startPinId, circuit.components);
      const end = this.getPinWorldPos(wire.endComponentId, wire.endPinId, circuit.components);
      if (!start || !end) continue;

      const path = this.getWirePathCached(wire, circuit, start, end);

      ctx.strokeStyle = '#a6adc8';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();

      // 端点圆点（首尾）
      ctx.fillStyle = '#a6adc8';
      ctx.beginPath();
      ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 获取电线的路由路径（带缓存）
   *
   * 优先用正交避障路由；无解或异常时回退到 Z 字。
   * 计算结果写回 wire.path，下次直接命中缓存。
   */
  private getWirePathCached(
    wire: import('../types').Wire,
    circuit: Circuit,
    start: Point,
    end: Point
  ): Point[] {
    if (wire.path && wire.path.length >= 2) {
      return wire.path;
    }

    const path = this.computeRoute(wire, circuit, start, end);
    wire.path = path;
    return path;
  }

  private computeRoute(
    wire: import('../types').Wire,
    circuit: Circuit,
    start: Point,
    end: Point
  ): Point[] {
    // 1. 查起终点元件 + 定义 + 引脚
    const startComp = circuit.components.find(c => c.id === wire.startComponentId);
    const endComp = circuit.components.find(c => c.id === wire.endComponentId);
    if (!startComp || !endComp) return getWirePath(start, end);

    const startDef = this.loader.getDefinition(startComp.type);
    const endDef = this.loader.getDefinition(endComp.type);
    if (!startDef || !endDef) return getWirePath(start, end);

    const startPin = startDef.pins.find(p => p.id === wire.startPinId);
    const endPin = endDef.pins.find(p => p.id === wire.endPinId);
    if (!startPin || !endPin) return getWirePath(start, end);

    const startDir = getPinDirection(startComp, startPin);
    const endDir = getPinDirection(endComp, endPin);

    // 2. 组装障碍物（所有元件的旋转后 AABB）
    const obstacles: RectWithId[] = circuit.components.map(c => {
      const aabb = getRotatedAABB(c);
      return { id: c.id, x: aabb.x, y: aabb.y, w: aabb.w, h: aabb.h };
    });

    // 3. 正交避障路由
    try {
      const route = routeOrthogonal({
        start,
        startPinDir: startDir,
        startCompId: wire.startComponentId,
        end,
        endPinDir: endDir,
        endCompId: wire.endComponentId,
        obstacles,
        // 安全间距：电线与元件边界保持 12px，避免视觉上"贴边"。
        // 太小（<8）会贴着元件，太大（>20）在窄通道中易无解。
        inflate: 12,
      });
      if (route && route.length >= 2) return route;
    } catch (err) {
      console.warn('⚠️ 路由异常，回退到 Z 字:', err);
    }

    // 4. 兜底：旧 Z 字
    return getWirePath(start, end);
  }

  private drawOneFix(comp: ComponentInstance): void {
    const fixImg = this.loader.getFixImage(comp.type);
    if (fixImg) {
      this.ctx.drawImage(fixImg, comp.x, comp.y, comp.w, comp.h);
    }
  }

  private drawFixLayers(circuit: Circuit): void {
    for (const comp of circuit.components) {
      this.drawWithRotation(comp, () => this.drawOneFix(comp));
    }
  }

  /**
   * 用元件自身的旋转包裹一次绘制
   */
  private drawWithRotation(comp: ComponentInstance, drawFn: () => void): void {
    const rotation = comp.rotation || 0;
    if (rotation === 0) {
      drawFn();
      return;
    }

    const ctx = this.ctx;
    const cx = comp.x + comp.w / 2;
    const cy = comp.y + comp.h / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
    drawFn();
    ctx.restore();
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
      this.drawWithRotation(comp, () => this.drawOneFlex(comp));
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
      rotation: 0,
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
   * 绘制框选矩形（Task 7.4）
   */
  private drawMarquee(box: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.ctx;
    ctx.save();

    // 半透明填充
    ctx.fillStyle = 'rgba(137, 180, 250, 0.15)';
    ctx.fillRect(box.x, box.y, box.w, box.h);

    // 蓝色虚线边框
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);

    ctx.restore();
  }

  /**
   * 绘制临时连线（Wire 模式）
   */
  private drawTempWire(wire: { startX: number; startY: number; endX: number; endY: number; snapped: boolean }): void {
    const ctx = this.ctx;

    ctx.save();

    // 正交路径（Z 字或直线）
    const path = getWirePath(
      { x: wire.startX, y: wire.startY },
      { x: wire.endX, y: wire.endY }
    );

    // 虚线
    ctx.strokeStyle = '#a6adc8';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
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
    const pos = getPinWorldPos(comp, pin);

    ctx.save();
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 层 5：覆盖层（选中高亮）
   */
  private drawOverlay(circuit: Circuit): void {
    const sel = circuit.selection;
    if (!sel) return;

    // 元件选中
    if (sel.componentIds.length === 1) {
      // 单选：单框
      const comp = circuit.components.find(c => c.id === sel.componentIds[0]);
      if (comp) this.drawSelection(comp);
    } else if (sel.componentIds.length > 1) {
      // 多选：统一 AABB
      const comps = sel.componentIds
        .map(id => circuit.components.find(c => c.id === id))
        .filter((c): c is ComponentInstance => !!c);
      if (comps.length > 0) this.drawMultiSelection(comps);
    }

    // 电线选中（可能是多个）
    for (const wid of sel.wireIds) {
      const wire = circuit.wires.find(w => w.id === wid);
      if (wire) this.drawWireSelection(wire, circuit);
    }
  }

  /**
   * 多选：绘制所有选中元件的最小 AABB 虚线框
   */
  private drawMultiSelection(comps: ComponentInstance[]): void {
    const ctx = this.ctx;
    const pad = 0;   // 统一 AABB 也贴合边界
    const s = 3;

    // 1. 计算最小 AABB
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const comp of comps) {
      const aabb = getRotatedAABB(comp);
      minX = Math.min(minX, aabb.x);
      minY = Math.min(minY, aabb.y);
      maxX = Math.max(maxX, aabb.x + aabb.w);
      maxY = Math.max(maxY, aabb.y + aabb.h);
    }

    ctx.save();

    // 2. 蓝色虚线框
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      minX - pad,
      minY - pad,
      maxX - minX + pad * 2,
      maxY - minY + pad * 2
    );
    ctx.setLineDash([]);

    // 3. 四角锚点
    ctx.fillStyle = '#89b4fa';
    const corners = [
      [minX, minY],
      [maxX, minY],
      [minX, maxY],
      [maxX, maxY],
    ];
    for (const [x, y] of corners) {
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }

    ctx.restore();
  }

  /**
   * 绘制电线选中高亮：线条整体变蓝，粗细不变
   * 与元件选中的蓝色虚线框语义一致（蓝色 = 选中）
   *
   * 使用与 drawWires 相同的路由缓存，避免选中/未选中显示不同的路径。
   */
  private drawWireSelection(wire: import('../types').Wire, circuit: Circuit): void {
    const start = this.getPinWorldPos(wire.startComponentId, wire.startPinId, circuit.components);
    const end = this.getPinWorldPos(wire.endComponentId, wire.endPinId, circuit.components);
    if (!start || !end) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 与 drawWires 一致的缓存路由
    const path = this.getWirePathCached(wire, circuit, start, end);

    // 线条变蓝（粗细、端点大小与原线完全一致）
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
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
    const pad = 0;   // 虚线框正好压在 AABB 边界（= 网格线）上
    const s = 3;

    // 用旋转后的 AABB
    const aabb = getRotatedAABB(comp);

    ctx.save();

    // 1. 蓝色虚线框
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      aabb.x - pad,
      aabb.y - pad,
      aabb.w + pad * 2,
      aabb.h + pad * 2
    );
    ctx.setLineDash([]);

    // 2. 四角锚点
    ctx.fillStyle = '#89b4fa';
    const corners = [
      [aabb.x, aabb.y],
      [aabb.x + aabb.w, aabb.y],
      [aabb.x, aabb.y + aabb.h],
      [aabb.x + aabb.w, aabb.y + aabb.h],
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
    return getPinWorldPos(comp, pin);
  }
}