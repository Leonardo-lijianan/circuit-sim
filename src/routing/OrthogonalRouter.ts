// src/routing/OrthogonalRouter.ts

import type { Point } from '../utils/geometry';
import { buildHananGrid, type RectWithId } from './HananGrid';

/**
 * 方向（canvas 坐标系，y 向下）
 *   E: 向右 (x+)
 *   W: 向左 (x-)
 *   N: 向上 (y-)
 *   S: 向下 (y+)
 */
export type Dir = 'E' | 'W' | 'N' | 'S';

const ALL_DIRS: Dir[] = ['E', 'W', 'N', 'S'];

const DIR_VEC: Record<Dir, { dx: number; dy: number }> = {
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
};

const OPPOSITE: Record<Dir, Dir> = {
  E: 'W', W: 'E', N: 'S', S: 'N',
};

const DIR_INDEX: Record<Dir, number> = { E: 0, W: 1, N: 2, S: 3 };
const INDEX_DIR: Dir[] = ['E', 'W', 'N', 'S'];

/**
 * 拐弯惩罚（等价于多走 BEND_PENALTY 像素）
 * 数值越大，路径越倾向于少拐弯
 */
const BEND_PENALTY = 20;

/**
 * 二叉最小堆（优先队列）
 */
class MinHeap<T> {
  private items: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}

  push(item: T): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(this.items[i], this.items[p]) < 0) {
        [this.items[i], this.items[p]] = [this.items[p], this.items[i]];
        i = p;
      } else break;
    }
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      while (true) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let s = i;
        if (l < n && this.compare(this.items[l], this.items[s]) < 0) s = l;
        if (r < n && this.compare(this.items[r], this.items[s]) < 0) s = r;
        if (s === i) break;
        [this.items[i], this.items[s]] = [this.items[s], this.items[i]];
        i = s;
      }
    }
    return top;
  }

  get size(): number { return this.items.length; }
}

/**
 * 正交避障路由参数
 */
export interface RouteParams {
  start: Point;
  /** 起点引脚朝向（走线从引脚出发的方向） */
  startPinDir: Dir;
  /** 起点元件 id（该元件不作为障碍物） */
  startCompId: number;
  end: Point;
  /** 终点引脚朝向（走线离开引脚的方向） */
  endPinDir: Dir;
  /** 终点元件 id（该元件不作为障碍物） */
  endCompId: number;
  /** 障碍物（所有元件 AABB，含 id） */
  obstacles: RectWithId[];
  /** 安全间距（默认 5px） */
  inflate?: number;
}

/**
 * 正交避障路由
 *
 * 约束：
 *   1. 只走水平 / 垂直段（正交）
 *   2. 避开所有障碍物（起终点所在元件除外）
 *   3. 少拐弯（拐弯有惩罚）
 *   4. 不调头（180° 反转被禁止）
 *
 * @returns 折点数组，失败返回 null
 */
export function routeOrthogonal(params: RouteParams): Point[] | null {
  const {
    start, startPinDir, startCompId,
    end, endPinDir, endCompId,
    obstacles, inflate = 5,
  } = params;

  // 1. 排除起终点元件
  const blocked = obstacles.filter(
    r => r.id !== startCompId && r.id !== endCompId
  );

  // 2. 构造 Hanan Grid
  const grid = buildHananGrid(start, end, blocked, inflate);
  const numX = grid.xs.length;
  const numY = grid.ys.length;

  const startXIdx = grid.xIndex.get(start.x);
  const startYIdx = grid.yIndex.get(start.y);
  const endXIdx = grid.xIndex.get(end.x);
  const endYIdx = grid.yIndex.get(end.y);

  if (
    startXIdx === undefined || startYIdx === undefined ||
    endXIdx === undefined || endYIdx === undefined
  ) {
    return null;
  }

  // 3. 膨胀后的障碍物（用于阻塞判定）
  const inflated = blocked.map(r => ({
    x1: r.x - inflate,
    y1: r.y - inflate,
    x2: r.x + r.w + inflate,
    y2: r.y + r.h + inflate,
  }));

  /** 点是否落在某个膨胀障碍物的严格内部 */
  const isBlocked = (x: number, y: number): boolean => {
    for (const r of inflated) {
      if (x > r.x1 && x < r.x2 && y > r.y1 && y < r.y2) return true;
    }
    return false;
  };

  /**
   * 正交线段是否穿过某个膨胀障碍物的内部
   *
   * Hanan Grid 保证障碍物边界是网格坐标，但相邻网格坐标之间
   * 的线段可能**横跨**障碍物内部（如 x=75 和 x=125 之间跨过障碍物）。
   * 所以必须逐边检查，不能只检查节点。
   */
  const segmentBlocked = (
    x1: number, y1: number,
    x2: number, y2: number
  ): boolean => {
    if (y1 === y2) {
      // 水平段
      const y = y1;
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      for (const r of inflated) {
        if (y > r.y1 && y < r.y2 && maxX > r.x1 && minX < r.x2) return true;
      }
    } else if (x1 === x2) {
      // 垂直段
      const x = x1;
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      for (const r of inflated) {
        if (x > r.x1 && x < r.x2 && maxY > r.y1 && minY < r.y2) return true;
      }
    }
    return false;
  };

  // 4. 状态编码： (xi * numY + yi) * 4 + dirIdx
  const numStates = numX * numY * 4;
  const encode = (xi: number, yi: number, di: number): number =>
    (xi * numY + yi) * 4 + di;

  const gCost = new Float64Array(numStates).fill(Infinity);
  const cameFrom = new Int32Array(numStates).fill(-1);

  const heuristic = (xi: number, yi: number): number =>
    Math.abs(grid.xs[xi] - end.x) + Math.abs(grid.ys[yi] - end.y);

  const open = new MinHeap<{ state: number; f: number }>((a, b) => a.f - b.f);

  // 进入终点的方向 = 引脚朝向的反方向
  // 例：引脚朝西（endPinDir='W'），最后一段必须从西往东（'E'）进入
  const requiredInDir = OPPOSITE[endPinDir];

  // 起点状态：入方向初值设为 startPinDir（让第一段"直行"无惩罚）
  const startState = encode(startXIdx, startYIdx, DIR_INDEX[startPinDir]);
  gCost[startState] = 0;
  open.push({ state: startState, f: heuristic(startXIdx, startYIdx) });

  // 5. A* 主循环
  while (open.size > 0) {
    const entry = open.pop()!;
    const state = entry.state;

    // 解码
    const di = state & 3;
    const tmp = state >> 2;
    const yi = tmp % numY;
    const xi = (tmp - yi) / numY;

    // 到达终点格点（任何方向）→ 成功
    // 进入方向已在扩展时约束，这里不重复检查
    if (xi === endXIdx && yi === endYIdx) {
      return reconstructPath(cameFrom, state, grid.xs, grid.ys, numY);
    }

    const inDir = INDEX_DIR[di];
    const x = grid.xs[xi];
    const y = grid.ys[yi];
    const g = gCost[state];
    const isStart = (xi === startXIdx && yi === startYIdx);

    // 扩展 4 个方向
    for (const outDir of ALL_DIRS) {
      // 禁止调头：180° 反转直接剪枝
      if (outDir === OPPOSITE[inDir]) continue;

      // 起点特殊约束：第一段必须背离元件（= startPinDir）
      if (isStart && outDir !== startPinDir) continue;

      const vec = DIR_VEC[outDir];
      const nxi = xi + vec.dx;
      const nyi = yi + vec.dy;
      if (nxi < 0 || nxi >= numX || nyi < 0 || nyi >= numY) continue;

      const nx = grid.xs[nxi];
      const ny = grid.ys[nyi];

      // 终点豁免：终点可能贴在元件边界上
      const isEnd = (nxi === endXIdx && nyi === endYIdx);

      if (isEnd) {
        // 进入终点方向必须符合引脚朝向
        if (outDir !== requiredInDir) continue;
      } else {
        // 边穿越检查（比节点检查更严格）
        if (segmentBlocked(x, y, nx, ny)) continue;
        // 节点检查（防止节点本身在障碍物内部）
        if (isBlocked(nx, ny)) continue;
      }

      const dist = Math.abs(nx - x) + Math.abs(ny - y);
      const turnCost = (outDir === inDir) ? 0 : BEND_PENALTY;
      const ng = g + dist + turnCost;

      const nState = encode(nxi, nyi, DIR_INDEX[outDir]);
      if (ng < gCost[nState]) {
        gCost[nState] = ng;
        cameFrom[nState] = state;
        open.push({ state: nState, f: ng + heuristic(nxi, nyi) });
      }
    }
  }

  return null;   // 无路径
}

/**
 * 从 cameFrom 链回溯重建路径
 */
function reconstructPath(
  cameFrom: Int32Array,
  goalState: number,
  xs: number[],
  ys: number[],
  numY: number
): Point[] {
  const states: number[] = [];
  let s = goalState;
  while (s !== -1) {
    states.push(s);
    s = cameFrom[s];
  }
  states.reverse();

  const points: Point[] = [];
  for (const state of states) {
    const tmp = state >> 2;
    const yi = tmp % numY;
    const xi = (tmp - yi) / numY;
    points.push({ x: xs[xi], y: ys[yi] });
  }

  return simplifyPath(points);
}

/**
 * 路径简化：移除共线的中间点
 */
function simplifyPath(points: Point[]): Point[] {
  if (points.length <= 2) return points;

  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];

    const dx1 = Math.sign(curr.x - prev.x);
    const dy1 = Math.sign(curr.y - prev.y);
    const dx2 = Math.sign(next.x - curr.x);
    const dy2 = Math.sign(next.y - curr.y);

    if (dx1 !== dx2 || dy1 !== dy2) {
      result.push(curr);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
