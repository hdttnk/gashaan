import assert from 'node:assert/strict';
import test from 'node:test';
import { Vec2 } from 'planck';
import { DEFAULTS, FLOOR, LIMITS, PhysicsLab, STEP, WIDTH } from '../src/physics';
import { vertices } from '../src/geometry';

function run(lab: PhysicsLab, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) lab.step();
}
function connected(lab: PhysicsLab) { return lab.wheels.filter(w => w.joint).length; }
function finiteAndContained(lab: PhysicsLab) {
  assert.equal(lab.fault, null);
  for (const body of lab.dynamicBodies()) {
    const p = body.getPosition();
    assert.ok([p.x, p.y, body.getAngle(), body.getLinearVelocity().length()].every(Number.isFinite));
    assert.ok(p.x >= -0.03 && p.x <= WIDTH + 0.03, `x outside walls: ${p.x}`);
    assert.ok(p.y >= -0.03 && p.y <= FLOOR + 0.03, `y outside walls: ${p.y}`);
    assert.ok(body.getLinearVelocity().length() <= lab.params.maxSpeed + 1e-8);
    const points = vertices(lab.partFor(body)!.def.shape, { x: p.x, y: p.y, angle: body.getAngle() });
    // Up to 6 cm solver overlap is tolerated; whole-shape wall tunneling is not.
    for (const point of points) {
      assert.ok(point.x >= -0.06 && point.x <= WIDTH + 0.06, `shape crosses x wall: ${point.x}`);
      assert.ok(point.y >= -0.06 && point.y <= FLOOR + 0.06, `shape crosses y wall: ${point.y}`);
    }
  }
}

test('self-weight remains attached for 120 simulated seconds', () => {
  const lab = new PhysicsLab();
  run(lab, 120);
  assert.equal(connected(lab), 2);
  for (const link of lab.wheels) assert.ok(link.anchorError < 0.016);
  finiteAndContained(lab);
});

test('20 normal rolling trials remain attached and tyres rotate', () => {
  const lab = new PhysicsLab();
  for (let i = 0; i < 20; i++) {
    lab.reset('rolling');
    const x = lab.chassis.getPosition().x;
    run(lab, 2);
    assert.equal(connected(lab), 2);
    assert.ok(lab.chassis.getPosition().x > x + 1);
    assert.ok(Math.abs(lab.wheels[0].body.getAngle()) > 1);
    finiteAndContained(lab);
  }
});

test('weak collision does not detach tyres', () => {
  const lab = new PhysicsLab();
  run(lab, 1);
  lab.fireBall(false);
  run(lab, 7);
  assert.equal(connected(lab), 2);
  assert.ok(lab.maxContactImpulse > 0);
  finiteAndContained(lab);
});

test('20 strong collision trials detach at least one tyre', () => {
  const lab = new PhysicsLab();
  for (let i = 0; i < 20; i++) {
    lab.reset();
    run(lab, 0.5);
    lab.fireBall(true);
    run(lab, 1.5);
    assert.ok(connected(lab) < 2, `trial ${i}, peaks ${lab.wheels.map(w => w.peakImpulse)}`);
    assert.equal(lab.events.filter(e => e.text.includes('が脱落')).length, 2 - connected(lab));
    finiteAndContained(lab);
  }
});

test('high drop causes detachment without invalid state', () => {
  const lab = new PhysicsLab();
  lab.reset('drop');
  run(lab, 3);
  assert.ok(connected(lab) < 2, `peaks ${lab.wheels.map(w => w.peakImpulse)}`);
  finiteAndContained(lab);
});

test('holding lifts quickly, preserves joints, and releases with current momentum', () => {
  const lab = new PhysicsLab();
  run(lab, 0.5);
  assert.ok(lab.beginHold(lab.chassis.getPosition()));
  // A normal hand movement, not an instantaneous 4 m teleport.
  const start = lab.chassis.getPosition().clone();
  for (let i = 1; i <= 120; i++) {
    lab.moveHold(Vec2(start.x, start.y - 3 * i / 120));
    lab.step();
  }
  assert.equal(connected(lab), 2);
  assert.ok(lab.holdError < 0.15, `tracking error ${lab.holdError}`);
  assert.ok(lab.chassis.getPosition().y < start.y - 2.8);
  assert.ok(lab.holdForceMeasured <= lab.params.holdForce + 1e-6);
  lab.moveHold(Vec2(10, start.y - 3));
  run(lab, 0.08);
  const before = lab.chassis.getLinearVelocity().clone();
  lab.release();
  assert.deepEqual(lab.chassis.getLinearVelocity(), before);
  assert.ok(before.x > 0.5);
  run(lab, 1);
  finiteAndContained(lab);
});

test('20 strong collisions preserve tyres while chassis stays held (updated gameplay rule)', () => {
  const lab = new PhysicsLab();
  for (let i = 0; i < 20; i++) {
    lab.reset();
    run(lab, 0.5);
    lab.beginHold(lab.chassis.getPosition());
    const start = lab.chassis.getPosition().clone();
    for (let j = 1; j <= 120; j++) {
      lab.moveHold(Vec2(start.x, start.y - 3 * j / 120));
      lab.step();
    }
    run(lab, 0.5);
    assert.equal(connected(lab), 2);
    lab.fireBall(true);
    run(lab, 1.5);
    assert.ok(lab.hold);
    assert.equal(connected(lab), 2, `trial ${i}: held chassis must protect its tyres`);
    assert.ok(lab.wheels.some(w => w.peakImpulse > lab.params.impactLimit), 'test actually exceeded break limit');
    assert.ok(lab.holdError < 0.15);
    finiteAndContained(lab);
  }
});

test('fast 4 m lift stays connected until a physical collision occurs', () => {
  const lab = new PhysicsLab();
  run(lab, 0.5);
  lab.beginHold(lab.chassis.getPosition());
  lab.moveHold(Vec2(8, 3.5));
  run(lab, 0.5);
  assert.equal(connected(lab), 2);
  assert.ok(lab.holdError < 0.1, `tracking error ${lab.holdError}`);
  finiteAndContained(lab);
});

test('held chassis receives a direct impact as a barrier without losing the grip', () => {
  const lab = new PhysicsLab();
  run(lab, 0.5);
  lab.beginHold(lab.chassis.getPosition());
  const start = lab.chassis.getPosition().clone();
  for (let i = 1; i <= 120; i++) {
    lab.moveHold(Vec2(start.x, start.y - 3 * i / 120));
    lab.step();
  }
  run(lab, 0.5);
  const ball = lab.fireBall(true, 'chassis')!;
  const approachingVelocity = ball.getLinearVelocity().x;
  run(lab, 1.5);
  assert.ok(lab.hold);
  assert.ok(lab.holdError < 0.15);
  assert.ok(lab.maxContactImpulse > 5);
  assert.ok(ball.getLinearVelocity().x * approachingVelocity < 0, 'ball bounces back instead of passing through held chassis');
  finiteAndContained(lab);
});

test('rapid targets, walls and repeated release remain bounded', () => {
  const lab = new PhysicsLab();
  for (let i = 0; i < 2400; i++) {
    if (i % 240 === 0) lab.beginHold(lab.chassis.getPosition());
    lab.moveHold(Vec2(i % 120 < 60 ? -100 : 100, i % 160 < 80 ? -100 : 100));
    if (i % 240 === 200) lab.release();
    lab.step();
    finiteAndContained(lab);
  }
});

test('holding and break parameters take effect without rebuilding the world', () => {
  const lab = new PhysicsLab({ impactLimit: 100, loadLimit: 1000 });
  run(lab, 0.5);
  lab.beginHold(lab.chassis.getPosition());
  lab.params.holdForce = 100;
  lab.params.holdHz = 5;
  lab.step();
  assert.equal(lab.hold!.getMaxForce(), 100);
  assert.equal(lab.hold!.getFrequency(), 5);
  lab.release();
  lab.fireBall(true);
  run(lab, 1.5);
  assert.equal(connected(lab), 2);
  lab.reset();
  lab.params.impactLimit = DEFAULTS.impactLimit;
  lab.params.loadLimit = DEFAULTS.loadLimit;
  lab.fireBall(true);
  run(lab, 1.5);
  assert.ok(connected(lab) < 2);
});

test('persistent overload uses time threshold independently of impact limit', () => {
  const lab = new PhysicsLab({ impactLimit: 1000, loadLimit: 1, loadDuration: 0.1 });
  run(lab, 1);
  assert.ok(connected(lab) < 2);
  assert.ok(lab.events.some(e => e.text.includes('持続荷重')));
});

test('pause releases hold, prevents steps and resumes without time jump', () => {
  const lab = new PhysicsLab();
  lab.beginHold(lab.chassis.getPosition());
  lab.setPaused(true);
  assert.equal(lab.hold, null);
  const position = lab.chassis.getPosition().clone();
  const time = lab.time;
  run(lab, 2);
  assert.deepEqual(lab.chassis.getPosition(), position);
  assert.equal(lab.time, time);
  assert.equal(lab.fireBall(), null);
  lab.setPaused(false);
  lab.step();
  assert.equal(lab.time, time + STEP);
});

test('100 bench resets restore exact body and joint counts; projectiles stay capped', () => {
  const lab = new PhysicsLab();
  for (let i = 0; i < 100; i++) {
    for (let j = 0; j < 8; j++) lab.fireBall();
    assert.equal(lab.balls.length, 4);
    lab.selected = lab.partFor(lab.balls[0])!.id;
    lab.fireBall();
    assert.equal(lab.selected, null, 'replaced projectile must not leave a stale UI selection');
    run(lab, 0.7);
    lab.reset();
    assert.equal(lab.world.getBodyCount(), 4);
    assert.equal(lab.world.getJointCount(), 2);
    assert.equal(lab.balls.length, 0);
    assert.equal(lab.time, 0);
    assert.equal(connected(lab), 2);
  }
});

test('stopped placement moves and rotates the whole connected car; invalid overlap rolls back', () => {
  const lab = new PhysicsLab();
  lab.setPaused(true);
  const start = lab.chassis.getPosition().clone();
  assert.ok(lab.beginEdit(start));
  lab.moveEdit({ x: 5, y: 3 });
  assert.deepEqual(lab.chassis.getPosition(), start, 'preview must not mutate physics');
  assert.ok(lab.commitEdit());
  assert.ok(lab.rotateSelected(Math.PI / 4));
  for (const link of lab.wheels) {
    assert.ok(Vec2.distance(link.joint!.getAnchorA(), link.joint!.getAnchorB()) < 1e-8);
  }
  const before = lab.captureSnapshot();
  assert.ok(lab.beginEdit(lab.chassis.getPosition()));
  lab.moveEdit({ x: -20, y: -20 });
  assert.equal(lab.commitEdit(), false);
  assert.deepEqual(lab.captureSnapshot(), before);
  const block = lab.addObject('block', { x: 10, y: 3 })!;
  assert.ok(block);
  lab.beginEdit(lab.chassis.getPosition());
  lab.moveEdit({ x: 10, y: 3 });
  assert.equal(lab.commitEdit(), false, 'overlapping block must reject placement');
});

test('catalog objects, static ramp and dynamic block/ball behave together', () => {
  const lab = new PhysicsLab(); lab.clear();
  lab.addObject('ramp', { x: 8, y: 6 }, 0.2);
  lab.addObject('block', { x: 4, y: 2 });
  lab.addObject('ball', { x: 7, y: 3 });
  lab.addObject('car', { x: 10, y: 2 });
  const ramp = lab.parts.find(p => p.def.static)!;
  const pose = ramp.body.getPosition().clone();
  lab.setPaused(false); run(lab, 8);
  assert.deepEqual(ramp.body.getPosition(), pose);
  finiteAndContained(lab);
  const block = lab.parts.find(p => p.def.id === 'block')!;
  assert.ok(lab.beginHold(block.body.getPosition()));
  lab.moveHold(Vec2(4, 3)); run(lab, 1);
  assert.ok(lab.holdError < 0.15);
  lab.release();
  assert.equal(lab.beginHold(ramp.body.getPosition()), false);
});

test('redo rebuilds broken joints, poses and zero momentum from a JSON snapshot', () => {
  const lab = new PhysicsLab(); lab.clear();
  lab.addObject('car', { x: 8, y: 2 });
  lab.addObject('block', { x: 3, y: 3 });
  lab.setPaused(false);
  const expected = JSON.parse(JSON.stringify(lab.baseline));
  run(lab, 3); assert.ok(connected(lab) < 2);
  for (let i = 0; i < 100; i++) {
    lab.redo();
    assert.deepEqual(lab.captureSnapshot(), expected);
    assert.equal(lab.world.getJointCount(), 2);
    assert.equal(lab.world.getBodyCount(), 5);
    assert.equal(lab.paused, true);
    assert.equal(lab.time, 0);
    for (const body of lab.dynamicBodies()) assert.equal(body.getLinearVelocity().length(), 0);
    lab.setPaused(false); run(lab, 0.2);
  }
});

test('pause alone keeps redo baseline; editing then playing updates baseline including detached tyres', () => {
  const lab = new PhysicsLab();
  const original = lab.captureSnapshot();
  lab.fireBall(true); run(lab, 2);
  assert.ok(connected(lab) < 2);
  lab.setPaused(true); lab.setPaused(false);
  assert.deepEqual(lab.baseline, original);
  lab.setPaused(true);
  assert.ok(lab.addObject('ball', { x: 8, y: 1.2 }));
  const edited = lab.captureSnapshot();
  lab.setPaused(false);
  assert.equal(lab.paused, false, lab.notice);
  assert.deepEqual(lab.baseline, edited);
  lab.redo();
  const restored = lab.captureSnapshot();
  for (let i = 0; i < edited.parts.length; i++) {
    const expected = edited.parts[i].pose, actual = restored.parts[i].pose;
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8);
    assert.ok(Math.abs(Math.sin(actual.angle - expected.angle)) < 1e-8);
    assert.ok(Math.cos(actual.angle - expected.angle) > 0.999999);
    // Planck normalizes initial angles on construction; compare physical orientation.
    restored.parts[i].pose.angle = expected.angle;
  }
  assert.deepEqual(restored, edited);
});

test('held protection applies only to grabbed car and fresh impacts break again after release', () => {
  const lab = new PhysicsLab(); lab.clear();
  lab.addObject('car', { x: 6, y: 3 });
  lab.addObject('car', { x: 11, y: 1.5 });
  lab.setPaused(false);
  lab.beginHold(lab.chassis.getPosition());
  run(lab, 4);
  assert.equal(lab.wheels.slice(0, 2).filter(w => w.joint).length, 2);
  assert.ok(lab.wheels.slice(2).some(w => !w.joint), 'unheld dropped car must still break');
  lab.fireBall(true); run(lab, 1);
  assert.equal(lab.wheels.slice(0, 2).filter(w => w.joint).length, 2);
  lab.release(); lab.step();
  assert.equal(lab.wheels.slice(0, 2).filter(w => w.joint).length, 2, 'no deferred held damage');
  lab.fireBall(true); run(lab, 1);
  assert.ok(lab.wheels.slice(0, 2).some(w => !w.joint));
});

test('limits prevent excess bodies; clear drops all objects and redo does not resurrect them', () => {
  const lab = new PhysicsLab(); lab.clear();
  for (let i = 0; i < LIMITS.dynamicBodies; i++) {
    assert.ok(lab.addObject('ball', { x: 0.5 + (i % 15), y: 0.5 + Math.floor(i / 15) }));
  }
  assert.equal(lab.addObject('ball', { x: 1, y: 6 }), null);
  assert.equal(lab.dynamicBodies().length, LIMITS.dynamicBodies);
  lab.setPaused(false); run(lab, 2); finiteAndContained(lab);
  lab.clear(); lab.redo();
  assert.equal(lab.objects.length, 0);
  assert.equal(lab.world.getBodyCount(), 1);
  assert.equal(lab.world.getJointCount(), 0);
});

test('unbreakable mode preserves unheld tyres through strong impacts and disabling restores breakage', () => {
  const lab = new PhysicsLab();
  lab.setTyresUnbreakable(true);
  run(lab, 0.5);
  const impactSetup = lab.captureSnapshot();
  lab.fireBall(true); run(lab, 2);
  assert.equal(lab.hold, null);
  assert.equal(connected(lab), 2);
  assert.ok(lab.wheels.some(w => w.peakImpulse > lab.params.impactLimit));
  assert.ok(lab.maxContactImpulse > 0, 'collisions remain active');
  // Compare the same impact geometry; the first impact otherwise moves the target.
  lab.restoreSnapshot(impactSetup); lab.setPaused(false);
  lab.setTyresUnbreakable(false);
  lab.fireBall(true); run(lab, 2);
  assert.ok(connected(lab) < 2);
  finiteAndContained(lab);
});

test('unbreakable mode suppresses sustained overload without accumulating delayed damage', () => {
  const lab = new PhysicsLab({ impactLimit: 1000, loadLimit: 1, loadDuration: 0.1 });
  lab.setTyresUnbreakable(true); run(lab, 2);
  assert.equal(connected(lab), 2);
  assert.ok(lab.wheels.every(w => w.loadTime === 0));
  lab.setTyresUnbreakable(false); lab.step();
  assert.equal(connected(lab), 2, 'old overload must not cause immediate breakage');
  run(lab, 1);
  assert.ok(connected(lab) < 2, 'fresh sustained overload is counted');
});

test('mode is restored with the configuration and never repairs an already detached tyre', () => {
  const lab = new PhysicsLab();
  lab.fireBall(true); run(lab, 2);
  const detached = lab.detachedCount;
  assert.ok(detached > 0);
  lab.setPaused(true); lab.setTyresUnbreakable(true);
  assert.equal(lab.detachedCount, detached);
  lab.setPaused(false);
  assert.equal(lab.paused, false);
  lab.setTyresUnbreakable(false);
  lab.redo();
  assert.equal(lab.tyresUnbreakable, true);
  assert.equal(lab.detachedCount, detached);
  const legacy = lab.captureSnapshot(); delete legacy.rules;
  lab.restoreSnapshot(legacy);
  assert.equal(lab.tyresUnbreakable, false, 'older snapshots retain original gameplay');
});

test('both patterned balls roll and keep their distinct definitions through redo', () => {
  const lab = new PhysicsLab(); lab.clear();
  assert.ok(lab.addObject('ramp', { x: 8, y: 5 }, 0.2));
  assert.ok(lab.addObject('ball', { x: 7, y: 2 }));
  assert.ok(lab.addObject('baseball', { x: 9, y: 2 }));
  lab.setPaused(false);
  const original = lab.captureSnapshot();
  run(lab, 4);
  for (const p of lab.parts.filter(p => p.def.role === 'ball')) assert.ok(Math.abs(p.body.getAngle()) > 0.1, 'ball should rotate on ramp');
  finiteAndContained(lab);
  lab.redo();
  const restored = lab.captureSnapshot();
  for (let i = 0; i < restored.parts.length; i++) {
    assert.ok(Math.abs(restored.parts[i].pose.angle - original.parts[i].pose.angle) < 1e-8);
    restored.parts[i].pose.angle = original.parts[i].pose.angle;
  }
  assert.deepEqual(restored, original);
  assert.deepEqual(lab.objects.map(o => o.kind), ['ramp', 'ball', 'baseball']);
});

test('emergency vehicles carry their own mass and axles, survive normal rolling and restore', () => {
  for (const kind of ['police', 'ambulance', 'firetruck'] as const) {
    const lab = new PhysicsLab(); lab.clear();
    const object = lab.addObject(kind, { x: 8, y: FLOOR - (kind === 'police' ? 0.76 : kind === 'ambulance' ? 0.97 : 1.08) - 0.015 });
    assert.ok(object); const snapshot = JSON.parse(JSON.stringify(lab.captureSnapshot()));
    lab.setPaused(false);
    for (const body of lab.dynamicBodies()) body.setLinearVelocity(Vec2(2.5, 0));
    for (const w of lab.wheels) { const shape = lab.partFor(w.body)!.def.shape; assert.equal(shape.type, 'circle'); if (shape.type === 'circle') w.body.setAngularVelocity(2.5 / shape.radius); }
    run(lab, 2); assert.equal(connected(lab), 2, kind); assert.ok(Math.abs(lab.wheels[0].body.getAngle()) > 1, kind); finiteAndContained(lab);
    run(lab, 30); assert.equal(connected(lab), 2, kind);
    lab.restoreSnapshot(snapshot); assert.equal(lab.objects[0].kind, kind); assert.equal(connected(lab), 2); finiteAndContained(lab);
  }
});

test('new vehicles lift with protected tyres and break after an unheld high drop', () => {
  for (const kind of ['police', 'ambulance', 'firetruck'] as const) {
    const lab = new PhysicsLab(); lab.clear(); assert.ok(lab.addObject(kind, { x: 8, y: 7 }));
    lab.setPaused(false); assert.ok(lab.beginHold(lab.chassis.getPosition()));
    lab.moveHold(Vec2(8, 3)); run(lab, 0.6);
    assert.ok(lab.chassis.getPosition().y < 3.3, kind); assert.equal(connected(lab), 2, kind);
    run(lab, 1); assert.equal(connected(lab), 2); finiteAndContained(lab);
    lab.release(); run(lab, 4); assert.ok(connected(lab) < 2, kind); finiteAndContained(lab);
    lab.redo(); assert.equal(connected(lab), 2); assert.equal(lab.objects[0].kind, kind);
  }
});

test('triangle and long block collide, hold and restore with their physical shapes', () => {
  const lab = new PhysicsLab(); lab.clear();
  assert.ok(lab.addObject('triangle', { x: 5, y: 3 }));
  assert.ok(lab.addObject('rectangle', { x: 9, y: 3 }, Math.PI / 6));
  const snapshot = JSON.parse(JSON.stringify(lab.captureSnapshot()));
  const triangle = lab.parts[0];
  assert.equal(lab.pick({ x: 5.54, y: 2.38 }), null, 'empty upper corner is not a triangle');
  assert.equal(lab.pick({ x: 5, y: 2.5 })?.id, triangle.id);
  lab.setPaused(false); run(lab, 3); finiteAndContained(lab);
  assert.ok(lab.beginHold(triangle.body.getPosition())); lab.moveHold(Vec2(5, 2)); run(lab, 0.6);
  assert.ok(triangle.body.getPosition().y < 2.4); finiteAndContained(lab); lab.release();
  lab.restoreSnapshot(snapshot); assert.deepEqual(lab.objects.map(o => o.kind), ['triangle', 'rectangle']);
  assert.equal(lab.parts[0].body.getMass(), 0.7);
});

test('responsive arena preserves connected shapes and redo across portrait and landscape', () => {
  const lab = new PhysicsLab(); lab.setPaused(true);
  lab.addObject('firetruck', { x: 3, y: 2 });
  lab.setPaused(false); run(lab, 1); lab.setPaused(true);
  const masses = lab.parts.map(p => p.body.getMass());
  const before = lab.parts.map(p => p.id);
  for (const [width, height] of [[8.6, 18.6], [18.6, 8.6], [8.6, 18.6]]) {
    lab.resizeArena(width, height);
    assert.equal(lab.paused, true);
    assert.deepEqual(lab.parts.map(p => p.id), before);
    assert.deepEqual(lab.parts.map(p => p.body.getMass()), masses);
    for (const part of lab.parts) for (const p of vertices(part.def.shape, { ...part.body.getPosition(), angle: part.body.getAngle() })) {
      assert.ok(p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height);
    }
    for (const link of lab.wheels) if (link.joint) assert.ok(Vec2.distance(link.joint.getAnchorA(), link.joint.getAnchorB()) < 0.03);
  }
  lab.redo(); assert.equal(lab.width, 8.6); assert.equal(lab.height, 18.6);
  assert.equal(connected(lab), 4);
  lab.restoreSnapshot(JSON.parse(JSON.stringify(lab.captureSnapshot())));
  assert.equal(lab.width, 8.6); assert.equal(lab.height, 18.6);
  lab.clear(); assert.equal(lab.width, 8.6);
});

test('old snapshots retain default bounds; invalid bounds are rejected without mutation', () => {
  const lab = new PhysicsLab(); const snapshot = lab.captureSnapshot(); delete snapshot.bounds;
  lab.resizeArena(8.6, 18.6); lab.restoreSnapshot(snapshot);
  assert.equal(lab.width, WIDTH); assert.equal(lab.height, FLOOR);
  const before = lab.world; snapshot.bounds = { width: NaN, height: 9 };
  assert.throws(() => lab.restoreSnapshot(snapshot)); assert.equal(lab.world, before);
});
