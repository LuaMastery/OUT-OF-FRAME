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

function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function distToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { dist: number; t: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return { dist: Math.hypot(px - x0, py - y0), t: 0 };
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  return {
    dist: Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t)),
    t,
  };
}

/**
 * Gera textura pixel-art 128x128 de teia orbital ORGÂNICA e ASSIMÉTRICA:
 * - Raios irregulares com bifurcações em "Y" nas pontas (sem corte circular artificial).
 * - Espirais catenárias que cedem entre cada par de raios, falhas rasgadas, nós fibrosos e gotículas viscosas.
 */
function createOrbTrapWebTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const cx = 63.5;
  const cy = 65.0; // Centro levemente deslocado para assimetria natural

  // 15 raios com ângulos levemente irregulares
  const numSpokes = 15;
  const spokeAngles: number[] = [];
  for (let i = 0; i < numSpokes; i++) {
    const jitter = (hash2D(i * 3.1, 9.7) - 0.5) * 0.19;
    spokeAngles.push(-Math.PI + ((i + 0.5) / numSpokes) * Math.PI * 2 + jitter);
  }
  spokeAngles.sort((a, b) => a - b);

  // Pré-calcula segmentos de ancoragem em "Y" nas extremidades dos raios
  const forkSegs: Array<[number, number, number, number]> = [];
  const spokeMaxR: number[] = [];
  for (let i = 0; i < numSpokes; i++) {
    const a = spokeAngles[i];
    // Alcance maior nas diagonais para ancorar naturalmente nos cantos do plano
    const diagBoost =
      1 + 0.24 * Math.pow(Math.sin(2 * a), 2);
    const maxR = Math.min(62, (48 + hash2D(i, 2.3) * 11) * diagBoost);
    spokeMaxR.push(maxR);

    const forkR = maxR * 0.74;
    const fx = cx + Math.cos(a) * forkR;
    const fy = cy + Math.sin(a) * forkR;
    for (const side of [-1, 1]) {
      const fa = a + side * (0.14 + hash2D(i, side + 5) * 0.07);
      forkSegs.push([
        fx,
        fy,
        cx + Math.cos(fa) * (maxR + 3),
        cy + Math.sin(fa) * (maxR + 3),
      ]);
    }
  }

  // Raios base dos anéis espirais irregulares
  const ringRadii = [6.5, 11.2, 16.4, 22.0, 28.2, 34.8, 41.8, 49.2, 56.0];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);

      // Localiza entre quais 2 raios o pixel está
      let s0 = numSpokes - 1;
      let s1 = 0;
      for (let i = 0; i < numSpokes; i++) {
        if (ang >= spokeAngles[i]) {
          s0 = i;
          s1 = (i + 1) % numSpokes;
        }
      }
      let a0 = spokeAngles[s0];
      let a1 = spokeAngles[s1];
      let angTest = ang;
      if (a1 < a0) {
        a1 += Math.PI * 2;
        if (angTest < a0) angTest += Math.PI * 2;
      }
      const sectorSpan = Math.max(0.05, a1 - a0);
      const sectorU = (angTest - a0) / sectorSpan; // 0..1 entre dois raios

      // Distância perpendicular ao raio mais próximo (com leve ondulação orgânica)
      const wave = Math.sin(r * 0.19 + s0 * 1.7) * 0.35;
      const nearAngleDiff = Math.min(angTest - a0, a1 - angTest);
      const nearSpokeIdx = angTest - a0 < a1 - angTest ? s0 : s1;
      const spokeDist = Math.abs(nearAngleDiff * r + wave);
      const onSpoke =
        r <= spokeMaxR[nearSpokeIdx] &&
        spokeDist < (r < 18 ? 0.92 : 0.72);

      // Bifurcações externas em "Y"
      let onFork = false;
      if (!onSpoke && r > 30) {
        for (let f = 0; f < forkSegs.length; f++) {
          const [x0, y0, x1, y1] = forkSegs[f];
          if (distToSegment(x, y, x0, y0, x1, y1).dist < 0.68) {
            onFork = true;
            break;
          }
        }
      }

      // Espirais catenárias entre os raios (com alguns setores rasgados naturalmente)
      let onRing = false;
      let onDewDrop = false;
      const maxRingLimit =
        spokeMaxR[s0] * (1 - sectorU) + spokeMaxR[s1] * sectorU;
      if (r > 4.5 && r < maxRingLimit * 0.92) {
        const sagShape = 4 * sectorU * (1 - sectorU); // parábola catenária 0 -> 1 -> 0
        for (let ri = 0; ri < ringRadii.length; ri++) {
          // Pequenos rasgos orgânicos na teia para não parecer grade perfeita
          if (hash2D(s0 * 7 + ri * 13, ri * 3 + 1) > 0.84) continue;

          const baseR =
            ringRadii[ri] +
            (hash2D(s0, ri * 5.1) - 0.5) * 1.8 * (1 - sectorU) +
            (hash2D(s1, ri * 5.1) - 0.5) * 1.8 * sectorU;
          const sagAmt = 1.4 + ri * 0.34;
          // Os fios curvam-se levemente em direção ao centro entre os raios!
          const expectedR = baseR - sagShape * sagAmt;
          const dRing = Math.abs(r - expectedR);
          if (dRing < 0.66) {
            onRing = true;
            if (
              Math.abs(sectorU - 0.5) < 0.08 &&
              hash2D(s0 + ri, ri * 9) > 0.55
            ) {
              onDewDrop = true;
            }
            break;
          } else if (
            dRing < 1.35 &&
            Math.abs(sectorU - 0.5) < 0.055 &&
            hash2D(s0 + ri, ri * 9) > 0.68
          ) {
            onDewDrop = true;
            break;
          }
        }
      }

      // Emaranhado central irregular de seda densa
      const hubNoise =
        hash2D(Math.floor(x * 0.8), Math.floor(y * 0.8)) * 2.4;
      const inHub =
        r < 5.4 + Math.sin(ang * 5) * 1.1 &&
        (r < 3.1 || hubNoise > 0.95);

      if (inHub || onSpoke || onFork || onRing || onDewDrop) {
        const grit = (hash2D(x, y) - 0.5) * 24;
        let lum = 186;
        if (onDewDrop) lum = 246;
        else if (inHub) lum = 224 + grit * 0.6;
        else if (onSpoke) lum = 216 - r * 0.45 + grit * 0.5;
        else if (onFork) lum = 198 + grit * 0.5;
        else lum = 188 - r * 0.38 + grit * 0.7;

        const v = Math.max(118, Math.min(250, Math.round(lum)));
        data[idx] = Math.round(v * 0.98);
        data[idx + 1] = v;
        data[idx + 2] = Math.round(v * 0.94);
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
 * Gera textura pixel-art 128x128 de CORTINA / MANTO DE TEIA IRREGULAR (Sheet / Funnel Cobweb):
 * Ideal para quinas de paredes, dossel do ninho e casulo ao redor do jogador (sem alvo circular!).
 */
function createCornerSheetWebTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);

  const putSilk = (x: number, y: number, lum: number) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
    const idx = (iy * size + ix) * 4;
    if (data[idx + 3] === 255 && data[idx + 1] >= lum) return;
    const v = Math.max(116, Math.min(248, Math.round(lum)));
    data[idx] = Math.round(v * 0.98);
    data[idx + 1] = v;
    data[idx + 2] = Math.round(v * 0.93);
    data[idx + 3] = 255;
  };

  const drawBezier = (
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    seed: number,
    baseLum: number,
    withDew: boolean
  ) => {
    const len = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
    const steps = Math.max(12, Math.ceil(len * 1.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const it = 1 - t;
      const px =
        it * it * x0 +
        2 * it * t * cx +
        t * t * x1 +
        Math.sin(t * 14 + seed * 3) * 0.5 * Math.sin(t * Math.PI);
      const py =
        it * it * y0 +
        2 * it * t * cy +
        t * t * y1 +
        Math.cos(t * 13 + seed * 2) * 0.5 * Math.sin(t * Math.PI);
      const grit = (hash2D(i + seed * 10, seed) - 0.5) * 24;
      putSilk(px, py, baseLum + grit);
      if (withDew && i > 4 && i < steps - 4 && i % 19 === 0) {
        putSilk(px, py, 246);
        putSilk(px + 1, py, 210);
        putSilk(px, py + 1, 210);
      }
    }
  };

  // 1. Manto fibroso denso no canto (0, 0) onde a teia ancora na quina de pedra
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const d = Math.hypot(x, y);
      if (d < 34) {
        const n = hash2D(x * 0.85, y * 0.85) * 0.65 + hash2D(x + 17, y + 31) * 0.35;
        if (n < (1 - d / 34) * 0.78) {
          putSilk(x, y, 168 + (1 - d / 34) * 58);
        }
      }
    }
  }

  // 2. 9 costelas radiais curvas abrindo em leque assimétrico de (2,2) até as bordas
  const numRibs = 9;
  const ribs: Array<{ ex: number; ey: number }> = [];
  for (let r = 0; r < numRibs; r++) {
    const frac = (r + 0.12 + (hash2D(r, 7.1) - 0.5) * 0.22) / (numRibs - 0.75);
    const ang = Math.min(Math.PI * 0.49, Math.max(0.02, frac * Math.PI * 0.5));
    // Alcance irregular formando borda recortada orgânica
    const reach = 96 + Math.cos((ang - 0.78) * 2.2) * 22 + (hash2D(r, 3.3) - 0.5) * 18;
    const ex = Math.min(125, 2 + Math.cos(ang) * reach);
    const ey = Math.min(125, 2 + Math.sin(ang) * reach);
    ribs.push({ ex, ey });

    const mx = (2 + ex) * 0.5 + (hash2D(r, 11) - 0.5) * 6;
    const my = (2 + ey) * 0.5 + 3.5;
    drawBezier(2, 2, mx, my, ex, ey, r * 1.7, 214, true);

    // Bifurcação em "Y" na ponta externa
    const fx = 2 + (ex - 2) * 0.76;
    const fy = 2 + (ey - 2) * 0.76;
    drawBezier(
      fx,
      fy,
      (fx + ex) * 0.5,
      (fy + ey) * 0.5,
      Math.min(126, ex + Math.sin(ang) * 9),
      Math.min(126, ey - Math.cos(ang) * 9),
      r * 2.9,
      188,
      false
    );
  }

  // 3. 7 níveis de arcos catenários côncavos (curvados em direção ao canto!) entre costelas vizinhas
  const tiers = [0.16, 0.28, 0.41, 0.55, 0.69, 0.83, 0.95];
  for (let r = 0; r < numRibs - 1; r++) {
    const ra = ribs[r];
    const rb = ribs[r + 1];
    for (let ti = 0; ti < tiers.length; ti++) {
      if (hash2D(r * 13 + ti * 5, 19) > 0.85) continue;
      const fa = tiers[ti] + (hash2D(r, ti * 3) - 0.5) * 0.05;
      const fb = tiers[ti] + (hash2D(r + 1, ti * 3) - 0.5) * 0.05;
      const ax = 2 + (ra.ex - 2) * fa;
      const ay = 2 + (ra.ey - 2) * fa;
      const bx = 2 + (rb.ex - 2) * fb;
      const by = 2 + (rb.ey - 2) * fb;
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;
      const pull = 0.22 + ti * 0.02;
      const cx = mx * (1 - pull) + 2 * pull;
      const cy = my * (1 - pull) + 2 * pull + 2.5;
      drawBezier(ax, ay, cx, cy, bx, by, r * 7 + ti, 192 - ti * 4, ti >= 3);

      // Fios soltos pendentes da borda externa recortada
      if (ti >= 5 && hash2D(r + ti, 41) > 0.52) {
        drawBezier(
          mx,
          my,
          mx + 2,
          my + 11,
          mx - 1,
          Math.min(126, my + 22),
          r * 11 + ti,
          172,
          true
        );
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
 * Textura fibrosa opaca 16x16 para cordões tensos/catenários de seda 3D e casulos pendurados.
 */
function createDenseSilkFiberTexture(): THREE.DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const fiber = Math.sin(y * 1.3 + x * 0.6) * 18;
      const grit = ((x * 7 + y * 13) % 9) - 4;
      const v = Math.max(135, Math.min(238, Math.round(192 + fiber + grit * 2)));
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
 * Constrói um cabo 3D orgânico de seda com curvatura catenária natural (cede sob gravidade)
 * em vez de parecer uma vareta reta rígida.
 */
function buildCatenarySilkGroup(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  radius: number,
  mat: THREE.Material,
  segments = 4
): THREE.Group {
  const grp = new THREE.Group();
  let prev = a.clone();
  const cur = new THREE.Vector3();
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    cur.lerpVectors(a, b, t);
    cur.y -= 4 * t * (1 - t) * sag;
    const rSeg = radius * (1 - 0.25 * Math.sin(t * Math.PI));
    grp.add(buildSilkStrandMesh(prev, cur, rSeg, mat));
    prev = cur.clone();
  }
  return grp;
}

/**
 * Gerenciador de Armadilhas de Teia + Ninho Principal da Aranha (`Lair`):
 * - Texturas pixel-art 128x128 orgânicas separadas para teia orbital de captura e mantos de quina.
 * - Fios catenários 3D reais no Ninho Sul, nas armadilhas e ao redor do jogador quando capturado!
 * - Suporta corte instantâneo com o Canivete (`slashWebWithKnife`), acionando também o rasgo visual.
 */
export class DoomSpiderWebManager {
  private readonly root = new THREE.Group();
  private readonly orbWebMat: THREE.ShaderMaterial;
  private readonly sheetWebMat: THREE.ShaderMaterial;
  private readonly silkSolidMat: THREE.ShaderMaterial;
  private readonly traps: SpiderWebTrap[] = [];
  private nextTrapId = 1;
  private readonly maxActiveTraps = 7;

  readonly lairCenter: THREE.Vector3;
  readonly dragCorridorStart: THREE.Vector3;

  private ensnaredRemaining = 0;
  private ensnaredMaxDuration = 2.85;
  private ensnaredPos = new THREE.Vector3();
  private activeSnareTrapGroup: THREE.Group | null = null;

  // Fios 3D que envolvem e prendem o corpo do jogador quando ele cai numa armadilha de corredor
  private readonly playerSnareTetherGroup = new THREE.Group();

  // Quando o jogador acorda ferido no centro do Ninho de Teia, precisa caminhar ou cortar para sair
  private inWakingLairWeb = false;
  private lairCocoonRing: THREE.Object3D | null = null;

  // Contador incrementado toda vez que fios ao redor do jogador se rompem / são cortados
  private webSnapBurstSeq = 0;

  constructor(scene: THREE.Scene, sharedUniforms: DoomSharedUniforms) {
    this.root.name = 'DoomSpiderWebs';
    scene.add(this.root);

    this.orbWebMat = createDoomPropMaterial(
      createOrbTrapWebTexture(),
      sharedUniforms,
      {
        baseLight: 0.5,
        alphaTest: 0.45,
        doubleSided: true,
        emissiveBoost: 0.06,
      }
    );

    this.sheetWebMat = createDoomPropMaterial(
      createCornerSheetWebTexture(),
      sharedUniforms,
      {
        baseLight: 0.48,
        alphaTest: 0.45,
        doubleSided: true,
        emissiveBoost: 0.06,
      }
    );

    this.silkSolidMat = createDoomPropMaterial(
      createDenseSilkFiberTexture(),
      sharedUniforms,
      {
        baseLight: 0.48,
        emissiveBoost: 0.06,
      }
    );

    const lairW = gridCellToWorld(7, 11);
    this.lairCenter = new THREE.Vector3(lairW.x, 0, lairW.z);

    const dragStartW = gridCellToWorld(7, 9);
    this.dragCorridorStart = new THREE.Vector3(
      dragStartW.x,
      0,
      dragStartW.z + 0.4
    );

    this.buildMainSpiderLair();
    this.buildPlayerSnareTethers();

    // Duas armadilhas iniciais em corredores intermediários (fora do corredor de arrasto do ninho)
    const presetA = gridCellToWorld(8, 3);
    const presetB = gridCellToWorld(3, 9);
    this.spawnWebTrap(presetA.x, presetA.z, true);
    this.spawnWebTrap(presetB.x, presetB.z, true);
  }

  /**
   * Constrói o feixe 3D de fios viscosos que se agarram da armadilha ao tronco do jogador quando preso.
   */
  private buildPlayerSnareTethers(): void {
    this.playerSnareTetherGroup.visible = false;
    const anchors: Array<[number, number, number, number, number]> = [
      [-0.95, 0.03, -0.75, -0.26, 0.92],
      [0.98, 0.03, -0.68, 0.28, 0.86],
      [-0.88, 0.03, 0.84, -0.24, 0.78],
      [0.92, 0.03, 0.78, 0.25, 0.96],
      [-1.12, 0.48, 0.05, -0.3, 1.08],
      [1.12, 0.52, -0.06, 0.3, 1.04],
      [0.08, 0.03, -1.05, 0.04, 0.74],
      [-0.12, 0.03, 1.02, -0.05, 0.82],
    ];
    for (const [ax, ay, az, tx, ty] of anchors) {
      this.playerSnareTetherGroup.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(ax, ay, az),
          new THREE.Vector3(tx, ty, 0),
          0.07,
          0.0085,
          this.silkSolidMat,
          3
        )
      );
    }
    this.root.add(this.playerSnareTetherGroup);
  }

  /**
   * Constrói o Ninho Principal da Aranha em (gx=7, gz=11) com manto orgânico no piso,
   * véus de quina, cabos catenários 3D, casulos amarrados e casulo envolvente 3D para o despertar!
   */
  private buildMainSpiderLair(): void {
    const lairGroup = new THREE.Group();
    lairGroup.name = 'SpiderMainLair';
    lairGroup.position.copy(this.lairCenter);

    // 1. Manto denso sobreposto de teia no piso central onde a vítima acorda
    for (let k = 0; k < 3; k++) {
      const bed = new THREE.Mesh(
        new THREE.PlaneGeometry(3.75 - k * 0.45, 3.75 - k * 0.45),
        k === 1 ? this.sheetWebMat : this.orbWebMat
      );
      bed.rotation.x = -Math.PI * 0.5;
      bed.rotation.z = k * 1.12 + 0.2;
      bed.position.y = 0.02 + k * 0.012;
      lairGroup.add(bed);
    }

    // 2. Dossel irregular suspenso no teto acima do ninho
    for (let c = 0; c < 2; c++) {
      const canopy = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6 - c * 0.4, 3.6 - c * 0.4),
        c === 0 ? this.orbWebMat : this.sheetWebMat
      );
      canopy.rotation.x = Math.PI * 0.5;
      canopy.rotation.z = 0.35 + c * 1.4;
      canopy.position.y = WALL_HEIGHT - 0.055 - c * 0.03;
      lairGroup.add(canopy);
    }

    // 3. Mantos de funil nas 4 quinas + cabos catenários curvos 3D
    const cornerOffsets: Array<[number, number, number]> = [
      [-1.52, -1.44, 0.72],
      [1.52, -1.44, -0.72],
      [-1.52, 1.44, -0.72],
      [1.52, 1.44, 0.72],
    ];
    for (const [cx, cz, rotY] of cornerOffsets) {
      const drape = new THREE.Mesh(
        new THREE.PlaneGeometry(2.45, 2.8),
        this.sheetWebMat
      );
      drape.position.set(cx, 1.44, cz);
      drape.rotation.y = rotY;
      drape.rotation.x = cz < 0 ? 0.22 : -0.22;
      // Espelha no lado +X para que o vértice denso (UV 0,0) sempre encoste na quina da parede externa!
      drape.scale.x = cx > 0 ? -1 : 1;
      lairGroup.add(drape);

      // Cabos curvos catenários ligando piso, colunas e teto
      lairGroup.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(cx * 0.62, 0.03, cz * 0.62),
          new THREE.Vector3(cx * 1.12, WALL_HEIGHT - 0.1, cz * 1.12),
          0.14,
          0.013,
          this.silkSolidMat,
          4
        )
      );
      lairGroup.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(0, WALL_HEIGHT - 0.07, 0),
          new THREE.Vector3(cx * 1.16, 1.82, cz * 1.16),
          0.18,
          0.01,
          this.silkSolidMat,
          4
        )
      );
    }

    // 4. Casulos orgânicos 3D pendurados nas quinas superiores com voltas de seda espiraladas
    const hangingPods: Array<[number, number, number, number]> = [
      [-1.38, 2.24, -1.32, 0.34],
      [1.42, 2.34, -1.28, 0.29],
      [-1.34, 2.18, 1.36, 0.32],
    ];
    for (const [px, py, pz, scale] of hangingPods) {
      const podGroup = new THREE.Group();
      podGroup.position.set(px, py, pz);

      const stalkLen = WALL_HEIGHT - py;
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.022, stalkLen, 6),
        this.silkSolidMat
      );
      stalk.position.y = stalkLen * 0.5;
      podGroup.add(stalk);

      const upper = new THREE.Mesh(
        new THREE.ConeGeometry(scale * 0.6, scale * 0.88, 8),
        this.silkSolidMat
      );
      upper.position.y = scale * 0.28;
      const middle = new THREE.Mesh(
        new THREE.DodecahedronGeometry(scale * 0.64, 1),
        this.silkSolidMat
      );
      middle.scale.set(0.9, 1.38, 0.9);
      middle.position.y = -scale * 0.14;
      const lower = new THREE.Mesh(
        new THREE.ConeGeometry(scale * 0.54, scale * 1.05, 8),
        this.silkSolidMat
      );
      lower.rotation.x = Math.PI;
      lower.position.y = -scale * 0.74;
      podGroup.add(upper, middle, lower);

      // Anéis oblíquos de seda amarrando o casulo + fio solto pendente na ponta inferior
      for (let w = -1; w <= 1; w++) {
        const wrap = new THREE.Mesh(
          new THREE.TorusGeometry(scale * (0.56 - Math.abs(w) * 0.08), 0.014, 5, 10),
          this.silkSolidMat
        );
        wrap.position.y = -scale * 0.14 + w * scale * 0.3;
        wrap.rotation.x = Math.PI * 0.5 + w * 0.28;
        wrap.rotation.y = w * 0.35;
        podGroup.add(wrap);
      }
      const tailWisp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.002, scale * 0.65, 4),
        this.silkSolidMat
      );
      tailWisp.position.y = -scale * 1.42;
      podGroup.add(tailWisp);

      lairGroup.add(podGroup);
    }

    // 5. Casulo 3D orgânico ao redor do jogador quando ele acorda no centro do Ninho:
    //    8 véus inclinados de teia irregular + 12 cabos catenários cruzados envolvendo a vítima!
    const cocoonHolder = new THREE.Group();
    const shroudCount = 8;
    for (let s = 0; s < shroudCount; s++) {
      const ang = (s / shroudCount) * Math.PI * 2 + (s % 2) * 0.12;
      const rMid = 1.08 + (s % 3) * 0.08;
      const hPanel = 1.15 + (s % 2) * 0.22;
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(1.05, hPanel),
        this.sheetWebMat
      );
      panel.position.set(
        Math.cos(ang) * rMid,
        hPanel * 0.42,
        Math.sin(ang) * rMid
      );
      panel.rotation.y = -ang + Math.PI * 0.5;
      panel.rotation.x = 0.36;
      panel.rotation.z = (s % 2 === 0 ? 1 : -1) * 0.18;
      cocoonHolder.add(panel);
    }

    for (let s = 0; s < 12; s++) {
      const ang = (s / 12) * Math.PI * 2;
      const nextAng = ang + (s % 2 === 0 ? 0.52 : -0.44);
      cocoonHolder.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(Math.cos(ang) * 1.52, 0.03, Math.sin(ang) * 1.52),
          new THREE.Vector3(
            Math.cos(nextAng) * 0.78,
            0.92 + (s % 3) * 0.18,
            Math.sin(nextAng) * 0.78
          ),
          0.11,
          0.01,
          this.silkSolidMat,
          3
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

  /** Progresso normalizado [0..1] da prisão atual na teia para animar tensão dos fios na tela */
  get snareTensionFactor(): number {
    if (this.inWakingLairWeb) return 1.0;
    if (this.ensnaredRemaining <= 0) return 0;
    return Math.max(
      0,
      Math.min(1, this.ensnaredRemaining / this.ensnaredMaxDuration)
    );
  }

  get snapBurstSequence(): number {
    return this.webSnapBurstSeq;
  }

  clearEnsnarement(): void {
    this.ensnaredRemaining = 0;
    this.inWakingLairWeb = false;
    this.activeSnareTrapGroup = null;
    this.playerSnareTetherGroup.visible = false;
    if (this.lairCocoonRing) {
      this.lairCocoonRing.visible = false;
    }
  }

  /**
   * Prende o jogador recém-acordado no centro do Ninho de Teia da Aranha.
   */
  placePlayerInWakingLairWeb(): void {
    this.ensnaredRemaining = 0;
    this.inWakingLairWeb = true;
    this.playerSnareTetherGroup.visible = false;
    if (this.lairCocoonRing) {
      this.lairCocoonRing.visible = true;
      this.lairCocoonRing.scale.set(1, 1, 1);
    }
  }

  /**
   * Golpe ativo com o Canivete Oxidado (ex.: via atalho rápido [1], [2] ou [3]):
   * - Corta todos os fios IMEDIATAMENTE e dispara o estalo visual de rompimento!
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
      this.webSnapBurstSeq++;
      sound.playWebTrapSnap();
      return { cutActiveSnare: true, cutNearbyTrap: false };
    }

    if (this.ensnaredRemaining > 0) {
      this.ensnaredRemaining = 0;
      this.playerSnareTetherGroup.visible = false;
      if (this.activeSnareTrapGroup) {
        this.activeSnareTrapGroup.scale.set(0.5, 0.12, 0.5);
        this.activeSnareTrapGroup = null;
      }
      this.webSnapBurstSeq++;
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
    return Math.max(0, Math.min(1, 1 - d / 1.75)) * 0.92;
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
   * Cria uma nova armadilha 3D de teia no piso + mantos irregulares laterais + cabos catenários ancorados às paredes.
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

    // 1. Teia orbital assimétrica no chão
    const floorWeb = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      this.orbWebMat
    );
    floorWeb.rotation.x = -Math.PI * 0.5;
    floorWeb.rotation.z = (this.nextTrapId * 0.83) % (Math.PI * 2);
    floorWeb.position.y = 0.026;
    group.add(floorWeb);

    const { gx, gz } = worldToGridCell(wx, wz);
    const northSouthWalls =
      isSolidCell(LABYRINTH_MAP, gx, gz - 1) &&
      isSolidCell(LABYRINTH_MAP, gx, gz + 1);
    const eastWestWalls =
      isSolidCell(LABYRINTH_MAP, gx - 1, gz) &&
      isSolidCell(LABYRINTH_MAP, gx + 1, gz);

    // Eixo longitudinal do corredor: se paredes a Leste/Oeste, o jogador caminha em Z (cortina de frente para Z);
    // se paredes a Norte/Sul, o jogador caminha em X (cortina rotacionada 90° encarando X).
    const corridorFacesX = northSouthWalls && !eastWestWalls;
    const baseYaw = corridorFacesX ? Math.PI * 0.5 : 0;

    // 2. Cortina inclinada de captura atravessando o corredor na altura dos joelhos/quadril (sempre visível de frente!)
    const crossSnare = new THREE.Mesh(
      new THREE.PlaneGeometry(2.35, 1.55),
      this.orbWebMat
    );
    crossSnare.position.set(0, 0.64, 0);
    crossSnare.rotation.order = 'YXZ';
    crossSnare.rotation.y = baseYaw + ((this.nextTrapId % 2 === 0 ? 1 : -1) * 0.28);
    crossSnare.rotation.x = -0.46;
    group.add(crossSnare);

    // 3. Mantos irregulares de quina + cabos catenários curvos ancorados nas duas paredes laterais
    for (const sign of [-1, 1]) {
      const cornerWeb = new THREE.Mesh(
        new THREE.PlaneGeometry(1.68, 1.64),
        this.sheetWebMat
      );
      cornerWeb.rotation.order = 'YXZ';
      // Espelha UV (0,0) para encostar exatamente na junção parede+piso de cada lado!
      cornerWeb.scale.x = sign > 0 ? -1 : 1;

      if (!corridorFacesX) {
        // Paredes a Leste/Oeste (±X), corredor ao longo de Z -> quinas presas nas paredes ±X abrindo para o centro
        cornerWeb.position.set(sign * (CELL_SIZE * 0.28), 0.82, sign * 0.14);
        cornerWeb.rotation.y = -sign * 0.32;
        cornerWeb.rotation.x = -0.18;

        group.add(
          buildCatenarySilkGroup(
            new THREE.Vector3(-sign * 0.22, 0.04, -0.34),
            new THREE.Vector3(sign * (CELL_SIZE * 0.48), 1.52, -0.42),
            0.12,
            0.009,
            this.silkSolidMat,
            3
          )
        );
        group.add(
          buildCatenarySilkGroup(
            new THREE.Vector3(0, 0.04, 0.34),
            new THREE.Vector3(sign * (CELL_SIZE * 0.48), 1.08, 0.42),
            0.1,
            0.009,
            this.silkSolidMat,
            3
          )
        );
      } else {
        // Paredes a Norte/Sul (±Z), corredor ao longo de X -> quinas presas nas paredes ±Z abrindo para o centro
        cornerWeb.position.set(sign * 0.14, 0.82, sign * (CELL_SIZE * 0.28));
        cornerWeb.rotation.y = Math.PI * 0.5 - sign * 0.32;
        cornerWeb.rotation.x = -0.18;

        group.add(
          buildCatenarySilkGroup(
            new THREE.Vector3(-0.34, 0.04, -sign * 0.22),
            new THREE.Vector3(-0.42, 1.52, sign * (CELL_SIZE * 0.48)),
            0.12,
            0.009,
            this.silkSolidMat,
            3
          )
        );
        group.add(
          buildCatenarySilkGroup(
            new THREE.Vector3(0.34, 0.04, 0),
            new THREE.Vector3(0.42, 1.08, sign * (CELL_SIZE * 0.48)),
            0.1,
            0.009,
            this.silkSolidMat,
            3
          )
        );
      }
      group.add(cornerWeb);
    }

    // Cabo superior pendente de parede a parede dando leitura imediata da armadilha
    if (!corridorFacesX) {
      group.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(-CELL_SIZE * 0.48, 1.56, -0.12),
          new THREE.Vector3(CELL_SIZE * 0.48, 1.48, 0.14),
          0.26,
          0.01,
          this.silkSolidMat,
          4
        )
      );
    } else {
      group.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(-0.12, 1.56, -CELL_SIZE * 0.48),
          new THREE.Vector3(0.14, 1.48, CELL_SIZE * 0.48),
          0.26,
          0.01,
          this.silkSolidMat,
          4
        )
      );
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
   * Atualiza teias nos corredores + fios 3D presos ao jogador + saída viscosa do Ninho Principal!
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
      this.playerSnareTetherGroup.visible = false;
      const distFromNest = Math.hypot(
        playerPos.x - this.lairCenter.x,
        playerPos.z - this.lairCenter.z
      );

      if (this.lairCocoonRing) {
        const stretch = 1 + (distFromNest / 1.7) * 0.3;
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
        this.webSnapBurstSeq++;
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
        trap.group.scale.set(0.82, 0.42, 0.82);
        this.activeSnareTrapGroup = trap.group;
        const grp = trap.group;
        setTimeout(() => {
          this.root.remove(grp);
        }, 2400);

        this.ensnaredRemaining = this.ensnaredMaxDuration;
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

      if (this.ensnaredRemaining > 0) {
        // Mantém os fios 3D tensionados ligando a armadilha ao redor do corpo do jogador
        this.playerSnareTetherGroup.visible = true;
        this.playerSnareTetherGroup.position.set(
          (playerPos.x + this.ensnaredPos.x) * 0.5,
          0,
          (playerPos.z + this.ensnaredPos.z) * 0.5
        );
        const ratio = this.ensnaredRemaining / this.ensnaredMaxDuration;
        this.playerSnareTetherGroup.scale.set(1, 0.45 + 0.55 * ratio, 1);
      } else {
        this.playerSnareTetherGroup.visible = false;
        this.webSnapBurstSeq++;
        sound.playWebTrapSnap();
      }

      return { speedMultiplier: 0.18 };
    }

    this.playerSnareTetherGroup.visible = false;
    return { speedMultiplier: 1.0 };
  }
}
