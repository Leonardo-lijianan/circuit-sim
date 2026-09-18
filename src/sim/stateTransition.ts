// src/sim/stateTransition.ts

import type { StateTransition } from '../types';

/**
 * 评估状态转换规则，返回新的 state
 * 
 * 返回类型：
 * - string：状态名（binary / map 模式）
 * - Record<string, any>：直接驱动模式返回的 parts 参数
 */
export function evaluateTransition(
  rule: StateTransition,
  electrical: { voltage: number; current: number; power: number; [key: string]: any }
): string | Record<string, { opacity?: number; color?: string }> {
  switch (rule.type) {
    case 'binary': {
      // 简单表达式求值（condition 来自受信任的 meta.json）
      // eslint-disable-next-line no-new-func
      const fn = new Function('electrical', `return ${rule.condition};`);
      const result = fn(electrical);
      return result ? rule.true_state : rule.false_state;
    }

    case 'map': {
      const value = electrical[rule.source];
      return rule.mapping[String(value)] || rule.default_state || 'default';
    }

    case 'direct_drive': {
      const parts: Record<string, { opacity?: number; color?: string }> = {};
      for (const [partId, sourceField] of Object.entries(rule.parts)) {
        const value = electrical[sourceField];
        if (value !== undefined) {
          parts[partId] = { opacity: typeof value === 'number' ? value : 1 };
        }
      }
      return parts;
    }

    default:
      return 'default';
  }
}
