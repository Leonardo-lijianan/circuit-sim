// src/loader/SVGParser.ts

// ============================================================
// 类型定义
// ============================================================

export interface SVGCommand {
  type: 'circle' | 'rect' | 'path' | 'polygon';
  // 公共属性
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  // circle
  cx?: number;
  cy?: number;
  r?: number;
  // rect
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  // path
  d?: string;
  // polygon
  points?: number[];
}

export interface SVGParsedResult {
  commands: SVGCommand[];
  viewBox: {
    vx: number;
    vy: number;
    vw: number;
    vh: number;
  };
}

// ============================================================
// 解析函数
// ============================================================

/**
 * 解析 SVG 文本，提取图元指令和 viewBox
 * 用途：将 flex/*.svg 解析为可执行的 Canvas 指令树
 */
export function parseSVG(svgText: string): SVGParsedResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;

  // 解析 viewBox
  const viewBoxStr = svg.getAttribute('viewBox') || '0 0 100 100';
  const [vx, vy, vw, vh] = viewBoxStr.split(/[\s,]+/).map(Number);

  const commands: SVGCommand[] = [];

  for (const child of svg.children) {
    const tag = child.tagName?.toLowerCase();
    if (!tag) continue;

    // 提取公共属性
    const fill = child.getAttribute('fill') || null;
    const stroke = child.getAttribute('stroke') || null;
    const strokeWidth = parseFloat(child.getAttribute('stroke-width') || '1');
    const opacity = parseFloat(child.getAttribute('opacity') || '1');

    switch (tag) {
      case 'circle': {
        const cx = parseFloat(child.getAttribute('cx') || '0');
        const cy = parseFloat(child.getAttribute('cy') || '0');
        const r = parseFloat(child.getAttribute('r') || '0');
        commands.push({
          type: 'circle',
          cx,
          cy,
          r,
          fill,
          stroke,
          strokeWidth,
          opacity,
        });
        break;
      }
      case 'rect': {
        const x = parseFloat(child.getAttribute('x') || '0');
        const y = parseFloat(child.getAttribute('y') || '0');
        const w = parseFloat(child.getAttribute('width') || '0');
        const h = parseFloat(child.getAttribute('height') || '0');
        commands.push({
          type: 'rect',
          x,
          y,
          w,
          h,
          fill,
          stroke,
          strokeWidth,
          opacity,
        });
        break;
      }
      case 'path': {
        const d = child.getAttribute('d') || '';
        commands.push({
          type: 'path',
          d,
          fill,
          stroke,
          strokeWidth,
          opacity,
        });
        break;
      }
      case 'polygon': {
        const pointsStr = child.getAttribute('points') || '';
        const points = pointsStr.trim().split(/[\s,]+/).map(Number);
        commands.push({
          type: 'polygon',
          points,
          fill,
          stroke,
          strokeWidth,
          opacity,
        });
        break;
      }
      default:
        // 其他标签（g、defs、use 等）暂不处理
        // 未来可扩展支持
        break;
    }
  }

  return {
    commands,
    viewBox: { vx, vy, vw, vh },
  };
}