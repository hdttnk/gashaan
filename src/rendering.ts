import * as Phaser from 'phaser';
import { APPEARANCES, WORKSHOP, type AppearanceDef } from './appearance';
import { localVertices, shapeBounds } from './geometry';
import { type PhysicsLab } from './physics';

export interface ViewTransform { scale: number; originX: number; originY: number }
export function preloadAppearance(scene: Phaser.Scene) {
  for (const [key, def] of Object.entries(APPEARANCES)) scene.load.svg(key, def.url, { width: def.rasterWidth, height: def.rasterHeight });
  scene.load.svg('workshop', WORKSHOP.url, { width: WORKSHOP.width, height: WORKSHOP.height });
}

/** One renderer for all defined parts. Physical pose and appearance share the local origin. */
export class SandboxRenderer {
  private background: Phaser.GameObjects.Image;
  private fallback: Phaser.GameObjects.Graphics;
  private overlay: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, Phaser.GameObjects.Image>();

  constructor(private scene: Phaser.Scene) {
    this.background = scene.add.image(0, 0, 'workshop').setOrigin(0).setDepth(-2);
    this.fallback = scene.add.graphics().setDepth(1);
    this.overlay = scene.add.graphics().setDepth(10);
  }
  render(lab: PhysicsLab, view: ViewTransform, debug: boolean) {
    const { scale, originX, originY } = view;
    // Crop decorative perimeter so only the wall interior fills the viewport.
    this.background.setPosition(originX, originY).setDisplaySize(lab.width * scale, lab.height * scale);
    const live = new Set(lab.parts.map(p => p.id));
    for (const [id, sprite] of this.sprites) if (!live.has(id)) { sprite.destroy(); this.sprites.delete(id); }
    const g = this.fallback, overlay = this.overlay;
    g.clear(); overlay.clear();
    if (debug) {
      overlay.lineStyle(1, 0x586f73, 0.15);
      for (let x = 1; x < lab.width; x++) overlay.lineBetween(originX + x * scale, originY, originX + x * scale, originY + lab.height * scale);
      for (let y = 1; y < lab.height; y++) overlay.lineBetween(originX, originY + y * scale, originX + lab.width * scale, originY + y * scale);
    }
    const selected = new Set(lab.paused && lab.selected ? lab.group(lab.selected).map(p => p.id) : []);
    for (const part of lab.parts) {
      const pose = lab.editPreview?.get(part.id), p = pose ?? part.body.getPosition();
      const angle = pose?.angle ?? part.body.getAngle(), shape = part.def.shape;
      const x = originX + p.x * scale, y = originY + p.y * scale;
      if (part.def.appearance) {
        const key = part.def.appearance, def: AppearanceDef = APPEARANCES[key];
        let sprite = this.sprites.get(part.id);
        if (!sprite) { sprite = this.scene.add.image(x, y, key); this.sprites.set(part.id, sprite); }
        if (sprite.texture.key !== key) sprite.setTexture(key); // IDs can be reused after clear/restore.
        const bounds = shapeBounds(shape), size = def.size ?? bounds;
        sprite.setOrigin(def.origin?.x ?? bounds.origin.x, def.origin?.y ?? bounds.origin.y).setDepth(def.layer);
        sprite.setPosition(x, y).setRotation(angle).setDisplaySize(size.width * scale, size.height * scale);
        sprite.setTint(part.body === lab.heldBody ? 0xffefca : 0xffffff);
      } else {
        const stale = this.sprites.get(part.id);
        if (stale) { stale.destroy(); this.sprites.delete(part.id); }
        g.save(); g.translateCanvas(x, y); g.rotateCanvas(angle); g.fillStyle(part.def.color);
        if (shape.type === 'circle') g.fillCircle(0, 0, shape.radius * scale);
        else if (shape.type === 'polygon') g.fillPoints(localVertices(shape).map(p => new Phaser.Math.Vector2(p.x * scale, p.y * scale)), true);
        else g.fillRect(-shape.width * scale / 2, -shape.height * scale / 2, shape.width * scale, shape.height * scale);
        g.restore();
      }
      if (selected.has(part.id) || debug) {
        overlay.save(); overlay.translateCanvas(x, y); overlay.rotateCanvas(angle);
        const invalid = pose && !lab.editValid;
        overlay.lineStyle(selected.has(part.id) ? 2 : 1, invalid ? 0xd43d4b : selected.has(part.id) ? 0xba7216 : 0x317b82, selected.has(part.id) ? 1 : 0.5);
        if (shape.type === 'circle') overlay.strokeCircle(0, 0, shape.radius * scale + (selected.has(part.id) ? 3 : 0));
        else if (shape.type === 'polygon') overlay.strokePoints(localVertices(shape).map(p => new Phaser.Math.Vector2(p.x * scale, p.y * scale)), true);
        else overlay.strokeRect(-shape.width * scale / 2, -shape.height * scale / 2, shape.width * scale, shape.height * scale);
        overlay.restore();
      }
    }
    if (debug && !lab.editPreview) for (const link of lab.wheels) {
      if (!link.joint) continue;
      const p = link.joint.getAnchorA(), q = link.joint.getAnchorB();
      overlay.lineStyle(2, 0x277d60);
      overlay.lineBetween(originX + p.x * scale, originY + p.y * scale, originX + q.x * scale, originY + q.y * scale);
      overlay.fillStyle(0x277d60); overlay.fillCircle(originX + q.x * scale, originY + q.y * scale, 2);
    }
    if (lab.hold) {
      const p = lab.hold.getAnchorB();
      overlay.lineStyle(2, 0xb77116, 0.8);
      overlay.lineBetween(originX + p.x * scale, originY + p.y * scale, originX + lab.desiredTarget.x * scale, originY + lab.desiredTarget.y * scale);
      overlay.strokeCircle(originX + lab.desiredTarget.x * scale, originY + lab.desiredTarget.y * scale, 7);
    }
  }
}
