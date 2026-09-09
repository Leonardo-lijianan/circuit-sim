// === Task 3.3 一键验收 ===
const comps = __manager.getComponents();
const led = comps.find(c => c.type === 'led');
const ledDef = __loader.getDefinition('led');
const pinK = ledDef.pins.find(p => p.id === 'k');
const pinKX = led.x + pinK.x;
const pinKY = led.y + pinK.y;
const radius = pinK.hitRadius || 15;

const results = {
  circleIn: __hitTestCircle(pinKX, pinKY, pinKX, pinKY, radius),
  circleOut: __hitTestCircle(pinKX + 20, pinKY, pinKX, pinKY, radius),
  rectIn: __hitTestRect(220, 220, led.x, led.y, led.w, led.h),
  rectOut: __hitTestRect(180, 180, led.x, led.y, led.w, led.h),
  snapIn: __hitTestSnap(pinKX - 10, pinKY - 5, comps, __loader, 20).snapped,
  snapOut: __hitTestSnap(pinKX - 50, pinKY - 50, comps, __loader, 20).snapped,
  hitComponent: __hitTest(220, 220, comps, __loader).kind === 'component',
  hitPin: __hitTest(pinKX, pinKY, comps, __loader).kind === 'pin',
  hitNone: __hitTest(100, 100, comps, __loader).kind === 'none',
};

console.table(results);
// 预期全部为 true