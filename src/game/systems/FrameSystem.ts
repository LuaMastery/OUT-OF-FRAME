import * as THREE from 'three';
import { ProceduralAudio } from '../../engine/audio/ProceduralAudio';
import { EntityId } from '../../engine/ecs/types';
import { World } from '../../engine/ecs/World';
import {
  captureTransformToFrame,
  computeSubFrustumCornersWorld,
  DEFAULT_FRAME_RECT,
  extractWorldSubFrustum,
  FramePolarity,
  reprojectTransformFromFrame,
} from '../../engine/math/SubFrustum';
import {
  hasLineOfSight,
  StaticColliderBox,
  sweepStaticWorld,
} from '../../engine/physics/SpatialSweep';
import { FramePipView } from '../../engine/render/FramePipView';
import { ChronoKernel } from '../../engine/time/ChronoKernel';
import {
  FrameCapturable,
  Kinematics,
  PocketStasis,
  Projectile,
  Renderable,
  Transform,
} from '../components';
import { getProjectileMaterial, getTrailColor } from '../EntityPrefabs';

interface VoidGhost {
  mesh: THREE.Object3D;
  ttl: number;
  maxTtl: number;
}

export interface FrameHudState {
  framedLiveCount: number;
  framedLabels: string[];
  pocketCount: number;
  pocketSummary: string;
  polarity: FramePolarity;
  gizmoPinned: boolean;
  statusBanner: string;
}

/**
 * Sistema Central OUT-OF-FRAME:
 * Recorte por Sub-Frustum Perspectivo, Estase por Bitmask ECS, Inversão de Negativo [R]
 * e Reprojeção Espacial SE(3).
 */
export class FrameSystem {
  readonly nearPlane = 0.55;
  readonly farPlane = 25.0;

  polarity: FramePolarity = 'normal';
  gizmoPinned = false;
  totalCaptures = 0;
  totalPastes = 0;

  private framedCandidates: EntityId[] = [];
  private voidGhosts: VoidGhost[] = [];
  private gizmoLine: THREE.LineSegments | null = null;
  private gizmoFadeTimer = 0;
  private bannerText = 'MOLDURA PRONTA';
  private bannerTimer = 0;

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly pipView: FramePipView,
    private readonly audio: ProceduralAudio,
    private readonly chrono: ChronoKernel
  ) {}

  /**
   * Varre em tempo real quais entidades capturáveis estão visíveis dentro do retângulo da moldura.
   */
  updateRealtime(
    realDt: number,
    colliders: readonly StaticColliderBox[]
  ): FrameHudState {
    const frustum = extractWorldSubFrustum(
      this.camera,
      this.nearPlane,
      this.farPlane,
      DEFAULT_FRAME_RECT
    );

    const eye = this.camera.position;
    const candidates = this.world.query(
      Transform.bit | FrameCapturable.bit,
      PocketStasis.bit
    );

    this.framedCandidates = [];
    const labels: string[] = [];

    for (const e of candidates) {
      const tr = this.world.getRequired(e, Transform);
      const cap = this.world.getRequired(e, FrameCapturable);

      const center =
        cap.kind === 'sentinel'
          ? tr.position.clone().add(new THREE.Vector3(0, 1.15, 0))
          : tr.position.clone();

      const sphere = new THREE.Sphere(center, cap.boundingRadius);
      if (!frustum.intersectsSphere(sphere)) continue;

      // Testa linha de visão para o centro ou topo (permite capturar sentinelas atrás de cover baixo)
      const topPoint =
        cap.kind === 'sentinel'
          ? tr.position.clone().add(new THREE.Vector3(0, 1.88, 0))
          : center;

      if (
        hasLineOfSight(eye, center, colliders) ||
        hasLineOfSight(eye, topPoint, colliders)
      ) {
        this.framedCandidates.push(e);
        labels.push(cap.label);
      }
    }

    // Atualiza fantasmas de recorte ("silhuetas vazias") em tempo real
    for (let i = this.voidGhosts.length - 1; i >= 0; i--) {
      const g = this.voidGhosts[i];
      g.ttl -= realDt;
      if (g.ttl <= 0) {
        this.scene.remove(g.mesh);
        this.voidGhosts.splice(i, 1);
      } else {
        const ratio = g.ttl / g.maxTtl;
        g.mesh.traverse((child) => {
          if (child instanceof THREE.LineSegments || child instanceof THREE.Mesh) {
            const mat = child.material as THREE.Material & { opacity?: number };
            if (typeof mat.opacity === 'number') {
              mat.opacity = ratio * 0.65;
            }
          }
        });
      }
    }

    // Desvanece gizmo 3D do Frustum caso não esteja fixado com [V]
    if (this.gizmoLine && !this.gizmoPinned) {
      this.gizmoFadeTimer -= realDt;
      const mat = this.gizmoLine.material as THREE.LineBasicMaterial;
      if (this.gizmoFadeTimer <= 0) {
        this.scene.remove(this.gizmoLine);
        this.gizmoLine.geometry.dispose();
        mat.dispose();
        this.gizmoLine = null;
      } else {
        mat.opacity = Math.min(0.85, this.gizmoFadeTimer * 0.6);
      }
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - realDt);
    }

    const pocketEntities = this.world.query(PocketStasis.bit);
    const pocketSummary = this.summarizePocket(pocketEntities);

    return {
      framedLiveCount: this.framedCandidates.length,
      framedLabels: labels,
      pocketCount: pocketEntities.length,
      pocketSummary,
      polarity: this.polarity,
      gizmoPinned: this.gizmoPinned,
      statusBanner:
        this.bannerTimer > 0
          ? this.bannerText
          : pocketEntities.length > 0
          ? `EM ESTASE (${pocketEntities.length}) — [RMB/E] REPROJETAR`
          : this.framedCandidates.length > 0
          ? `${this.framedCandidates.length} EM QUADRO — [RMB/E] RECORTAR`
          : 'ENQUADRE PROJÉTEIS OU ALVOS',
    };
  }

  /**
   * Alterna entre RECORTAR (quando a moldura está vazia) e REPROJETAR (quando contém objetos).
   */
  triggerFrameAction(colliders: readonly StaticColliderBox[]): void {
    const pocketed = this.world.query(PocketStasis.bit);
    if (pocketed.length > 0) {
      this.pasteFromFrame(pocketed, colliders);
    } else {
      this.cutIntoFrame();
    }
  }

  /**
   * Inverte a polaridade óptica/vetorial da moldura ("Negativo Invertido" [R]).
   */
  togglePolarity(): FramePolarity {
    this.polarity = this.polarity === 'normal' ? 'inverted' : 'normal';
    this.pipView.redrawPlate(this.polarity);
    this.audio.playPolarityFlip(this.polarity);
    this.showBanner(
      this.polarity === 'inverted'
        ? 'NEGATIVO INVERTIDO [R]: VETORES REVERTIDOS'
        : 'POLARIDADE NORMAL [R]: VETORES ORIGINAIS',
      1.6
    );
    return this.polarity;
  }

  toggleGizmoPin(): boolean {
    this.gizmoPinned = !this.gizmoPinned;
    if (this.gizmoPinned && !this.gizmoLine) {
      this.spawnFrustumGizmo(0x00d2ff);
    } else if (!this.gizmoPinned && this.gizmoLine) {
      this.gizmoFadeTimer = 0.25;
    }
    this.showBanner(
      this.gizmoPinned
        ? 'PIRÂMIDE 3D DO FRUSTUM FIXADA [V]'
        : 'PIRÂMIDE 3D DO FRUSTUM AUTOMÁTICA [V]',
      1.4
    );
    return this.gizmoPinned;
  }

  clearAllFrameState(): void {
    const pocketed = this.world.query(PocketStasis.bit);
    for (const e of pocketed) {
      this.world.destroyEntity(e);
    }
    for (const g of this.voidGhosts) {
      this.scene.remove(g.mesh);
    }
    this.voidGhosts = [];
    this.pipView.clearCanvas();
    if (this.gizmoLine) {
      this.scene.remove(this.gizmoLine);
      this.gizmoLine.geometry.dispose();
      (this.gizmoLine.material as THREE.Material).dispose();
      this.gizmoLine = null;
    }
  }

  private cutIntoFrame(): void {
    if (this.framedCandidates.length === 0) {
      this.showBanner('NENHUM OBJETO VISÍVEL NA MOLDURA', 1.1);
      return;
    }

    this.camera.updateMatrixWorld(true);
    const camPos = this.camera.position.clone();
    const camQuat = this.camera.quaternion.clone();

    // 1. Captura a textura fotográfica real do sub-frustum antes de ocultar as malhas
    this.pipView.captureSnapshot(
      this.renderer,
      this.scene,
      this.camera,
      this.nearPlane,
      this.farPlane,
      DEFAULT_FRAME_RECT,
      this.polarity
    );

    // 2. Registra transformações locais SE(3) e move entidades para estase por bitmask
    let count = 0;
    for (const e of this.framedCandidates) {
      if (!this.world.isAlive(e)) continue;
      const tr = this.world.getRequired(e, Transform);
      const kin = this.world.get(e, Kinematics);
      const rend = this.world.get(e, Renderable);
      const proj = this.world.get(e, Projectile);
      const cap = this.world.getRequired(e, FrameCapturable);

      const localTransform = captureTransformToFrame(
        camPos,
        camQuat,
        tr.position,
        tr.quaternion,
        kin ? kin.velocity : new THREE.Vector3(),
        kin ? kin.angularVelocity : new THREE.Vector3()
      );

      this.world.add(e, PocketStasis, { localTransform });

      if (rend) rend.object3d.visible = false;
      if (proj) proj.trailMesh.visible = false;

      this.spawnVoidGhost(tr.position, cap.boundingRadius);
      count++;
    }

    this.totalCaptures++;
    this.spawnFrustumGizmo(0xff1e2d);
    this.audio.playFrameCut(count);
    this.chrono.injectActionPulse(0.68);
    this.showBanner(
      `RECORTADO: ${count} OBJETO${count > 1 ? 'S' : ''} FORA DE QUADRO`,
      1.5
    );
  }

  private pasteFromFrame(
    pocketed: EntityId[],
    colliders: readonly StaticColliderBox[]
  ): void {
    this.camera.updateMatrixWorld(true);
    const camPos = this.camera.position.clone();
    const camQuat = this.camera.quaternion.clone();

    for (const e of pocketed) {
      if (!this.world.isAlive(e)) continue;
      const stasis = this.world.getRequired(e, PocketStasis);
      const tr = this.world.getRequired(e, Transform);
      const kin = this.world.get(e, Kinematics);
      const rend = this.world.get(e, Renderable);
      const proj = this.world.get(e, Projectile);
      const cap = this.world.get(e, FrameCapturable);

      const reprojected = reprojectTransformFromFrame(
        camPos,
        camQuat,
        stasis.localTransform,
        this.polarity
      );

      // Clamping de segurança por raio varrido: impede colar objetos atrás de paredes sólidas!
      const safeRadius = cap?.kind === 'projectile' ? 0.16 : 0.45;
      const wallCheck = sweepStaticWorld(
        camPos,
        reprojected.worldPosition,
        colliders,
        safeRadius
      );
      if (wallCheck && wallCheck.t < 1.0) {
        reprojected.worldPosition
          .copy(wallCheck.point)
          .addScaledVector(wallCheck.normal, safeRadius + 0.05);
      }

      const minY = cap?.kind === 'sentinel' ? 0.02 : Math.max(0.2, safeRadius);
      if (reprojected.worldPosition.y < minY) {
        reprojected.worldPosition.y = minY;
      }

      tr.position.copy(reprojected.worldPosition);
      tr.prevPosition.copy(reprojected.worldPosition);
      tr.quaternion.copy(reprojected.worldQuaternion);
      tr.prevQuaternion.copy(reprojected.worldQuaternion);

      if (kin) {
        kin.velocity.copy(reprojected.worldVelocity);
        kin.angularVelocity.copy(reprojected.worldAngularVelocity);
      }

      // Projéteis reprojetados ganham assinatura ciano elétrica e orientam-se ao novo vetor
      if (proj && kin) {
        proj.faction = 'reprojected';
        proj.ttl = Math.max(proj.ttl, 6.5);
        if (kin.velocity.lengthSq() > 1e-4) {
          const dir = kin.velocity.clone().normalize();
          const m = new THREE.Matrix4().lookAt(
            new THREE.Vector3(),
            dir,
            new THREE.Vector3(0, 1, 0)
          );
          tr.quaternion.setFromRotationMatrix(m);
          tr.prevQuaternion.copy(tr.quaternion);
        }
        if (rend && rend.object3d instanceof THREE.Mesh) {
          rend.object3d.material = getProjectileMaterial('reprojected');
        }
        proj.trailHistory = [
          reprojected.worldPosition.clone(),
          reprojected.worldPosition.clone(),
        ];
        (proj.trailMesh.material as THREE.LineBasicMaterial).color.setHex(
          getTrailColor('reprojected')
        );
        proj.trailMesh.visible = true;
      }

      if (rend) {
        rend.object3d.visible = true;
        rend.object3d.position.copy(tr.position);
        rend.object3d.quaternion.copy(tr.quaternion);
      }

      this.world.remove(e, PocketStasis);
    }

    this.totalPastes++;
    this.pipView.clearCanvas();
    this.spawnFrustumGizmo(0x00d2ff);
    this.audio.playFramePaste(this.polarity);
    this.chrono.injectActionPulse(0.88);
    this.showBanner(
      this.polarity === 'inverted'
        ? 'REPROJEÇÃO NEGATIVA CONCLUÍDA'
        : 'REPROJEÇÃO ESPACIAL CONCLUÍDA',
      1.4
    );
  }

  private spawnVoidGhost(position: THREE.Vector3, radius: number): void {
    const geo = new THREE.OctahedronGeometry(Math.max(0.22, radius * 0.65), 0);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00d2ff,
      transparent: true,
      opacity: 0.65,
    });
    const wire = new THREE.LineSegments(edges, mat);
    wire.position.copy(position);
    this.scene.add(wire);
    geo.dispose();

    this.voidGhosts.push({
      mesh: wire,
      ttl: 1.5,
      maxTtl: 1.5,
    });
  }

  /**
   * Desenha no espaço 3D do mundo os 12 segmentos exatos da pirâmide truncada do Sub-Frustum!
   */
  private spawnFrustumGizmo(colorHex: number): void {
    if (this.gizmoLine) {
      this.scene.remove(this.gizmoLine);
      this.gizmoLine.geometry.dispose();
      (this.gizmoLine.material as THREE.Material).dispose();
      this.gizmoLine = null;
    }

    const c = computeSubFrustumCornersWorld(
      this.camera,
      this.nearPlane,
      this.farPlane,
      DEFAULT_FRAME_RECT
    );
    // Índices 0..3 = plano near, 4..7 = plano far
    const indices = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const pts: THREE.Vector3[] = [];
    for (const [a, b] of indices) {
      pts.push(c[a], c[b]);
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.78,
    });
    this.gizmoLine = new THREE.LineSegments(geo, mat);
    this.gizmoFadeTimer = 1.65;
    this.scene.add(this.gizmoLine);
  }

  private summarizePocket(entities: EntityId[]): string {
    if (entities.length === 0) return 'Vazio';
    let bullets = 0;
    let sentinels = 0;
    let props = 0;
    for (const e of entities) {
      const cap = this.world.get(e, FrameCapturable);
      if (!cap) continue;
      if (cap.kind === 'projectile') bullets++;
      else if (cap.kind === 'sentinel') sentinels++;
      else props++;
    }
    const parts: string[] = [];
    if (bullets > 0) parts.push(`${bullets} proj.`);
    if (sentinels > 0) parts.push(`${sentinels} sent.`);
    if (props > 0) parts.push(`${props} obj.`);
    return parts.join(' + ');
  }

  private showBanner(text: string, seconds: number): void {
    this.bannerText = text;
    this.bannerTimer = seconds;
  }
}
