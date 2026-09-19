// src/utils/hitTest.test.ts

import { describe, it, expect } from 'vitest';
import { hitTestWires } from './hitTest';
import type { ComponentInstance, Wire } from '../types';
import type { ComponentLoader } from '../loader/ComponentLoader';

// ============================================================
// Mock：只需要 loader.getDefinition 返回带引脚的元件定义
// ============================================================

const mockLoader = {
  getDefinition(type: string) {
    if (type === 'dummy') {
      return {
        name: 'dummy',
        label: 'dummy',
        pins: [
          { id: 'p1', x: 0, y: 20 },
          { id: 'p2', x: 60, y: 20 },
        ],
      };
    }
    return undefined;
  },
} as unknown as ComponentLoader;

function makeComp(id: number, x: number, y: number): ComponentInstance {
  return {
    id,
    type: 'dummy',
    x,
    y,
    w: 60,
    h: 40,
    rotation: 0,
    params: {},
    state: 'default',
  };
}

const comp1 = makeComp(1, 100, 100);   // p1 世界坐标 (100, 120)
const comp2 = makeComp(2, 300, 100);   // p1 世界坐标 (300, 120)

// ============================================================
// 测试
// ============================================================

describe('hitTestWires - path 缓存优先级', () => {
  it('使用 wire.path（渲染缓存），与 getWirePath 无关', () => {
    // 故意给一个和引脚连线完全不同的 path
    // 引脚连线是 (100,120)→(300,120) 的水平直线
    // 我们给 wire.path 一条绕道到 (200, 300) 的路径
    const wire: Wire = {
      id: 1,
      startComponentId: 1,
      startPinId: 'p1',
      endComponentId: 2,
      endPinId: 'p1',
      path: [
        { x: 100, y: 120 },
        { x: 200, y: 120 },
        { x: 200, y: 300 },
        { x: 300, y: 300 },
        { x: 300, y: 120 },
      ],
    };

    // 点击绕道段上的点 → 必须命中
    const hit = hitTestWires(200, 250, [wire], [comp1, comp2], mockLoader, 6);
    expect(hit).toBe(1);

    // 点击原本的直线位置 → 不应命中（被绕道了）
    // (200, 120) 是直线中点，但 wire.path 在这里只有一个拐点，
    // 实际上 (200, 120) 在 wire.path 上（是拐点），所以会命中
    // 换成直线上的另一个点：(250, 120)
    const miss = hitTestWires(250, 120, [wire], [comp1, comp2], mockLoader, 6);
    expect(miss).toBeNull();
  });

  it('wire.path 缺失时回退到 getWirePath', () => {
    const wire: Wire = {
      id: 1,
      startComponentId: 1,
      startPinId: 'p1',
      endComponentId: 2,
      endPinId: 'p1',
      // path 未设置
    };

    // 引脚水平对齐 → Z 字退化为直线 (100,120)→(300,120)
    const hit = hitTestWires(200, 120, [wire], [comp1, comp2], mockLoader, 6);
    expect(hit).toBe(1);

    // 远点不命中
    const miss = hitTestWires(200, 200, [wire], [comp1, comp2], mockLoader, 6);
    expect(miss).toBeNull();
  });

  it('阈值判定正确', () => {
    const wire: Wire = {
      id: 1,
      startComponentId: 1,
      startPinId: 'p1',
      endComponentId: 2,
      endPinId: 'p1',
      path: [
        { x: 100, y: 120 },
        { x: 300, y: 120 },
      ],
    };

    // 距离 5 < 6 → 命中
    expect(hitTestWires(200, 125, [wire], [comp1, comp2], mockLoader, 6)).toBe(1);
    // 距离 7 > 6 → 不命中
    expect(hitTestWires(200, 127, [wire], [comp1, comp2], mockLoader, 6)).toBeNull();
  });

  it('多条线时上层优先（逆序命中）', () => {
    const wireA: Wire = {
      id: 1,
      startComponentId: 1,
      startPinId: 'p1',
      endComponentId: 2,
      endPinId: 'p1',
      path: [{ x: 100, y: 120 }, { x: 300, y: 120 }],
    };
    const wireB: Wire = {
      id: 2,
      startComponentId: 1,
      startPinId: 'p1',
      endComponentId: 2,
      endPinId: 'p1',
      path: [{ x: 100, y: 120 }, { x: 300, y: 120 }],
    };
    // 两条线重叠，应该返回后加的那条（id=2）
    const hit = hitTestWires(200, 120, [wireA, wireB], [comp1, comp2], mockLoader, 6);
    expect(hit).toBe(2);
  });
});
