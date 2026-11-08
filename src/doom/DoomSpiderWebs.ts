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
 * Textura fibrosa opaca 16x16 para cordões tensos de seda 3D e casulos pendurados no ninho.
 */
function createDenseSilkFiberTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const fiber = Math.sin(y * 1.3 + x * 0.6) * 18;
      const grit = ((x * 7 + y * 13) % 9) - 4;
      const v = Math.max(135, Math.min(238, Math.round(188 + fiber + grit * 2)));
      data[idx] = v;
      data[idx + 1] = Math.round(v * 1.01);
      data[idx + 2] = Math.round(v * 0.95);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function buildSilkStrandMesh(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  mat: THREE.Material
): THREE.Mesh {
  const delta = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.02, delta.length());
  const geo = new THREE.CylinderGeometry(radius, radius * 1.2, len, 5);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(a).addScaledVector(delta, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize()
  );
  return mesh;
}

/**
 * Gerenciador de Armadilhas de Teia + Ninho Principal da Aranha (`Lair`):
 * - Mantém o Ninho denso de teias na câmara de pedra sul (gx=7, gz=11), com cabos 3D de seda
 *   e casulos suspensos nas quinas altas.
 * - Permite que a aranha teça armadilhas de teia 3D pelos corredores e arcos.
 * - Suporta corte imediato por golpe de Canivete (`slashWebWithKnife`), inclusive via atalho [1–3]!
 */
export class DoomSpiderWebManager {
  private readonly root = new THREE.Group();
  private readonly webMat: THREE.ShaderMaterial;
  private readonly silkSolidMat: THREE.ShaderMaterial;
  private readonly traps: SpiderWebTrap[] = [];
  private nextTrapId = 1;
  private readonly maxActiveTraps = 7;

  readonly lairCenter: THREE.Vector3;
  readonly dragCorridorStart: THREE.Vector3;

  private ensnaredRemaining = 0;
  private ensnaredPos = new THREE.Vector3();
  private activeSnareTrapGroup: THREE.Group | null = null;

  // Quando o jogador acorda ferido no centro do Ninho de Teia, precisa caminhar ou cortar para sair
  private inWakingLairWeb = false;
  private lairCocoonRing: THREE.Object3D | null = null;

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

    const silkTex = createDenseSilkFiberTexture();
    this.silkSolidMat = createDoomPropMaterial(silkTex, sharedUniforms, {
      baseLight: 0.46,
      emissiveBoost: 0.05,
    });

    const lairW = gridCellToWorld(7, 11);
    this.lairCenter = new THREE.Vector3(lairW.x, 0, lairW.z);

    const dragStartW = gridCellToWorld(7, 9);
    this.dragCorridorStart = new THREE.Vector3(
      dragStartW.x,
      0,
      dragStartW.z + 0.4
    );

    this.buildMainSpiderLair();

    // Duas armadilhas iniciais em corredores intermediários (fora do corredor de arrasto do ninho)
    const presetA = gridCellToWorld(8, 3);
    const presetB = gridCellToWorld(3, 9);
    this.spawnWebTrap(presetA.x, presetA.z, true);
    this.spawnWebTrap(presetB.x, presetB.z, true);
  }

  /**
   * Constrói o Ninho Principal da Aranha em (gx=7, gz=11) com manto duplo no chão,
   * dossel no teto, cortinas diagonais, cabos tensos 3D e casulos suspensos nas quinas altas!
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

    // 3. Cortinas diagonais + cabos estruturais 3D ancorados nas 4 quinas de pedra
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

      // Cabos tensos 3D de seda ligando piso, coluna e dossel superior
      lairGroup.add(
        buildSilkStrandMesh(
          new THREE.Vector3(cx * 0.65, 0.03, cz * 0.65),
          new THREE.Vector3(cx * 1.12, WALL_HEIGHT - 0.12, cz * 1.12),
          0.014,
          this.silkSolidMat
        )
      );
      lairGroup.add(
        buildSilkStrandMesh(
          new THREE.Vector3(0, WALL_HEIGHT - 0.08, 0),
          new THREE.Vector3(cx * 1.15, 1.85, cz * 1.15),
          0.011,
          this.silkSolidMat
        )
      );
    }

    // 4. Casulos orgânicos 3D pendurados nas quinas superiores (sem bloquear passagem!)
    const hangingPods: Array<[number, number, number, number]> = [
      [-1.38, 2.24, -1.32, 0.34],
      [1.42, 2.34, -1.28, 0.29],
      [-1.34, 2.18, 1.36, 0.32],
    ];
    for (const [px, py, pz, scale] of hangingPods) {
      const podGroup = new THREE.Group();
      podGroup.position.set(px, py, pz);

      // Cordão de sustentação preso ao teto
      const stalkLen = WALL_HEIGHT - py;
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.022, stalkLen, 6),
        this.silkSolidMat
      );
      stalk.position.y = stalkLen * 0.5;
      podGroup.add(stalk);

      // Fuso envolto em seda (3 segmentos escalonados)
      const upper = new THREE.Mesh(
        new THREE.ConeGeometry(scale * 0.62, scale * 0.9, 7),
        this.silkSolidMat
      );
      upper.position.y = scale * 0.28;
      const middle = new THREE.Mesh(
        new THREE.DodecahedronGeometry(scale * 0.66, 0),
        this.silkSolidMat
      );
      middle.scale.set(0.92, 1.35, 0.92);
      middle.position.y = -scale * 0.12;
      const lower = new THREE.Mesh(
        new THREE.ConeGeometry(scale * 0.56, scale * 1.05, 7),
        this.silkSolidMat
      );
      lower.rotation.x = Math.PI;
      lower.position.y = -scale * 0.72;

      podGroup.add(upper, middle, lower);
      lairGroup.add(podGroup);
    }

    // 5. Casulo baixo de seda ao redor do centro (visível quando o jogador acorda preso na teia)
    const cocoonHolder = new THREE.Group();
    const cocoonOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.35, 0.95, 10, 1, true),
      this.webMat
    );
    cocoonOuter.position.y = 0.46;
    cocoonHolder.add(cocoonOuter);

    for (let s = 0; s < 6; s++) {
      const ang = (s / 6) * Math.PI * 2;
      cocoonHolder.add(
        buildSilkStrandMesh(
          new THREE.Vector3(Math.cos(ang) * 1.28, 0.04, Math.sin(ang) * 1.28),
          new THREE.Vector3(
            Math.cos(ang + 0.35) * 0.96,
            0.88,
            Math.sin(ang + 0.35) * 0.96
          ),
          0.011,
          this.silkSolidMat
        )
      );
    }
    cocoonHolder.visible = false;
    this.lairCocoonRing = cocoonHolder;
    lairGroup.add(cocoonHolder);

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
    this.activeSnareTrapGroup = null;
    if (this.lairCocoonRing) {
      this.lairCocoonRing.visible = false;
    }
  }

  /**
   * Prende o jogador recém-acordado no centro do Ninho de Teia da Aranha.
   * Ele pode caminhar para fora rasgando os fios livremente ou cortá-los imediatamente com a faca!
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
   * Golpe ativo com o Canivete Oxidado (ex.: via atalho rápido [1], [2] ou [3]):
   * - Se estiver preso numa armadilha de teia ou acordando no casulo do ninho:
   *   corta todos os fios IMEDIATAMENTE (liberação instantânea sem abrir Tab!).
   * - Se estiver diante de uma armadilha de teia armada no corredor (<2.15m):
   *   corta e destrói a armadilha preventivamente SEM alertar a aranha!
   */
  slashWebWithKnife(
    playerPos: THREE.Vector3,
    lookForward: THREE.Vector3,
    sound: SoundEngine
  ): { cutActiveSnare: boolean; cutNearbyTrap: boolean } {
    if (this.inWakingLairWeb) {
      this.inWakingLairWeb = false;
      if (this.lairCocoonRing) {
        this.lairCocoonRing.visible = false;
      }
      sound.playWebTrapSnap();
      return { cutActiveSnare: true, cutNearbyTrap: false };
    }

    if (this.ensnaredRemaining > 0) {
      this.ensnaredRemaining = 0;
      if (this.activeSnareTrapGroup) {
        this.activeSnareTrapGroup.scale.set(0.5, 0.12, 0.5);
        this.activeSnareTrapGroup = null;
      }
      sound.playWebTrapSnap();
      return { cutActiveSnare: true, cutNearbyTrap: false };
    }

    // Verifica se há uma armadilha de teia armada logo à frente para cortar preventivamente
    const flatFwd = new THREE.Vector3(lookForward.x, 0, lookForward.z);
    if (flatFwd.lengthSq() > 1e-4) flatFwd.normalize();

    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i];
      if (trap.triggered) continue;
      const dx = trap.position.x - playerPos.x;
      const dz = trap.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.15) continue;

      const toTrap =
        dist > 1e-4
          ? new THREE.Vector3(dx / dist, 0, dz / dist)
          : flatFwd.clone();

      if (dist < 1.25 || toTrap.dot(flatFwd) > 0.35) {
        trap.triggered = true;
        trap.group.scale.set(0.55, 0.15, 0.55);
        const grp = trap.group;
        setTimeout(() => {
          this.root.remove(grp);
        }, 700);
        sound.playWebTrapSnap();
        return { cutActiveSnare: false, cutNearbyTrap: true };
      }
    }

    return { cutActiveSnare: false, cutNearbyTrap: false };
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
   * Cria uma nova armadilha 3D de teia no piso + cortinas laterais + 4 cordões tensos 3D ancorados às paredes.
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

        // Cabos tensos 3D ancorando o centro da armadilha às paredes Leste/Oeste
        group.add(
          buildSilkStrandMesh(
            new THREE.Vector3(0, 0.03, -0.35),
            new THREE.Vector3(sign * (CELL_SIZE * 0.48), 1.28, -0.42),
            0.009,
            this.silkSolidMat
          )
        );
        group.add(
          buildSilkStrandMesh(
            new THREE.Vector3(0, 0.03, 0.35),
            new THREE.Vector3(sign * (CELL_SIZE * 0.48), 0.96, 0.42),
            0.009,
            this.silkSolidMat
          )
        );
      } else {
        cornerWeb.position.set(0, 0.62, sign * (CELL_SIZE * 0.34));
        cornerWeb.rotation.x = -sign * 0.58;
        cornerWeb.rotation.y = Math.PI * 0.5 + sign * 0.25;

        group.add(
          buildSilkStrandMesh(
            new THREE.Vector3(-0.35, 0.03, 0),
            new THREE.Vector3(-0.42, 1.28, sign * (CELL_SIZE * 0.48)),
            0.009,
            this.silkSolidMat
          )
        );
        group.add(
          buildSilkStrandMesh(
            new THREE.Vector3(0.35, 0.03, 0),
            new THREE.Vector3(0.42, 0.96, sign * (CELL_SIZE * 0.48)),
            0.009,
            this.silkSolidMat
          )
        );
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
        this.lairCocoonRing.scale.set(
          stretch,
          Math.max(0.35, 1 - distFromNest * 0.35),
          stretch
        );
      }

      if (distFromNest >= 1.68) {
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
        this.activeSnareTrapGroup = trap.group;
        const grp = trap.group;
        setTimeout(() => {
          this.root.remove(grp);
        }, 1800);

        // Prende o jogador nos fios — basta apertar o atalho da faca (ex.: [1]) para cortar na hora!
        this.ensnaredRemaining = 2.85;
        this.ensnaredPos.copy(trap.position);

        sound.playWebTrapSnap();
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
