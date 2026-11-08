import * as THREE from 'three';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  CELL_SIZE,
  gridCellToWorld,
  isSolidCell,
  LABYRINTH_MAP,
  WALL_HEIGHT,
  worldToGridCell,
} from './DoomMazeBuilder';
import { createDoomPropMaterial, DoomSharedUniforms } from './DoomShader';

export interface SpiderWebTrap {
  id: number;
  position: THREE.Vector3;
  group: THREE.Group;
  triggered: boolean;
  weaveProgress: number;
}

/**
 * Gera textura pixel-art 64x64 de teia de aranha com raios radiais e espirais pegajosas
 * (canal alpha nítido para recorte sem artefatos no compositor retrô 250p).
 */
function createSpiderWebTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const cx = 31.5;
  const cy = 31.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);

      if (dist > 31.2) {
        data[idx + 3] = 0;
        continue;
      }

      // 11 fios radiais levemente orgânicos
      const spokeAngle = ((ang + Math.PI) / (Math.PI * 2)) * 11;
      const spokeDist =
        Math.abs(spokeAngle - Math.round(spokeAngle)) *
        ((Math.PI * 2 * dist) / 11);
      const onSpoke = spokeDist < 0.75;

      // Anéis espirais pegajosos com leve curvatura entre os raios
      const sag = Math.abs(Math.sin(spokeAngle * Math.PI)) * 1.15;
      const ringPhase = (dist + sag) % 5.2;
      const onRing = dist > 3.2 && dist < 29.8 && ringPhase < 0.86;

      const centerKnot = dist < 2.8;

      if (onSpoke || onRing || centerKnot) {
        const shade = centerKnot
          ? 232
          : onSpoke
            ? 216 - dist * 1.05
            : 192 - dist * 0.85;
        const v = Math.max(128, Math.min(244, Math.round(shade)));
        data[idx] = v;
        data[idx + 1] = Math.round(v * 1.01);
        data[idx + 2] = Math.round(v * 0.97);
        data[idx + 3] = 255;
      } else {
        data[idx + 3] = 0;
      }
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Gerenciador de Armadilhas de Teia + Ninho Principal da Aranha (`Lair`):
 * - Mantém o Ninho denso de teias na câmara de pedra sul (gx=7, gz=11), para onde a aranha
 *   arrasta o jogador desacordado após o primeiro ataque.
 * - Permite que a aranha teça armadilhas de teia extras pelos corredores e arcos.
 */
export class DoomSpiderWebManager {
  private readonly root = new THREE.Group();
  private readonly webMat: THREE.ShaderMaterial;
  private readonly traps: SpiderWebTrap[] = [];
  private nextTrapId = 1;
  private readonly maxActiveTraps = 7;

  readonly lairCenter: THREE.Vector3;
  readonly dragCorridorStart: THREE.Vector3;

  private ensnaredRemaining = 0;
  private ensnaredPos = new THREE.Vector3();

  // Quando o jogador acorda ferido no centro do Ninho de Teia, precisa caminhar até rasgar e sair
  private inWakingLairWeb = false;
  private lairCocoonRing: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene, sharedUniforms: DoomSharedUniforms) {
    this.root.name = 'DoomSpiderWebs';
    scene.add(this.root);

    const webTex = createSpiderWebTexture();
    this.webMat = createDoomPropMaterial(webTex, sharedUniforms, {
      baseLight: 0.48,
      alphaTest: 0.45,
      doubleSided: true,
      emissiveBoost: 0.06,
    });

    const lairW = gridCellToWorld(7, 11);
    this.lairCenter = new THREE.Vector3(lairW.x, 0, lairW.z);

    const dragStartW = gridCellToWorld(7, 9);
    this.dragCorridorStart = new THREE.Vector3(dragStartW.x, 0, dragStartW.z + 0.4);

    this.buildMainSpiderLair();

    // Duas armadilhas iniciais em corredores intermediários (fora do corredor de arrasto do ninho)
    const presetA = gridCellToWorld(8, 3);
    const presetB = gridCellToWorld(3, 9);
    this.spawnWebTrap(presetA.x, presetA.z, true);
    this.spawnWebTrap(presetB.x, presetB.z, true);
  }

  /**
   * Constrói o Ninho Principal da Aranha em (gx=7, gz=11) com manto duplo no chão,
   * dossel no teto e cortinas diagonais presas às quinas de pedra!
   */
  private buildMainSpiderLair(): void {
    const lairGroup = new THREE.Group();
    lairGroup.name = 'SpiderMainLair';
    lairGroup.position.copy(this.lairCenter);

    // 1. Manto denso de teia no piso central onde a vítima acorda
    for (let k = 0; k < 2; k++) {
      const bed = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6 - k * 0.5, 3.6 - k * 0.5),
        this.webMat
      );
      bed.rotation.x = -Math.PI * 0.5;
      bed.rotation.z = k * 0.65;
      bed.position.y = 0.024 + k * 0.015;
      lairGroup.add(bed);
    }

    // 2. Dossel de teia suspenso no teto acima do ninho
    const canopy = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 3.5),
      this.webMat
    );
    canopy.rotation.x = Math.PI * 0.5;
    canopy.rotation.z = 0.4;
    canopy.position.y = WALL_HEIGHT - 0.06;
    lairGroup.add(canopy);

    // 3. Cortinas diagonais ancoradas nas 4 colunas/quinas de pedra ao redor de (7,11)
    const cornerOffsets: Array<[number, number, number]> = [
      [-1.55, -1.45, 0.72],
      [1.55, -1.45, -0.72],
      [-1.55, 1.45, -0.72],
      [1.55, 1.45, 0.72],
    ];
    for (const [cx, cz, rotY] of cornerOffsets) {
      const drape = new THREE.Mesh(
        new THREE.PlaneGeometry(2.35, 2.75),
        this.webMat
      );
      drape.position.set(cx, 1.42, cz);
      drape.rotation.y = rotY;
      drape.rotation.x = cz < 0 ? 0.24 : -0.24;
      lairGroup.add(drape);
    }

    // 4. Casulo baixo de seda ao redor do centro (visível quando o jogador acorda preso na teia)
    const cocoon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.35, 0.95, 8, 1, true),
      this.webMat
    );
    cocoon.position.y = 0.46;
    cocoon.visible = false;
    this.lairCocoonRing = cocoon;
    lairGroup.add(cocoon);

    this.root.add(lairGroup);
  }

  get isPlayerEnsnared(): boolean {
    return this.ensnaredRemaining > 0 || this.inWakingLairWeb;
  }

  get isInsideWakingLairWeb(): boolean {
    return this.inWakingLairWeb;
  }

  clearEnsnarement(): void {
    this.ensnaredRemaining = 0;
    this.inWakingLairWeb = false;
    if (this.lairCocoonRing) {
      this.lairCocoonRing.visible = false;
    }
  }

  /**
   * Prende o jogador recém-acordado no centro do Ninho de Teia da Aranha.
   * Ele pode caminhar para fora rasgando os fios livremente sem alertar a aranha!
   */
  placePlayerInWakingLairWeb(): void {
    this.ensnaredRemaining = 0;
    this.inWakingLairWeb = true;
    if (this.lairCocoonRing) {
      this.lairCocoonRing.visible = true;
      this.lairCocoonRing.scale.set(1, 1, 1);
    }
  }

  /**
   * Retorna intensidade de fios de seda na tela [0..1] enquanto o jogador sai do ninho.
   */
  getWakingLairSilkFactor(playerPos: THREE.Vector3): number {
    if (!this.inWakingLairWeb) return 0;
    const d = Math.hypot(
      playerPos.x - this.lairCenter.x,
      playerPos.z - this.lairCenter.z
    );
    return Math.max(0, Math.min(1, 1 - d / 1.75)) * 0.85;
  }

  hasTrapNear(x: number, z: number, minRadius = 3.2): boolean {
    if (Math.hypot(this.lairCenter.x - x, this.lairCenter.z - z) < 4.2) {
      return true;
    }
    for (const t of this.traps) {
      if (t.triggered) continue;
      if (Math.hypot(t.position.x - x, t.position.z - z) < minRadius) {
        return true;
      }
    }
    return false;
  }

  /**
   * Cria uma nova armadilha 3D de teia no piso + fios diagonais ancorados nas paredes vizinhas.
   */
  spawnWebTrap(wx: number, wz: number, instant = false): SpiderWebTrap | null {
    if (this.hasTrapNear(wx, wz, 2.8)) return null;

    const activeCount = this.traps.filter((t) => !t.triggered).length;
    if (activeCount >= this.maxActiveTraps) {
      const oldestIdx = this.traps.findIndex((t) => !t.triggered);
      if (oldestIdx >= 0) {
        const old = this.traps[oldestIdx];
        this.root.remove(old.group);
        this.traps.splice(oldestIdx, 1);
      }
    }

    const group = new THREE.Group();
    group.position.set(wx, 0, wz);

    const floorWeb = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 2.35),
      this.webMat
    );
    floorWeb.rotation.x = -Math.PI * 0.5;
    floorWeb.rotation.z = (this.nextTrapId * 0.83) % Math.PI;
    floorWeb.position.y = 0.024;
    group.add(floorWeb);

    const { gx, gz } = worldToGridCell(wx, wz);
    const northSouthWalls =
      isSolidCell(LABYRINTH_MAP, gx, gz - 1) &&
      isSolidCell(LABYRINTH_MAP, gx, gz + 1);
    const eastWestWalls =
      isSolidCell(LABYRINTH_MAP, gx - 1, gz) &&
      isSolidCell(LABYRINTH_MAP, gx + 1, gz);

    for (const sign of [-1, 1]) {
      const cornerWeb = new THREE.Mesh(
        new THREE.PlaneGeometry(1.55, 1.55),
        this.webMat
      );
      if (eastWestWalls && !northSouthWalls) {
        cornerWeb.position.set(sign * (CELL_SIZE * 0.34), 0.62, 0);
        cornerWeb.rotation.z = sign * 0.58;
        cornerWeb.rotation.y = sign * 0.25;
      } else {
        cornerWeb.position.set(0, 0.62, sign * (CELL_SIZE * 0.34));
        cornerWeb.rotation.x = -sign * 0.58;
        cornerWeb.rotation.y = Math.PI * 0.5 + sign * 0.25;
      }
      group.add(cornerWeb);
    }

    const initScale = instant ? 1 : 0.08;
    group.scale.setScalar(initScale);
    this.root.add(group);

    const trap: SpiderWebTrap = {
      id: this.nextTrapId++,
      position: new THREE.Vector3(wx, 0.05, wz),
      group,
      triggered: false,
      weaveProgress: instant ? 1 : 0.08,
    };
    this.traps.push(trap);
    return trap;
  }

  /**
   * Atualiza teias nos corredores + saída viscosa do Ninho Principal após acordar!
   */
  update(
    dt: number,
    playerPos: THREE.Vector3,
    struggleInput: boolean,
    hasKnife: boolean,
    sound: SoundEngine,
    onWebTriggeredAlertSpider: (trapPos: THREE.Vector3) => void
  ): { speedMultiplier: number } {
    // 1. Caso o jogador tenha acabado de acordar no centro do Ninho de Teia da Aranha:
    if (this.inWakingLairWeb) {
      const distFromNest = Math.hypot(
        playerPos.x - this.lairCenter.x,
        playerPos.z - this.lairCenter.z
      );

      if (this.lairCocoonRing) {
        const stretch = 1 + (distFromNest / 1.7) * 0.28;
        this.lairCocoonRing.scale.set(stretch, Math.max(0.35, 1 - distFromNest * 0.35), stretch);
      }

      if (distFromNest >= 1.68) {
        // Rompe os fios do casulo e sai livremente!
        this.inWakingLairWeb = false;
        if (this.lairCocoonRing) {
          this.lairCocoonRing.visible = false;
        }
        sound.playWebTrapSnap();
        return { speedMultiplier: 1.0 };
      }

      return { speedMultiplier: hasKnife ? 0.52 : 0.35 };
    }

    // 2. Armadilhas normais de teia espalhadas pelos corredores
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i];
      if (trap.triggered) continue;

      if (trap.weaveProgress < 1) {
        trap.weaveProgress = Math.min(1, trap.weaveProgress + dt * 0.65);
        trap.group.scale.setScalar(trap.weaveProgress);
      }

      if (trap.weaveProgress < 0.75) continue;

      const dist = Math.hypot(
        playerPos.x - trap.position.x,
        playerPos.z - trap.position.z
      );
      if (dist < 1.05) {
        trap.triggered = true;
        trap.group.scale.set(0.75, 0.35, 0.75);
        setTimeout(() => {
          this.root.remove(trap.group);
        }, 1800);

        this.ensnaredRemaining = hasKnife ? 1.15 : 2.85;
        this.ensnaredPos.copy(trap.position);

        sound.playWebTrapSnap();
        if (hasKnife) {
          sound.playItemUse('blade');
        }
        onWebTriggeredAlertSpider(trap.position.clone());
      }
    }

    if (this.ensnaredRemaining > 0) {
      let decay = dt;
      if (struggleInput) {
        decay += dt * (hasKnife ? 1.65 : 0.75);
      }
      this.ensnaredRemaining = Math.max(0, this.ensnaredRemaining - decay);

      const pull = Math.min(1, dt * 3.5);
      playerPos.x += (this.ensnaredPos.x - playerPos.x) * pull * 0.28;
      playerPos.z += (this.ensnaredPos.z - playerPos.z) * pull * 0.28;

      return { speedMultiplier: 0.18 };
    }

    return { speedMultiplier: 1.0 };
  }
}
