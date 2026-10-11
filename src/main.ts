import * as Phaser from 'phaser';
import { Vec2 } from 'planck';
import { DEFAULTS, PhysicsLab, STEP, type Parameters } from './physics';
import { CATALOG, type Kind } from './catalog';
import { SandboxRenderer, preloadAppearance } from './rendering';
import './style.css';

const lab = new PhysicsLab();
lab.setPaused(true);
const ui = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
for (const [kind, def] of Object.entries(CATALOG)) {
  const button = document.createElement('button');
  button.id = `add-${kind}`;
  button.textContent = `${def.icon} ${def.label}`;
  ui('palette').append(button);
}
let activePointer: number | null = null;
let interaction: 'edit' | 'hold' | null = null;
let accumulator = 0;
let droppedTime = 0;
let frameMs = 0;
let scale = 1;
let originX = 0;
let originY = 0;
let lastUi = 0;
let testLift: { x: number; y: number; elapsed: number } | null = null;
let testHold = false;
const fireBall = (strong = true) => lab.fireBall(strong, ui<HTMLSelectElement>('aim').value as 'wheel' | 'chassis');

class LabScene extends Phaser.Scene {
  private visuals!: SandboxRenderer;
  preload() { preloadAppearance(this); }
  create() {
    this.fitArena();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitArena());
    this.visuals = new SandboxRenderer(this);
    const canvas = this.game.canvas;
    const point = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return Vec2(((event.clientX - rect.left) * this.scale.width / rect.width - originX) / scale,
        ((event.clientY - rect.top) * this.scale.height / rect.height - originY) / scale);
    };
    canvas.addEventListener('pointerdown', event => {
      if (activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const started = lab.paused ? lab.beginEdit(point(event)) : lab.beginHold(point(event));
      if (started) {
        interaction = lab.paused ? 'edit' : 'hold';
        testLift = null;
        testHold = false;
        activePointer = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
      }
      renderMetrics();
    });
    canvas.addEventListener('pointermove', event => {
      if (activePointer === event.pointerId) {
        if (interaction === 'edit') lab.moveEdit(point(event));
        else lab.moveHold(point(event));
      }
    });
    const end = (event: PointerEvent) => {
      if (activePointer !== event.pointerId) return;
      if (interaction === 'edit') {
        if (event.type === 'pointerup') lab.commitEdit(); else lab.cancelEdit();
      } else lab.release();
      activePointer = null;
      interaction = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      renderMetrics();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
  }

  update(_time: number, delta: number) {
    frameMs = delta;
    if (!lab.paused) {
      accumulator += Math.min(delta / 1000, 0.1);
      let steps = 0;
      while (accumulator >= STEP && steps < 8) {
        if (testLift && lab.hold) {
          testLift.elapsed = Math.min(1, testLift.elapsed + STEP);
          lab.moveHold(Vec2(testLift.x, Math.max(1, testLift.y - 3 * testLift.elapsed)));
          if (testLift.elapsed === 1) testLift = null;
        }
        lab.step();
        accumulator -= STEP;
        steps++;
      }
      if (accumulator >= STEP) {
        droppedTime += accumulator;
        accumulator = 0;
      }
    } else accumulator = 0;
    this.draw();
    if (performance.now() - lastUi > 100) {
      renderMetrics();
      lastUi = performance.now();
    }
  }

  fitArena() {
    cancelInteraction();
    const portrait = this.scale.width < this.scale.height;
    ui('rotate-hint').hidden = !portrait;
    ui('app').inert = portrait;
    if (portrait) { closePalette(); if (debugPanel.open) debugPanel.close(); lab.setPaused(true); renderMetrics(); return; }
    const ratio = this.scale.width / Math.max(this.scale.height, 1);
    // Keep an 8.6 m short side. Physics dimensions never use pixel units.
    lab.resizeArena(ratio >= 1 ? 8.6 * ratio : 8.6, ratio >= 1 ? 8.6 : 8.6 / ratio);
    renderMetrics();
  }

  draw() {
    const width = this.scale.width, height = this.scale.height;
    scale = Math.min(width / lab.width, height / lab.height);
    originX = (width - lab.width * scale) / 2;
    originY = (height - lab.height * scale) / 2;
    this.visuals.render(lab, { scale, originX, originY }, ui<HTMLDialogElement>('debug').open);
  }

}

const specs: { key: keyof Parameters; label: string; unit: string; min: number; max: number; step: number }[] = [
  { key: 'holdForce', label: '保持力の上限', unit: 'N', min: 100, max: 6000, step: 100 },
  { key: 'holdHz', label: '位置の追従', unit: 'Hz', min: 2, max: 30, step: 1 },
  { key: 'holdDamping', label: '保持の揺れ止め', unit: '', min: 0.2, max: 1.5, step: 0.05 },
  { key: 'targetSpeed', label: '目標の移動速度上限', unit: 'm/s', min: 3, max: 40, step: 1 },
  { key: 'angleStiffness', label: '姿勢を戻す強さ', unit: 'N·m/rad', min: 0, max: 500, step: 10 },
  { key: 'angleDamping', label: '姿勢の揺れ止め', unit: 'N·m·s/rad', min: 0, max: 60, step: 1 },
  { key: 'maxTorque', label: '姿勢制御トルク上限', unit: 'N·m', min: 20, max: 1600, step: 20 },
  { key: 'heldSpinLimit', label: '保持中の回転速度上限', unit: 'rad/s', min: 1, max: 12, step: 0.5 },
  { key: 'holdClearance', label: '保持時の壁との余裕', unit: 'm', min: 0.1, max: 0.6, step: 0.05 },
  { key: 'maxSpeed', label: '物体の速度上限', unit: 'm/s', min: 5, max: 30, step: 1 },
  { key: 'impactLimit', label: '脱落する衝撃の強さ', unit: 'N·s', min: 0.2, max: 40, step: 0.1 },
  { key: 'loadLimit', label: '持続荷重の限界', unit: 'N', min: 30, max: 1000, step: 10 },
  { key: 'loadDuration', label: '荷重に耐える時間', unit: 's', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'gravity', label: '重力', unit: 'm/s²', min: 0, max: 20, step: 0.2 },
];
for (const spec of specs) {
  const label = document.createElement('label');
  label.className = 'parameter';
  const title = document.createElement('span');
  title.textContent = spec.label;
  const output = document.createElement('output');
  output.id = `value-${spec.key}`;
  const input = document.createElement('input');
  input.id = `param-${spec.key}`;
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(lab.params[spec.key]);
  input.addEventListener('input', () => { lab.params[spec.key] = Number(input.value); lab.settingsChanged(); syncParameters(); });
  label.append(title, output, input);
  ui('parameters').append(label);
}
function syncParameters() {
  ui<HTMLInputElement>('tyres-unbreakable').checked = lab.tyresUnbreakable;
  for (const spec of specs) {
    (ui<HTMLInputElement>(`param-${spec.key}`)).value = String(lab.params[spec.key]);
    ui(`value-${spec.key}`).textContent = `${Number(lab.params[spec.key].toFixed(2))} ${spec.unit}`;
  }
}
function renderMetrics() {
  const speed = lab.heldBody?.getLinearVelocity().length() ?? 0;
  if (ui<HTMLDialogElement>('debug').open) {
  ui('metrics').innerHTML = `<dl>
    <dt>保持の実測 / 上限</dt><dd>${lab.holdForceMeasured.toFixed(0)} / ${lab.params.holdForce} N</dd>
    <dt>保持目標との距離</dt><dd>${(lab.holdError * 100).toFixed(1)} cm</dd>
    <dt>保持している物体の速度</dt><dd>${speed.toFixed(2)} m/s</dd>
    <dt>動的剛体 / 接続</dt><dd>${lab.dynamicBodies().length} / ${lab.wheels.filter(w => w.joint).length}</dd>
    <dt>物理刻み</dt><dd>120 Hz / 10・6反復</dd>
    <dt>物理1ステップ / 描画間隔</dt><dd>${lab.lastStepMs.toFixed(2)} / ${frameMs.toFixed(1)} ms</dd>
    <dt>速度制限 / 捨てた蓄積時間</dt><dd>${lab.speedClamps} 回 / ${droppedTime.toFixed(2)} s</dd>
    <dt>最大接触インパルス</dt><dd>${lab.maxContactImpulse.toFixed(2)} N·s</dd>
  </dl>${lab.wheels.map(link => `<div class="wheel-metric"><b>${link.id} · ${link.joint ? '接続中' : '脱落'}</b>
    <div>${link.joint ? '負荷' : '脱落時の負荷'} ${link.force.toFixed(1)} N / 最大 ${link.peakForce.toFixed(1)} N</div>
    <div>衝撃指標 ${link.impulse.toFixed(2)} / 最大 ${link.peakImpulse.toFixed(2)} N·s</div>
    <div>接続ずれ ${(link.anchorError * 1000).toFixed(1)} mm · 過荷重 ${link.loadTime.toFixed(3)} s</div></div>`).join('')}`;
  ui('events').replaceChildren(...lab.events.map(event => {
    const li = document.createElement('li');
    li.textContent = `${event.time.toFixed(2)}s · ${event.text}`;
    return li;
  }));
  }
  ui('status').textContent = lab.fault ?? (lab.notice || `${lab.paused ? 'とまってる' : lab.hold ? 'つかんでる：タイヤを保護中' : 'うごいてる'} · ${lab.objects.length}個のもの · ${lab.wheels.filter(w => w.joint).length}/${lab.wheels.length}本の接続${lab.dirty ? ' · 次の再生で戻り先を更新' : ''}`);
  ui('status').hidden = !lab.notice && !lab.fault;
  ui('pause').textContent = lab.paused ? '▶ 再生' : '⏸ とめる';
  ui('debug-play').textContent = ui('pause').textContent;
  ui('instruction').textContent = lab.paused ? '＋ ものから選んで、つかんで置こう' : 'つかんで動かして、はなして投げよう';

  const selected = lab.selected ? lab.part(lab.selected) : null;
  ui('selection').textContent = selected ? `${CATALOG[lab.objects.find(o => o.id === selected.objectId)!.kind].label}${selected.def.role === 'wheel' ? 'の外れたタイヤ' : ''}を選択中` : '動かしたいものをつかんでね';
  ui('edit-controls').hidden = !lab.paused || !selected;
  for (const kind of Object.keys(CATALOG)) ui<HTMLButtonElement>(`add-${kind}`).disabled = !lab.paused;
  for (const id of ['rotate-left', 'rotate-right']) ui<HTMLButtonElement>(id).disabled = !lab.paused || !selected || activePointer !== null;
  for (const id of ['impact', 'gentle']) ui<HTMLButtonElement>(id).disabled = lab.paused || !lab.parts.some(p => p.def.role === 'chassis');
  ui('hold-test').textContent = testHold && lab.hold ? '試験の保持をはなす' : '空中で保持（試験）';
}
function cancelInteraction() {
  testLift = null;
  testHold = false;
  activePointer = null;
  interaction = null;
  lab.release();
  lab.cancelEdit();
  accumulator = 0;
}
function reset() {
  cancelInteraction();
  lab.redo();
  droppedTime = 0;
  syncParameters();
  renderMetrics();
}
ui('reset').addEventListener('click', () => { closePalette(); reset(); });
ui('tyres-unbreakable').addEventListener('change', () => {
  lab.setTyresUnbreakable(ui<HTMLInputElement>('tyres-unbreakable').checked);
  renderMetrics();
});
ui('clear').addEventListener('click', () => { cancelInteraction(); lab.clear(); droppedTime = 0; renderMetrics(); });
for (const kind of Object.keys(CATALOG) as Kind[]) ui(`add-${kind}`).addEventListener('click', () => { cancelInteraction(); if (lab.addObject(kind)) closePalette(); renderMetrics(); });
ui('rotate-left').addEventListener('click', () => { lab.rotateSelected(-Math.PI / 12); renderMetrics(); });
ui('rotate-right').addEventListener('click', () => { lab.rotateSelected(Math.PI / 12); renderMetrics(); });
ui('impact').addEventListener('click', () => fireBall(true));
ui('gentle').addEventListener('click', () => fireBall(false));
ui('hold-test').addEventListener('click', () => {
  if (testHold && lab.hold) { testLift = null; testHold = false; lab.release(); return; }
  cancelInteraction();
  const car = lab.parts.find(p => p.def.role === 'chassis');
  if (!car) { lab.notice = '車を置いてから試してね'; return; }
  lab.setPaused(false);
  if (!lab.beginHold(car.body.getPosition())) return;
  testLift = { x: car.body.getPosition().x, y: car.body.getPosition().y, elapsed: 0 };
  testHold = true;
  lab.log('自動保持試験：1秒で3m持ち上げる（通常と同じ有限力）');
});
const togglePlay = () => { cancelInteraction(); closePalette(); lab.setPaused(!lab.paused); renderMetrics(); };
ui('pause').addEventListener('click', togglePlay);
ui('debug-play').addEventListener('click', togglePlay);
ui('preset-light').addEventListener('click', () => { Object.assign(lab.params, DEFAULTS); lab.settingsChanged(); syncParameters(); lab.log('軽快プリセット'); });
ui('preset-soft').addEventListener('click', () => {
  Object.assign(lab.params, DEFAULTS, { holdForce: 600, holdHz: 5, targetSpeed: 12, angleStiffness: 60, angleDamping: 12 });
  lab.settingsChanged(); syncParameters(); lab.log('やわらかい保持プリセット');
});

function closePalette() {
  ui('object-panel').hidden = true;
  ui('palette-toggle').setAttribute('aria-expanded', 'false');
}
ui('palette-toggle').addEventListener('click', () => {
  if (!ui('object-panel').hidden) { closePalette(); return; }
  cancelInteraction(); lab.setPaused(true);
  ui('object-panel').hidden = false;
  ui('palette-toggle').setAttribute('aria-expanded', 'true');
  renderMetrics();
});
ui('palette-close').addEventListener('click', () => { closePalette(); ui('palette-toggle').focus(); });
const debugPanel = ui<HTMLDialogElement>('debug');
ui('developer-toggle').addEventListener('click', () => {
  closePalette(); cancelInteraction(); lab.setPaused(true);
  debugPanel.showModal(); renderMetrics();
});
const closeDebug = () => { cancelInteraction(); lab.setPaused(true); debugPanel.close(); renderMetrics(); };
ui('developer-close').addEventListener('click', closeDebug);
debugPanel.addEventListener('cancel', event => { event.preventDefault(); closeDebug(); });
debugPanel.addEventListener('click', event => { if (event.target === debugPanel) { const r = debugPanel.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDebug(); } });

window.addEventListener('keydown', event => {
  if (debugPanel.open || !ui('rotate-hint').hidden) return;
  if (event.key === 'Escape') closePalette();
  if (event.repeat || (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
  if (event.key.toLowerCase() === 'b') fireBall(true);
  if (event.key.toLowerCase() === 'g') fireBall(false);
  if (event.key.toLowerCase() === 'r') reset();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (lab.paused && lab.selected) { event.preventDefault(); lab.rotateSelected((event.key === 'ArrowLeft' ? -1 : 1) * Math.PI / 12); renderMetrics(); }
  }
  if (event.code === 'Space' && !(event.target instanceof HTMLElement && event.target.closest('button, summary'))) { event.preventDefault(); togglePlay(); }
});
const suspend = () => {
  cancelInteraction();
  lab.setPaused(true);
  renderMetrics();
};
window.addEventListener('blur', suspend);
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('resize', () => { cancelInteraction(); });
syncParameters();
renderMetrics();

new Phaser.Game({
  type: Phaser.AUTO, parent: 'stage', backgroundColor: '#e6e5dc',
  width: 960, height: 540, scene: LabScene,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true },
});
