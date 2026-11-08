import * as THREE from 'three';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  CELL_SIZE,
  gridCellToWorld,
  isSolidCell,
  LABYRINTH_MAP,
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
      const onSpoke = spokeDist < 0.72;

      // Anéis espirais pegajosos com leve curvatura entre os raios
      const sag = Math.abs(Math.sin(spokeAngle * Math.PI)) * 1.15;
      const ringPhase = (dist + sag) % 5.4;
      const onRing = dist > 3.5 && dist < 29.5 && ringPhase < 0.82;

      // Pequenos nós pegajosos no centro e cruzamentos
      const centerKnot = dist < 2.6;

      if (onSpoke || onRing || centerKnot) {
        const shade = centerKnot
          ? 226
          : onSpoke
            ? 212 - dist * 1.1
            : 188 - dist * 0.9;
        const v = Math.max(125, Math.min(240, Math.round(shade)));
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
 * Gerenciador de Armadilhas de Teia da Aranha:
 * - A aranha tece novas armadilhas nos corredores e arcos ao longo da partida.
 * - Quando o jogador pisa numa teia, fica preso/lento e a vibração alerta a aranha imediatamente!
 */
export class DoomSpiderWebManager {
  private readonly root = new THREE.Group();
  private readonly webMat: THREE.ShaderMaterial;
  private readonly traps: SpiderWebTrap[] = [];
  private nextTrapId = 1;
  private readonly maxActiveTraps = 7;

  private ensnaredRemaining = 0;
  private ensnaredPos = new THREE.Vector3();

  constructor(scene: THREE.Scene, sharedUniforms: DoomSharedUniforms) {
    this.root.name = 'DoomSpiderWebs';
    scene.add(this.root);

    const webTex = createSpiderWebTexture();
    this.webMat = createDoomPropMaterial(webTex, sharedUniforms, {
      baseLight: 0.44,
      alphaTest: 0.45,
      doubleSided: true,
      emissiveBoost: 0.04,
    });

    // Duas teias iniciais já tecidas em corredores intermediários/sul (longe do spawn inicial)
    const presetA = gridCellToWorld(8, 3);
    const presetB = gridCellToWorld(7, 10);
    this.spawnWebTrap(presetA.x, presetA.z, true);
    this.spawnWebTrap(presetB.x, presetB.z, true);
  }

  get isPlayerEnsnared(): boolean {
    return this.ensnaredRemaining > 0;
  }

  clearEnsnarement(): void {
    this.ensnaredRemaining = 0;
  }

  hasTrapNear(x: number, z: number, minRadius = 3.2): boolean {
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

    // Remove a teia mais antiga caso atinja o limite máximo
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

    // 1. Manto principal pegajoso estendido rente ao piso
    const floorWeb = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 2.35),
      this.webMat
    );
    floorWeb.rotation.x = -Math.PI * 0.5;
    floorWeb.rotation.z = (this.nextTrapId * 0.83) % Math.PI;
    floorWeb.position.y = 0.024;
    group.add(floorWeb);

    // 2. Cortinas diagonais finas ancoradas nas paredes laterais do corredor
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
   * Atualiza crescimento das teias recém-tecidas, verifica se o jogador caiu numa armadilha
   * e processa a luta para rasgar os fios.
   */
  update(
    dt: number,
    playerPos: THREE.Vector3,
    struggleInput: boolean,
    hasKnife: boolean,
    sound: SoundEngine,
    onWebTriggeredAlertSpider: (trapPos: THREE.Vector3) => void
  ): { speedMultiplier: number } {
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
        // Jogador caiu na armadilha de teia!
        trap.triggered = true;
        // Teia arrebenta parcialmente e envolve os pés do jogador
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

      // Puxa sutilmente de volta ao centro pegajoso da teia enquanto preso
      const pull = Math.min(1, dt * 3.5);
      playerPos.x += (this.ensnaredPos.x - playerPos.x) * pull * 0.28;
      playerPos.z += (this.ensnaredPos.z - playerPos.z) * pull * 0.28;

      return { speedMultiplier: 0.18 };
    }

    return { speedMultiplier: 1.0 };
  }
}
