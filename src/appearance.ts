// Asset URLs are kept out of the physics/catalog runtime. Type-only references are safe in Node tests.
// No inlining: Phaser's SVG loader treats data URLs as base64.
import carBody from './assets/car-body.svg?url&no-inline';
import police from './assets/police-body.svg?url&no-inline';
import ambulance from './assets/ambulance-body.svg?url&no-inline';
import firetruck from './assets/firetruck-body.svg?url&no-inline';
import triangle from './assets/wood-triangle.svg?url&no-inline';
import wheel from './assets/car-wheel.svg?url&no-inline';
import block from './assets/wood-block.svg?url&no-inline';
import soccer from './assets/soccer-ball.svg?url&no-inline';
import baseball from './assets/baseball.svg?url&no-inline';
import ramp from './assets/wood-ramp.svg?url&no-inline';
import workshop from './assets/workshop-interior.svg?url&no-inline';

export interface AppearanceDef {
  url: string; rasterWidth: number; rasterHeight: number;
  size?: { width: number; height: number }; // World units. Defaults to the physical shape bounds.
  origin?: { x: number; y: number }; // Texture coordinate of the body's local origin.
  layer: number;
}
export const APPEARANCES = {
  'car-body': { url: carBody, rasterWidth: 880, rasterHeight: 356, size: { width: 2.2, height: 0.89 }, origin: { x: 0.5, y: 132 / 178 }, layer: 2 },
  'police-body': { url: police, rasterWidth: 880, rasterHeight: 356, size: { width: 2.2, height: 0.89 }, origin: { x: 0.5, y: 132 / 178 }, layer: 2 },
  'ambulance-body': { url: ambulance, rasterWidth: 1080, rasterHeight: 500, size: { width: 2.7, height: 1.25 }, origin: { x: 0.5, y: 150 / 250 }, layer: 2 },
  'firetruck-body': { url: firetruck, rasterWidth: 1200, rasterHeight: 540, size: { width: 3, height: 1.35 }, origin: { x: 0.5, y: 150 / 270 }, layer: 2 },
  'wood-triangle': { url: triangle, rasterWidth: 660, rasterHeight: 570, layer: 2 },
  'car-wheel': { url: wheel, rasterWidth: 256, rasterHeight: 256, layer: 3 },
  'wood-block': { url: block, rasterWidth: 256, rasterHeight: 256, layer: 2 },
  'soccer-ball': { url: soccer, rasterWidth: 256, rasterHeight: 256, layer: 2 },
  baseball: { url: baseball, rasterWidth: 256, rasterHeight: 256, layer: 2 },
  'wood-ramp': { url: ramp, rasterWidth: 1200, rasterHeight: 66, layer: 1 },
} satisfies Record<string, AppearanceDef>;
export type AppearanceId = keyof typeof APPEARANCES;
export const WORKSHOP = { url: workshop, width: 1576, height: 848 };
