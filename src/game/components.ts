import * as THREE from 'three';
import { defineComponent } from '../engine/ecs/World';
import { FrameLocalTransform } from '../engine/math/SubFrustum';

export interface TransformData {
  prevPosition: THREE.Vector3;
  position: THREE.Vector3;
  prevQuaternion: THREE.Quaternion;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export interface KinematicsData {
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  gravity: number;
  drag: number;
  restitution: number;
  radius: number;
  groundFriction: number;
}

export interface RenderableData {
  object3d: THREE.Object3D;
  disposeGeometry?: boolean;
  disposeMaterial?: boolean;
}

export type ProjectileFaction = 'player' | 'enemy' | 'reprojected';

export interface ProjectileData {
  faction: ProjectileFaction;
  ttl: number;
  bouncesLeft: number;
  trailHistory: THREE.Vector3[];
  trailMesh: THREE.Line;
}

export type CapturableKind = 'projectile' | 'sentinel' | 'cube' | 'core';

export interface FrameCapturableData {
  kind: CapturableKind;
  label: string;
  boundingRadius: number;
}

/**
 * Componente-chave de estase espacial:
 * Quando presente na máscara da entidade, todos os sistemas do mundo (física, IA, colisão)
 * a ignoram automaticamente por filtragem de bits (`withoutMask = PocketStasis.bit`),
 * sem espalhar `if (!captured)` pelo motor.
 */
export interface PocketStasisData {
  localTransform: FrameLocalTransform;
}

export interface CrystalTargetData {
  stationId: string;
  shardCount: number;
  color: number;
  isExplosiveCore?: boolean;
  respawnAnchor?: THREE.Vector3;
}

export interface TurretEmitterData {
  cooldown: number;
  interval: number;
  fireDirection: THREE.Vector3;
  trackPlayer: boolean;
  projectileSpeed: number;
  muzzleOffset: THREE.Vector3;
  enabled: boolean;
}

export interface EphemeralShardData {
  age: number;
  maxAge: number;
  initialScale: number;
}

export const Transform = defineComponent<TransformData>('Transform');
export const Kinematics = defineComponent<KinematicsData>('Kinematics');
export const Renderable = defineComponent<RenderableData>('Renderable');
export const Projectile = defineComponent<ProjectileData>('Projectile');
export const FrameCapturable = defineComponent<FrameCapturableData>('FrameCapturable');
export const PocketStasis = defineComponent<PocketStasisData>('PocketStasis');
export const CrystalTarget = defineComponent<CrystalTargetData>('CrystalTarget');
export const TurretEmitter = defineComponent<TurretEmitterData>('TurretEmitter');
export const EphemeralShard = defineComponent<EphemeralShardData>('EphemeralShard');
