import { World, Vec2, Box, Circle, Polygon, MouseJoint, RevoluteJoint, type Body } from 'planck';
import { CATALOG, type Kind, type PartDef, type XY } from './catalog';
import { overlaps, rotate, vertices, shapeArea, containsPoint, closestPoint, type Pose } from './geometry';

export const WIDTH = 16, HEIGHT = 9, FLOOR = 8.6, STEP = 1 / 120;
export const LIMITS = { dynamicBodies: 60, joints: 20, staticObjects: 10, testBalls: 4 };
export interface Parameters {
  gravity: number; holdForce: number; holdHz: number; holdDamping: number; targetSpeed: number;
  angleStiffness: number; angleDamping: number; maxTorque: number; heldSpinLimit: number;
  holdClearance: number; maxSpeed: number; impactLimit: number; loadLimit: number; loadDuration: number;
}
export const DEFAULTS: Parameters = {
  gravity: 9.8, holdForce: 3000, holdHz: 18, holdDamping: 0.95, targetSpeed: 24,
  angleStiffness: 180, angleDamping: 24, maxTorque: 800, heldSpinLimit: 4, holdClearance: 0.3,
  maxSpeed: 20, impactLimit: 6, loadLimit: 600, loadDuration: 0.12,
};
export interface Part { id: string; objectId: string; def: PartDef; body: Body }
export interface ObjectRecord { id: string; kind: Kind; version: number }
export interface WheelLink {
  id: string; a: string; b: string; anchorA: XY; anchorB: XY; body: Body; joint: RevoluteJoint | null;
  force: number; peakForce: number; impulse: number; peakImpulse: number; loadTime: number; anchorError: number;
}
export interface LabEvent { time: number; text: string }
export interface StageSnapshot {
  bounds?: { width: number; height: number };
  schemaVersion: 1; objects: ObjectRecord[];
  parts: { id: string; objectId: string; definitionId: string; pose: Pose; gravityScale: number }[];
  joints: { id: string; a: string; b: string; anchorA: XY; anchorB: XY; connected: boolean }[];
  parameters: Parameters; rules?: { tyresUnbreakable: boolean }; nextId: number;
}
export type Scenario = 'rest' | 'drop' | 'rolling';
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const angleDelta = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const bodyPose = (body: Body): Pose => ({ x: body.getPosition().x, y: body.getPosition().y, angle: body.getAngle() });

/** Physics and stage state in m/kg/s. No Phaser dependency or render-owned transforms. */
export class PhysicsLab {
  width = WIDTH; height = FLOOR;
  world!: World; ground!: Body;
  parts: Part[] = []; objects: ObjectRecord[] = []; wheels: WheelLink[] = []; balls: Body[] = [];
  params: Parameters; events: LabEvent[] = [];
  tyresUnbreakable = false;
  time = 0; paused = false; dirty = false; baseline!: StageSnapshot;
  selected: string | null = null; editPreview: Map<string, Pose> | null = null; editValid = true;
  hold: MouseJoint | null = null; heldBody: Body | null = null;
  desiredTarget = Vec2(); target = Vec2(); holdAngle = 0; holdForceMeasured = 0; holdError = 0;
  lastStepMs = 0; maxContactImpulse = 0; speedClamps = 0; fault: string | null = null; notice = '';
  private nextId = 1;
  private holdPointerOffset = Vec2();
  private editing: { root: Pose; start: XY; initial: Map<string, Pose> } | null = null;

  constructor(params: Partial<Parameters> = {}) { this.params = { ...DEFAULTS, ...params }; this.reset(); }
  get chassis(): Body { return this.parts.find(p => p.def.role === 'chassis')!.body; }
  get detachedCount() { return this.wheels.filter(w => !w.joint).length; }
  partFor(body: Body) { return this.parts.find(p => p.body === body); }
  part(id: string) { return this.parts.find(p => p.id === id)!; }

  private newWorld() {
    this.hold = null; this.heldBody = null; this.holdForceMeasured = 0; this.holdError = 0;
    this.editing = null; this.editPreview = null; this.selected = null;
    this.parts = []; this.objects = []; this.wheels = []; this.balls = [];
    this.time = 0; this.events = []; this.maxContactImpulse = 0; this.speedClamps = 0;
    this.fault = null; this.notice = ''; this.lastStepMs = 0;
    this.world = new World(Vec2(0, this.params.gravity)); this.world.setAllowSleeping(true);
    this.ground = this.world.createBody();
    for (const [x, y, hw, hh] of [
      [-1, this.height / 2, 1, this.height / 2 + 1], [this.width + 1, this.height / 2, 1, this.height / 2 + 1],
      [this.width / 2, -1, this.width / 2 + 2, 1], [this.width / 2, this.height + 1, this.width / 2 + 2, 1],
    ]) this.ground.createFixture(Box(hw, hh, Vec2(x, y)), { friction: 0.65 });
    this.world.on('post-solve', (_contact, impulse) => { this.maxContactImpulse = Math.max(this.maxContactImpulse, ...impulse.normalImpulses); });
  }
  private createPart(id: string, objectId: string, def: PartDef, pose: Pose): Part {
    const body = this.world.createBody({ type: def.static ? 'static' : 'dynamic', position: Vec2(pose.x, pose.y), angle: pose.angle,
      bullet: !def.static, angularDamping: def.role === 'wheel' ? 0.02 : 0.1 });
    const shape = def.shape, area = shapeArea(shape);
    body.createFixture(shape.type === 'circle' ? Circle(shape.radius) : shape.type === 'box' ? Box(shape.width / 2, shape.height / 2) : Polygon(shape.vertices.map(v => Vec2(v.x, v.y))), {
      density: def.static ? 0 : def.mass / area, friction: def.friction, restitution: def.restitution,
    });
    body.setUserData(id);
    const part = { id, objectId, def, body }; this.parts.push(part); return part;
  }
  private createLink(data: StageSnapshot['joints'][number]) {
    const a = this.part(data.a).body, b = this.part(data.b).body;
    const joint = data.connected ? this.world.createJoint(new RevoluteJoint({
      bodyA: a, bodyB: b, collideConnected: false,
      localAnchorA: Vec2(data.anchorA.x, data.anchorA.y), localAnchorB: Vec2(data.anchorB.x, data.anchorB.y),
    }))! : null;
    this.wheels.push({ ...data, body: b, joint, force: 0, peakForce: 0, impulse: 0, peakImpulse: 0, loadTime: 0, anchorError: 0 });
  }
  private spawn(kind: Kind, point: XY, angle = 0) {
    const id = `object-${this.nextId++}`, definition = CATALOG[kind];
    this.objects.push({ id, kind, version: definition.version });
    for (const def of definition.parts) {
      const offset = rotate(def.position, angle);
      this.createPart(`${id}/${def.id}`, id, def, { x: point.x + offset.x, y: point.y + offset.y, angle });
    }
    for (const link of definition.joints) this.createLink({ ...link, id: `${id}/${link.id}`, a: `${id}/${link.a}`, b: `${id}/${link.b}`, connected: true });
    return id;
  }
  reset(scenario: Scenario = 'rest') {
    this.nextId = 1; this.newWorld(); this.paused = false; this.dirty = false;
    const wheel = CATALOG.car.parts.find(p => p.role === 'wheel')!;
    const clearance = wheel.position.y + (wheel.shape.type === 'circle' ? wheel.shape.radius : 0);
    this.spawn('car', { x: this.width / 2, y: scenario === 'drop' ? 1.3 : this.height - clearance - 0.015 });
    if (scenario === 'rolling') {
      for (const body of this.dynamicBodies()) body.setLinearVelocity(Vec2(2.5, 0));
      for (const wheel of this.wheels) wheel.body.setAngularVelocity(2.5 / 0.32);
    }
    this.baseline = this.captureSnapshot();
    this.log(scenario === 'drop' ? '高所落下を開始' : scenario === 'rolling' ? '通常走行を開始' : '車を初期位置へ戻した');
  }
  log(text: string) { this.events.unshift({ time: this.time, text }); this.events.length = Math.min(this.events.length, 8); }
  captureSnapshot(): StageSnapshot {
    return structuredClone({ schemaVersion: 1, bounds: { width: this.width, height: this.height }, objects: this.objects,
      parts: this.parts.map(p => ({ id: p.id, objectId: p.objectId, definitionId: p.def.id, pose: bodyPose(p.body), gravityScale: p.body.getGravityScale() })),
      joints: this.wheels.map(w => ({ id: w.id, a: w.a, b: w.b, anchorA: w.anchorA, anchorB: w.anchorB, connected: !!w.joint })),
      parameters: this.params, rules: { tyresUnbreakable: this.tyresUnbreakable }, nextId: this.nextId });
  }
  restoreSnapshot(snapshot: StageSnapshot) {
    // Validate before replacing the live world. Engine caches are intentionally excluded.
    if (snapshot.schemaVersion !== 1) throw new Error('未対応のステージ形式');
    const bounds = snapshot.bounds ?? { width: WIDTH, height: FLOOR };
    if (![bounds.width, bounds.height].every(v => Number.isFinite(v) && v >= 8 && v <= 100)) throw new Error('ステージ寸法が不正');
    const ids = new Set<string>();
    for (const object of snapshot.objects) {
      if (!CATALOG[object.kind] || CATALOG[object.kind].version !== object.version || ids.has(object.id)) throw new Error('物体定義が不正');
      ids.add(object.id);
    }
    const partIds = new Set<string>();
    for (const part of snapshot.parts) {
      const object = snapshot.objects.find(o => o.id === part.objectId);
      if (!object || !CATALOG[object.kind].parts.some(p => p.id === part.definitionId) || partIds.has(part.id)
        || ![part.pose.x, part.pose.y, part.pose.angle, part.gravityScale].every(Number.isFinite)) throw new Error('部品データが不正');
      partIds.add(part.id);
    }
    if (snapshot.joints.some(j => !partIds.has(j.a) || !partIds.has(j.b)
      || ![j.anchorA.x, j.anchorA.y, j.anchorB.x, j.anchorB.y].every(Number.isFinite))) throw new Error('接続データが不正');
    if (Object.keys(DEFAULTS).some(key => !Number.isFinite(snapshot.parameters[key as keyof Parameters]))) throw new Error('設定データが不正');
    if (snapshot.rules && typeof snapshot.rules.tyresUnbreakable !== 'boolean') throw new Error('遊び方の設定が不正');
    this.tyresUnbreakable = snapshot.rules?.tyresUnbreakable ?? false;
    this.width = bounds.width; this.height = bounds.height;
    this.params = { ...snapshot.parameters }; this.newWorld(); this.nextId = snapshot.nextId;
    this.objects = structuredClone(snapshot.objects);
    for (const part of snapshot.parts) {
      const object = this.objects.find(o => o.id === part.objectId)!;
      const created = this.createPart(part.id, object.id, CATALOG[object.kind].parts.find(p => p.id === part.definitionId)!, part.pose);
      created.body.setGravityScale(part.gravityScale);
    }
    for (const joint of snapshot.joints) this.createLink(joint);
    this.paused = true; this.dirty = false;
  }
  /** Reframe connected assemblies without scaling their bodies or local joint anchors. */
  resizeArena(width: number, height: number) {
    if (![width, height].every(v => Number.isFinite(v) && v >= 8 && v <= 100)) throw new Error('ステージ寸法が不正');
    if (Math.abs(width - this.width) < 0.01 && Math.abs(height - this.height) < 0.01) return;
    this.release(); this.cancelEdit();
    const reframe = (source: StageSnapshot): StageSnapshot => {
      const snapshot = structuredClone(source), old = snapshot.bounds ?? { width: WIDTH, height: FLOOR };
      const remaining = new Set(snapshot.parts.map(p => p.id));
      while (remaining.size) {
        const ids = new Set([remaining.values().next().value!]);
        let changed = true;
        while (changed) { changed = false; for (const j of snapshot.joints) if (j.connected && (ids.has(j.a) || ids.has(j.b))) {
          if (!ids.has(j.a) || !ids.has(j.b)) changed = true; ids.add(j.a); ids.add(j.b);
        } }
        const parts = snapshot.parts.filter(p => ids.has(p.id));
        const points = parts.flatMap(p => { const object = snapshot.objects.find(o => o.id === p.objectId)!; const def = CATALOG[object.kind].parts.find(d => d.id === p.definitionId)!; return vertices(def.shape, p.pose); });
        const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const dx = clamp(cx * width / old.width - cx, -minX + 0.005, width - maxX - 0.005);
        const dy = clamp(cy * height / old.height - cy, -minY + 0.005, height - maxY - 0.005);
        for (const part of parts) { part.pose.x += dx; part.pose.y += dy; remaining.delete(part.id); }
      }
      snapshot.bounds = { width, height }; return snapshot;
    };
    const baseline = reframe(this.baseline), current = reframe(this.captureSnapshot()), dirty = this.dirty;
    this.restoreSnapshot(current); this.baseline = baseline; this.dirty = dirty;
    const valid = this.placementValid(new Map()); this.dirty = dirty || !valid;
    this.notice = valid ? '' : '画面が変わったよ。重なったものを少し離してね';
  }
  redo() { this.restoreSnapshot(this.baseline); this.log('再生前の配置にもどした'); }
  clear() {
    this.newWorld(); this.nextId = 1; this.paused = true; this.dirty = false;
    this.baseline = this.captureSnapshot(); this.log('ぜんぶけした');
  }
  settingsChanged() { if (this.paused) this.dirty = true; }
  setTyresUnbreakable(enabled: boolean) {
    if (this.tyresUnbreakable === enabled) return;
    this.tyresUnbreakable = enabled;
    for (const link of this.wheels) link.loadTime = 0;
    this.settingsChanged();
    this.log(enabled ? 'タイヤが取れないモード：オン' : 'タイヤが取れないモード：オフ');
  }
  setPaused(paused: boolean) {
    this.release(); this.cancelEdit();
    if (!paused && this.fault) return;
    if (!paused && this.dirty) {
      if (!this.placementValid(new Map())) { this.notice = '重なりが深いので、物体を少し離してね'; return; }
      this.baseline = this.captureSnapshot();
      for (const body of this.dynamicBodies()) { body.setLinearVelocity(Vec2()); body.setAngularVelocity(0); body.setAwake(true); }
      this.world.clearForces(); this.time = 0; this.events = []; this.maxContactImpulse = 0; this.speedClamps = 0;
      for (const w of this.wheels) { w.force = 0; w.peakForce = 0; w.impulse = 0; w.peakImpulse = 0; w.loadTime = 0; }
      this.dirty = false; this.log('この配置からスタート（やりなおすの基準を更新）');
    }
    this.paused = paused; this.notice = ''; this.log(paused ? '停止：配置を変えられるよ' : '再生');
  }
  addObject(kind: Kind, point?: XY, angle = kind === 'ramp' ? -0.25 : 0): string | null {
    if (!this.paused) { this.notice = '追加するときは停止してね'; return null; }
    const definition = CATALOG[kind];
    if (this.dynamicBodies().length + definition.parts.filter(p => !p.static).length > LIMITS.dynamicBodies
      || this.wheels.length + definition.joints.length > LIMITS.joints
      || this.parts.filter(p => p.def.static).length + definition.parts.filter(p => p.static).length > LIMITS.staticObjects) {
      this.notice = 'いっぱいになったよ。やりなおすか、ぜんぶけしてね'; return null;
    }
    const validAt = (p: XY) => definition.parts.every(def => {
      const offset = rotate(def.position, angle), pose = { x: p.x + offset.x, y: p.y + offset.y, angle };
      return this.poseInStage(def, pose) && this.parts.every(other => !overlaps(def.shape, pose, other.def.shape, bodyPose(other.body)));
    });
    if (!point) for (let y = 2.2; y < this.height - 0.5 && !point; y += 1.2) for (let x = 2.2; x < this.width - 1.5; x += 2.2) {
      if (validAt({ x, y })) { point = { x, y }; break; }
    }
    if (!point || !validAt(point)) { this.notice = 'そこには置けないよ。空いている場所へ動かしてね'; return null; }
    const id = this.spawn(kind, point, angle);
    this.selected = this.parts.find(p => p.objectId === id)!.id;
    this.dirty = true; this.notice = ''; this.log(`${definition.label}を追加`); return id;
  }
  group(id: string): Part[] {
    const ids = new Set([id]); let changed = true;
    while (changed) {
      changed = false;
      for (const w of this.wheels) if (w.joint && (ids.has(w.a) || ids.has(w.b))) {
        for (const pid of [w.a, w.b]) if (!ids.has(pid)) { ids.add(pid); changed = true; }
      }
    }
    return this.parts.filter(p => ids.has(p.id));
  }
  pick(point: XY): Part | null {
    const inside = (p: Part, expand: number) => {
      const q = p.body.getLocalPoint(Vec2(point.x, point.y)), s = p.def.shape;
      return containsPoint(s, q, expand);
    };
    const ordered = [...this.parts].reverse();
    const picked = ordered.find(p => inside(p, 0)) ?? ordered.find(p => inside(p, 0.18));
    return picked ? this.group(picked.id).find(p => p.def.role === 'chassis') ?? picked : null;
  }
  canGrab(point: Vec2) { const p = this.pick(point); return !!p && !p.def.static; }
  beginEdit(point: XY) {
    if (!this.paused) return false;
    this.cancelEdit(); const selected = this.pick(point); this.selected = selected?.id ?? null;
    if (!selected) return false;
    this.editing = { root: bodyPose(selected.body), start: { ...point }, initial: new Map(this.group(selected.id).map(p => [p.id, bodyPose(p.body)])) };
    this.editPreview = new Map(this.editing.initial); this.editValid = true; return true;
  }
  moveEdit(point: XY) {
    if (!this.editing) return;
    const dx = point.x - this.editing.start.x, dy = point.y - this.editing.start.y;
    this.editPreview = new Map([...this.editing.initial].map(([id, pose]) => [id, { ...pose, x: pose.x + dx, y: pose.y + dy }]));
    this.editValid = this.placementValid(this.editPreview);
  }
  commitEdit() {
    if (!this.editPreview) return false;
    if (!this.editValid) { this.notice = '重なっているよ。元の場所にもどした'; this.cancelEdit(); return false; }
    let changed = false;
    for (const [id, pose] of this.editPreview) {
      const before = bodyPose(this.part(id).body);
      if (Math.hypot(before.x - pose.x, before.y - pose.y) > 1e-7 || Math.abs(before.angle - pose.angle) > 1e-7) changed = true;
      this.part(id).body.setTransform(Vec2(pose.x, pose.y), pose.angle);
    }
    if (changed) { this.dirty = true; this.notice = '配置を変更：再生すると、この配置がやりなおすの基準になるよ'; }
    this.cancelEdit(); return true;
  }
  cancelEdit() { this.editing = null; this.editPreview = null; this.editValid = true; }
  rotateSelected(delta: number) {
    if (!this.paused || !this.selected || this.editing) return false;
    const root = bodyPose(this.part(this.selected).body);
    this.editPreview = new Map(this.group(this.selected).map(p => {
      const before = bodyPose(p.body), offset = rotate({ x: before.x - root.x, y: before.y - root.y }, delta);
      return [p.id, { x: root.x + offset.x, y: root.y + offset.y, angle: before.angle + delta }] as const;
    }));
    this.editValid = this.placementValid(this.editPreview); return this.commitEdit();
  }
  private poseInStage(def: PartDef, pose: Pose) {
    return vertices(def.shape, pose).every(p => p.x >= -0.005 && p.x <= this.width + 0.005 && p.y >= -0.005 && p.y <= this.height + 0.005);
  }
  placementValid(poses: Map<string, Pose>) {
    const all = this.parts.map(p => ({ part: p, pose: poses.get(p.id) ?? bodyPose(p.body) }));
    const moved = poses.size ? all.filter(p => poses.has(p.part.id)) : all;
    for (const { part, pose } of moved) {
      if (!this.poseInStage(part.def, pose)) return false;
      for (const other of all) {
        if (part.id === other.part.id || this.wheels.some(w => w.joint && ((w.a === part.id && w.b === other.part.id) || (w.b === part.id && w.a === other.part.id)))) continue;
        if (overlaps(part.def.shape, pose, other.part.def.shape, other.pose)) return false;
      }
    }
    return true;
  }
  beginHold(point: Vec2): boolean {
    if (this.paused || this.fault) return false;
    const picked = this.pick(point); if (!picked || picked.def.static) return false;
    this.release(); this.selected = picked.id; this.heldBody = picked.body;
    const local = picked.body.getLocalPoint(point), shape = picked.def.shape;
    const localAnchor = closestPoint(shape, local), anchorLocal = Vec2(localAnchor.x, localAnchor.y);
    const anchor = picked.body.getWorldPoint(anchorLocal);
    this.target = anchor.clone(); this.desiredTarget = anchor.clone(); this.holdPointerOffset = Vec2.sub(anchor, point);
    this.holdAngle = picked.body.getAngle();
    this.hold = this.world.createJoint(new MouseJoint({ maxForce: this.params.holdForce, frequencyHz: this.params.holdHz, dampingRatio: this.params.holdDamping }, this.ground, picked.body, anchor))!;
    picked.body.setAwake(true); this.log('つかんだ（つながっているタイヤは外れないよ）'); return true;
  }
  moveHold(point: Vec2) { if (this.hold) this.desiredTarget = this.constrainTarget(Vec2.add(point, this.holdPointerOffset)); }
  private constrainTarget(point: Vec2): Vec2 {
    if (!this.hold || !this.heldBody) return point;
    const anchor = this.hold.getAnchorB();
    const points = this.group(this.partFor(this.heldBody)!.id).flatMap(p => vertices(p.def.shape, bodyPose(p.body)));
    const minX = Math.min(...points.map(p => p.x - anchor.x)), maxX = Math.max(...points.map(p => p.x - anchor.x));
    const minY = Math.min(...points.map(p => p.y - anchor.y)), maxY = Math.max(...points.map(p => p.y - anchor.y));
    const m = this.params.holdClearance;
    return Vec2(clamp(point.x, m - minX, this.width - m - maxX), clamp(point.y, m - minY, this.height - m - maxY));
  }
  release() {
    if (!this.hold) return;
    const heldIds = new Set(this.group(this.partFor(this.heldBody!)!.id).map(p => p.id));
    for (const w of this.wheels) if (heldIds.has(w.a)) w.loadTime = 0;
    this.world.destroyJoint(this.hold); this.hold = null; this.heldBody = null;
    this.holdForceMeasured = 0; this.holdError = 0; this.log('はなした（ここから衝突でタイヤが外れる）');
  }
  fireBall(strong = true, aim: 'wheel' | 'chassis' = 'wheel'): Body | null {
    if (this.paused || this.fault) return null;
    const car = this.parts.find(p => p.def.role === 'chassis');
    if (!car || this.dynamicBodies().length >= LIMITS.dynamicBodies) { this.notice = '試験には車と空きが必要だよ'; return null; }
    if (this.balls.length >= LIMITS.testBalls) {
      const old = this.balls.shift()!, part = this.partFor(old)!;
      if (old === this.heldBody) this.release();
      if (this.selected === part.id) this.selected = null;
      this.world.destroyBody(old); this.parts = this.parts.filter(p => p.body !== old); this.objects = this.objects.filter(o => o.id !== part.objectId);
    }
    const wheel = this.wheels.find(w => w.joint && w.a === car.id) ?? this.wheels.find(w => w.a === car.id);
    const center = aim === 'chassis' || !wheel ? car.body.getPosition() : wheel.body.getPosition(), fromLeft = center.x >= this.width / 2;
    const id = this.spawn('ball', { x: fromLeft ? 0.5 : this.width - 0.5, y: clamp(center.y, 0.5, this.height - 0.4) });
    const body = this.parts.find(p => p.objectId === id)!.body;
    body.setLinearVelocity(Vec2((fromLeft ? 1 : -1) * (strong ? 14 : 1.5), 0)); body.setGravityScale(0);
    this.balls.push(body); this.log(strong ? '強い試験ボール' : '弱い試験ボール'); return body;
  }
  dynamicBodies(): Body[] { return this.parts.filter(p => !p.def.static).map(p => p.body); }
  step() {
    if (this.paused || this.fault) return;
    const start = performance.now(); this.world.setGravity(Vec2(0, this.params.gravity));
    if (this.hold && this.heldBody) {
      const delta = Vec2.sub(this.desiredTarget, this.target), distance = delta.length(), maxMove = this.params.targetSpeed * STEP;
      if (distance > maxMove) delta.mul(maxMove / distance);
      this.target = this.constrainTarget(Vec2.add(this.target, delta)); this.hold.setTarget(this.target);
      this.hold.setMaxForce(this.params.holdForce); this.hold.setFrequency(this.params.holdHz); this.hold.setDampingRatio(this.params.holdDamping);
      const torque = this.params.angleStiffness * angleDelta(this.holdAngle - this.heldBody.getAngle()) - this.params.angleDamping * this.heldBody.getAngularVelocity();
      this.heldBody.applyTorque(clamp(torque, -this.params.maxTorque, this.params.maxTorque), true);
    }
    this.clampSpeeds(); this.world.step(STEP, 10, 6); this.time += STEP;
    const protectedIds = new Set(this.heldBody ? this.group(this.partFor(this.heldBody)!.id).map(p => p.id) : []);
    for (const link of this.wheels) {
      if (!link.joint) continue;
      link.force = link.joint.getReactionForce(1 / STEP).length(); link.impulse = link.force * STEP;
      link.peakForce = Math.max(link.peakForce, link.force); link.peakImpulse = Math.max(link.peakImpulse, link.impulse);
      link.anchorError = Vec2.distance(link.joint.getAnchorA(), link.joint.getAnchorB());
      // Protect only the held connected group. No deferred damage or automatic repair.
      if (this.tyresUnbreakable || (protectedIds.has(link.a) && protectedIds.has(link.b))) { link.loadTime = 0; continue; }
      link.loadTime = link.force > this.params.loadLimit ? link.loadTime + STEP : 0;
      if (link.impulse > this.params.impactLimit || link.loadTime >= this.params.loadDuration) {
        const reason = link.impulse > this.params.impactLimit ? '衝撃' : '持続荷重';
        this.world.destroyJoint(link.joint); link.joint = null; link.body.setAwake(true);
        this.log(`タイヤが脱落：${reason} / ${link.force.toFixed(0)} N`);
      }
    }
    if (this.hold) { this.holdForceMeasured = this.hold.getReactionForce(1 / STEP).length(); this.holdError = Vec2.distance(this.hold.getAnchorB(), this.desiredTarget); }
    this.clampSpeeds();
    for (const body of this.dynamicBodies()) {
      const p = body.getPosition(), v = body.getLinearVelocity();
      if (![p.x, p.y, v.x, v.y, body.getAngle(), body.getAngularVelocity()].every(Number.isFinite)) {
        this.fault = '物理計算が不安定になったよ。やりなおしてね'; this.paused = true; this.release(); this.log(this.fault); break;
      }
    }
    this.lastStepMs = performance.now() - start;
  }
  private clampSpeeds() {
    for (const body of this.dynamicBodies()) {
      const velocity = body.getLinearVelocity(), speed = velocity.length();
      if (speed > this.params.maxSpeed) { body.setLinearVelocity(Vec2.mul(this.params.maxSpeed / speed, velocity)); this.speedClamps++; }
      const angular = body.getAngularVelocity(), spinLimit = body === this.heldBody ? this.params.heldSpinLimit : 30;
      if (Math.abs(angular) > spinLimit) body.setAngularVelocity(clamp(angular, -spinLimit, spinLimit));
    }
  }
}
