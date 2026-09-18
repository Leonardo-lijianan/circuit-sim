// src/sim/CircuitSerializer.ts

import type { Circuit, ComponentInstance, Wire } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';

const SCHEMA_VERSION = '1.0';

/**
 * 文件保存格式
 */
export interface SavedCircuit {
  schemaVersion: string;
  components: ComponentInstance[];
  wires: Wire[];
}

/**
 * 序列化电路到 JSON 字符串
 *
 * 会剔除运行时数据：
 *   - electrical（每次仿真的结果，重新加载时重新算）
 *   - selection（UI 状态，不保存）
 */
export function serialize(circuit: Circuit): string {
  const saved: SavedCircuit = {
    schemaVersion: SCHEMA_VERSION,
    components: circuit.components.map(c => ({
      id: c.id,
      type: c.type,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      rotation: c.rotation || 0,
      params: { ...c.params },
      state: c.state,
      // 注意：不保存 electrical
    })),
    wires: circuit.wires.map(w => ({ ...w })),
  };
  return JSON.stringify(saved, null, 2);
}

/**
 * 从 JSON 字符串反序列化电路
 *
 * 返回 { circuit, warnings }
 *   - circuit：可加载的电路（未知元件/孤立连线已过滤）
 *   - warnings：加载过程中的警告列表（如未知元件类型）
 */
export function deserialize(
  json: string,
  loader: ComponentLoader
): { circuit: Circuit; warnings: string[] } {
  const warnings: string[] = [];

  // 1. 解析 JSON
  let data: any;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`JSON 解析失败: ${(err as Error).message}`);
  }

  // 2. 校验 schemaVersion
  if (!data.schemaVersion) {
    warnings.push('文件缺少 schemaVersion 字段');
  } else if (data.schemaVersion !== SCHEMA_VERSION) {
    warnings.push(`版本不匹配：文件 ${data.schemaVersion}，当前 ${SCHEMA_VERSION}（尝试加载）`);
  }

  // 3. 过滤未知元件类型
  const rawComponents = Array.isArray(data.components) ? data.components : [];
  const knownComponents: ComponentInstance[] = [];
  const validIds = new Set<number>();

  for (const raw of rawComponents) {
    if (typeof raw?.id !== 'number' || typeof raw?.type !== 'string') {
      warnings.push('跳过无效元件记录（缺少 id 或 type）');
      continue;
    }

    const def = loader.getDefinition(raw.type);
    if (!def) {
      warnings.push(`未知元件类型「${raw.type}」，已跳过`);
      continue;
    }

    knownComponents.push({
      id: raw.id,
      type: raw.type,
      x: typeof raw.x === 'number' ? raw.x : 0,
      y: typeof raw.y === 'number' ? raw.y : 0,
      w: typeof raw.w === 'number' ? raw.w : 60,
      h: typeof raw.h === 'number' ? raw.h : 40,
      rotation: typeof raw.rotation === 'number' ? raw.rotation : 0,
      params: raw.params && typeof raw.params === 'object' ? { ...raw.params } : {},
      state: typeof raw.state === 'string' ? raw.state : (def.visual.default_state || 'default'),
    });
    validIds.add(raw.id);
  }

  // 4. 过滤引用了不存在元件的连线
  const rawWires = Array.isArray(data.wires) ? data.wires : [];
  const knownWires: Wire[] = [];

  for (const raw of rawWires) {
    if (
      typeof raw?.id !== 'number' ||
      typeof raw?.startComponentId !== 'number' ||
      typeof raw?.endComponentId !== 'number'
    ) {
      warnings.push('跳过无效连线记录');
      continue;
    }
    if (!validIds.has(raw.startComponentId) || !validIds.has(raw.endComponentId)) {
      warnings.push(`连线 #${raw.id} 引用了不存在的元件，已跳过`);
      continue;
    }
    knownWires.push({
      id: raw.id,
      startComponentId: raw.startComponentId,
      startPinId: String(raw.startPinId ?? ''),
      endComponentId: raw.endComponentId,
      endPinId: String(raw.endPinId ?? ''),
    });
  }

  return {
    circuit: {
      components: knownComponents,
      wires: knownWires,
      selection: null,
    },
    warnings,
  };
}
