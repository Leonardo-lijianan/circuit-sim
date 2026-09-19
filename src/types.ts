// src/types.ts

import type { SVGCommand } from './loader/SVGParser';

// ============================================================
// 基础类型
// ============================================================

export interface PinDefinition {
  id: string;
  x: number;
  y: number;
  label?: string;
  type?: 'passive' | 'input' | 'output' | 'bidirectional';
  hitRadius?: number;
}

export interface ParamDefinition {
  id: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

// ============================================================
// 视觉层定义
// ============================================================

export interface FixLayer {
  file: 'fix.svg';
}

export interface FlexUnitDefinition {
  file: string; // 如 "flex/seg_a.svg"
  // offsetX/offsetY 在加载时从 SVG viewBox 自动解析
}

export interface FlexLayer {
  units: Record<string, FlexUnitDefinition>;
}

// ============================================================
// 视觉状态
// ============================================================

export interface VisualState {
  parts: Record<string, {
    opacity?: number;
    color?: string;
    rotation?: number;
    /**
     * 旋转轴在 fix.svg 坐标系中的位置 [x, y]
     * 未指定时默认使用 viewBox 中心
     */
    rotationAnchor?: [number, number];
    offsetX?: number;
    offsetY?: number;
  }>;
}

export interface VisualDefinition {
  states: Record<string, VisualState>;
  default_state?: string;
}

// ============================================================
// 状态转换规则（多态）
// ============================================================

export type StateTransition =
  | {
      type: 'binary';
      condition: string;
      true_state: string;
      false_state: string;
    }
  | {
      type: 'map';
      source: string;
      mapping: Record<string, string>;
      default_state?: string;
    }
  | {
      type: 'direct_drive';
      parts: Record<string, string>;
    };

// ============================================================
// 电气模型
// ============================================================

export interface ModelDefinition {
  func: string;
  paramMap: Record<string, string>;
}

// ============================================================
// 完整元件定义
// ============================================================

export interface ComponentDefinition {
  schemaVersion?: string;
  name: string;
  label: string;
  fix: FixLayer;
  flex?: FlexLayer;
  pins: PinDefinition[];
  params: ParamDefinition[];
  visual: VisualDefinition;
  model: ModelDefinition;
  state_transition?: StateTransition;
  metadata?: Record<string, any>;
}

// ============================================================
// 运行时实例（Phase 2 会用到）
// ============================================================

export interface ComponentInstance {
  id: number;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * 元件旋转角度（度）
   * 只允许 0 / 90 / 180 / 270
   */
  rotation: number;
  params: Record<string, any>;
  state: string;
  electrical?: {
    voltage: number;
    current: number;
    power: number;
  };
  directParts?: Record<string, { opacity?: number; color?: string }>;
}

export interface Wire {
  id: number;
  startComponentId: number;
  startPinId: string;
  endComponentId: number;
  endPinId: string;
  /**
   * 路由缓存（Task 8.3，懒计算）
   *
   * - 由 CircuitRenderer 计算并写入
   * - CircuitManager.triggerUpdate() 时清空（任何电路变动都可能影响避障条件）
   * - undefined 表示尚未计算或已失效
   */
  path?: { x: number; y: number }[];
}

export interface Circuit {
  components: ComponentInstance[];
  wires: Wire[];
  selection: Selection | null;
}

// ===== 选择模型（多选） =====
// 空数组表示该类对象未选中；selection 为 null 表示完全无选择
export interface Selection {
  componentIds: number[];
  wireIds: number[];
}

// ============================================================
// IPC 合约（给 Rust 的极简负载）
// ============================================================

export interface SolverComponent {
  id: number;
  func: string;
  params: Record<string, number | boolean>;
  pins: { id: string }[];
}

export interface SolverWire {
  start: { componentId: number; pinId: string };
  end: { componentId: number; pinId: string };
}

export interface SolverInput {
  analysis: {
    type: 'dc' | 'ac' | 'transient';
    time_step?: number;
    final_time?: number;
    freq?: number;
  };
  components: SolverComponent[];
  wires: SolverWire[];
}

export interface SolverOutput {
  componentId: number;
  voltage: number;
  current: number;
  power: number;
  nodeVoltages?: Record<string, number>;
}

// ============================================================
// Flex 单元运行时缓存结构
// ============================================================

export interface FlexUnitCache {
  commands: SVGCommand[];
  viewBox: { vx: number; vy: number; vw: number; vh: number };
  offsetX: number;
  offsetY: number;
}

// Phase 2 + Phase 3 相关类型

// ===== 交互模式 =====
export type Mode = 'select' | 'place' | 'pan';

// ===== 引脚引用 =====
export interface PinRef {
  componentId: number;
  pinId: string;
}

// ===== 待完成操作 =====
export type PendingAction =
  | { kind: 'place'; type: string }
  | { kind: 'wire'; start: PinRef }
  | null;