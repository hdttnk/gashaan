import type { ShapeDef, XY } from './catalog';
export interface Pose { x: number; y: number; angle: number }
export function rotate(p: XY, angle: number): XY {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}
export function vertices(shape: ShapeDef, pose: Pose): XY[] {
  if (shape.type === 'circle') return [
    { x: pose.x - shape.radius, y: pose.y }, { x: pose.x + shape.radius, y: pose.y },
    { x: pose.x, y: pose.y - shape.radius }, { x: pose.x, y: pose.y + shape.radius },
  ];
  return localVertices(shape).map(v => { const p = rotate(v, pose.angle); return { x: pose.x + p.x, y: pose.y + p.y }; });
}
export function localVertices(shape: Exclude<ShapeDef, { type: 'circle' }>): XY[] {
  if (shape.type === 'polygon') return shape.vertices;
  const x = shape.width / 2, y = shape.height / 2;
  return [{ x: -x, y: -y }, { x, y: -y }, { x, y }, { x: -x, y }];
}
export function shapeArea(shape: ShapeDef): number {
  if (shape.type === 'circle') return Math.PI * shape.radius ** 2;
  const v = localVertices(shape);
  return Math.abs(v.reduce((a, p, i) => { const q = v[(i + 1) % v.length]; return a + p.x * q.y - p.y * q.x; }, 0)) / 2;
}
export function shapeBounds(shape: ShapeDef) {
  const v = vertices(shape, { x: 0, y: 0, angle: 0 });
  const minX = Math.min(...v.map(p => p.x)), minY = Math.min(...v.map(p => p.y));
  const width = Math.max(...v.map(p => p.x)) - minX, height = Math.max(...v.map(p => p.y)) - minY;
  return { width, height, origin: { x: -minX / width, y: -minY / height } };
}
function edgePoint(p: XY, a: XY, b: XY): XY {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
export function containsPoint(shape: ShapeDef, p: XY, expand = 0): boolean {
  if (shape.type === 'circle') return Math.hypot(p.x, p.y) <= shape.radius + expand;
  const v = localVertices(shape);
  const crosses = v.map((a, i) => { const b = v[(i + 1) % v.length]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); });
  if (crosses.every(c => c >= -1e-9) || crosses.every(c => c <= 1e-9)) return true;
  return expand > 0 && v.some((a, i) => { const q = edgePoint(p, a, v[(i + 1) % v.length]); return Math.hypot(p.x - q.x, p.y - q.y) <= expand; });
}
export function closestPoint(shape: ShapeDef, p: XY): XY {
  if (containsPoint(shape, p)) return { ...p };
  if (shape.type === 'circle') { const t = shape.radius / Math.hypot(p.x, p.y); return { x: p.x * t, y: p.y * t }; }
  const v = localVertices(shape);
  return v.map((a, i) => edgePoint(p, a, v[(i + 1) % v.length])).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
}
// Separating-axis depth for circles and convex polygons. Allows shallow solver contact,
// rejects deep overlap without moving live bodies just to perform a placement query.
export function overlaps(a: ShapeDef, pa: Pose, b: ShapeDef, pb: Pose, tolerance = 0.025): boolean {
  if (a.type === 'circle' && b.type === 'circle') return Math.hypot(pa.x - pb.x, pa.y - pb.y) < a.radius + b.radius - tolerance;
  const axes: XY[] = [];
  for (const [shape, pose] of [[a, pa], [b, pb]] as const) {
    if (shape.type !== 'circle') {
      const v = vertices(shape, pose);
      for (let i = 0; i < v.length; i++) { const a = v[i], b = v[(i + 1) % v.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); axes.push({ x: -dy / length, y: dx / length }); }
    }
  }
  if (a.type === 'circle' || b.type === 'circle') {
    const circle = a.type === 'circle' ? pa : pb;
    const box = a.type !== 'circle' ? a : b;
    const boxPose = a.type !== 'circle' ? pa : pb;
    const nearest = vertices(box, boxPose).sort((p, q) => Math.hypot(p.x - circle.x, p.y - circle.y) - Math.hypot(q.x - circle.x, q.y - circle.y))[0];
    const dx = nearest.x - circle.x, dy = nearest.y - circle.y, length = Math.hypot(dx, dy);
    if (length > 1e-9) axes.push({ x: dx / length, y: dy / length });
  }
  for (const axis of axes) {
    const project = (shape: ShapeDef, pose: Pose): [number, number] => {
      if (shape.type === 'circle') { const c = pose.x * axis.x + pose.y * axis.y; return [c - shape.radius, c + shape.radius]; }
      const values = vertices(shape, pose).map(p => p.x * axis.x + p.y * axis.y);
      return [Math.min(...values), Math.max(...values)];
    };
    const [amin, amax] = project(a, pa), [bmin, bmax] = project(b, pb);
    if (Math.min(amax, bmax) - Math.max(amin, bmin) <= tolerance) return false;
  }
  return true;
}
