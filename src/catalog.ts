import type { AppearanceId } from './appearance';
export interface XY { x: number; y: number }
export type ShapeDef = { type: 'box'; width: number; height: number } | { type: 'circle'; radius: number } | { type: 'polygon'; vertices: XY[] };
export interface PartDef {
  id: string; role: 'chassis' | 'wheel' | 'block' | 'ball' | 'ramp';
  position: XY; shape: ShapeDef; mass: number; friction: number; restitution: number;
  color: number; static?: boolean; appearance?: AppearanceId;
}
export interface JointDef { id: string; a: string; b: string; anchorA: XY; anchorB: XY }
export interface ObjectDef { version: number; label: string; icon: string; parts: PartDef[]; joints: JointDef[] }
function defineCatalog<K extends string>(entries: Record<K, ObjectDef>) { return entries; }
type VehiclePart = Omit<PartDef, 'id' | 'role' | 'position'>;
export interface VehicleSpec {
  version: number; label: string; icon: string;
  chassis: VehiclePart; wheel: VehiclePart; axles: XY[];
}
// The same assembly handles passenger cars, patrol cars, vans and vehicles with more axles.
// Axles are chassis-local coordinates; visuals never define the joint positions.
export function vehicleDefinition(spec: VehicleSpec): ObjectDef {
  return { version: spec.version, label: spec.label, icon: spec.icon, parts: [
    { ...spec.chassis, id: 'body', role: 'chassis', position: { x: 0, y: 0 } },
    ...spec.axles.map((position, i): PartDef => ({ ...spec.wheel, id: `wheel-${i}`, role: 'wheel', position: { ...position } })),
  ], joints: spec.axles.map((anchorA, i) => ({ id: `axle-${i}`, a: 'body', b: `wheel-${i}`, anchorA: { ...anchorA }, anchorB: { x: 0, y: 0 } })) };
}
function ballDefinition(label: string, icon: string, appearance: AppearanceId): ObjectDef {
  return { version: 1, label, icon, parts: [
    { id: 'ball', role: 'ball', position: { x: 0, y: 0 }, shape: { type: 'circle', radius: 0.38 }, mass: 1, friction: 0.35, restitution: 0.45, color: 0x61d5d0, appearance },
  ], joints: [] };
}

// Visuals, physical parts and connection topology are definitions, not object-specific code.
export const CATALOG = defineCatalog({
  car: vehicleDefinition({ version: 2, label: 'くるま', icon: '🚗',
    chassis: { shape: { type: 'box', width: 2.2, height: 0.36 }, mass: 4, friction: 0.45, restitution: 0.05, color: 0xffae64, appearance: 'car-body' },
    wheel: { shape: { type: 'circle', radius: 0.32 }, mass: 0.7, friction: 0.85, restitution: 0.08, color: 0x142132, appearance: 'car-wheel' },
    axles: [{ x: -0.75, y: 0.44 }, { x: 0.75, y: 0.44 }],
  }),
  police: vehicleDefinition({ version: 1, label: 'パトカー', icon: '🚓',
    chassis: { shape: { type: 'box', width: 2.2, height: 0.36 }, mass: 4, friction: 0.45, restitution: 0.05, color: 0xffffff, appearance: 'police-body' },
    wheel: { shape: { type: 'circle', radius: 0.32 }, mass: 0.7, friction: 0.85, restitution: 0.08, color: 0x142132, appearance: 'car-wheel' },
    axles: [{ x: -0.75, y: 0.44 }, { x: 0.75, y: 0.44 }],
  }),
  ambulance: vehicleDefinition({ version: 1, label: 'きゅうきゅうしゃ', icon: '🚑',
    chassis: { shape: { type: 'box', width: 2.7, height: 0.85 }, mass: 5, friction: 0.45, restitution: 0.05, color: 0xffffff, appearance: 'ambulance-body' },
    wheel: { shape: { type: 'circle', radius: 0.32 }, mass: 0.8, friction: 0.85, restitution: 0.08, color: 0x142132, appearance: 'car-wheel' },
    axles: [{ x: -0.9, y: 0.65 }, { x: 0.9, y: 0.65 }],
  }),
  firetruck: vehicleDefinition({ version: 1, label: 'しょうぼうしゃ', icon: '🚒',
    chassis: { shape: { type: 'box', width: 3, height: 0.85 }, mass: 6, friction: 0.45, restitution: 0.05, color: 0xc52a2a, appearance: 'firetruck-body' },
    wheel: { shape: { type: 'circle', radius: 0.36 }, mass: 1, friction: 0.85, restitution: 0.08, color: 0x142132, appearance: 'car-wheel' },
    axles: [{ x: -1, y: 0.72 }, { x: 1, y: 0.72 }],
  }),
  triangle: { version: 1, label: 'さんかく', icon: '△', parts: [
    { id: 'block', role: 'block', position: { x: 0, y: 0 }, shape: { type: 'polygon', vertices: [{ x: -0.55, y: 0.95 / 3 }, { x: 0.55, y: 0.95 / 3 }, { x: 0, y: -0.95 * 2 / 3 }] }, mass: 0.7, friction: 0.65, restitution: 0.05, color: 0xd9ab69, appearance: 'wood-triangle' },
  ], joints: [] },
  rectangle: { version: 1, label: 'ながいつみき', icon: '▭', parts: [
    { id: 'block', role: 'block', position: { x: 0, y: 0 }, shape: { type: 'box', width: 1.8, height: 0.55 }, mass: 1.2, friction: 0.65, restitution: 0.05, color: 0xd9ab69, appearance: 'wood-block' },
  ], joints: [] },
  block: { version: 1, label: 'つみき', icon: '▣', parts: [
    { id: 'block', role: 'block', position: { x: 0, y: 0 }, shape: { type: 'box', width: 0.9, height: 0.9 }, mass: 1, friction: 0.65, restitution: 0.05, color: 0x8abce8, appearance: 'wood-block' },
  ], joints: [] },
  ball: ballDefinition('サッカーボール', '⚽', 'soccer-ball'),
  baseball: ballDefinition('やきゅうボール', '⚾', 'baseball'),
  ramp: { version: 1, label: 'さかみち', icon: '▱', parts: [
    { id: 'ramp', role: 'ramp', position: { x: 0, y: 0 }, shape: { type: 'box', width: 4, height: 0.22 }, mass: 0, friction: 0.65, restitution: 0.05, color: 0xc6afee, static: true, appearance: 'wood-ramp' },
  ], joints: [] },
});
export type Kind = keyof typeof CATALOG;
