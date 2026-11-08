import * as THREE from 'three';
import { SoundEngine } from '../engine/audio/SoundEngine';
import {
  CELL_SIZE,
  DRAG_START_GRID_CELL,
  gridCellToWorld,
  INITIAL_WEB_TRAP_CELLS,
  isSolidCell,
  LABYRINTH_MAP,
  LAIR_GRID_CELL,
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

  // Pré-calcula segmentos de ancoragem em "Y" nas extremidades dos raios até as bordas reais de fixação
  const forkSegs: Array<[number, number, number, number]> = [];
  const spokeMaxR: number[] = [];
  for (let i = 0; i < numSpokes; i++) {
    const a = spokeAngles[i];
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const distX =
      Math.abs(cosA) > 1e-3
        ? (cosA > 0 ? size - 1 - cx : cx) / Math.abs(cosA)
        : 999;
    const distY =
      Math.abs(sinA) > 1e-3
        ? (sinA > 0 ? size - 1 - cy : cy) / Math.abs(sinA)
        : 999;
    const borderReach = Math.min(distX, distY);

    // Os raios principais e suas bifurcações em "Y" alcançam até a borda de ancoragem (parede/piso/cabo superior),
    // enquanto os anéis espirais permanecem orgânicos e côncavos mais ao centro!
    const maxR = borderReach * (0.96 + hash2D(i, 2.3) * 0.04);
    spokeMaxR.push(maxR);

    const ringLimitR = Math.min(58, 47 + hash2D(i, 4.1) * 9);
    const forkR = Math.min(ringLimitR * 0.82, maxR * 0.72);
    const fx = cx + cosA * forkR;
    const fy = cy + sinA * forkR;
    for (const side of [-1, 1]) {
      const fa = a + side * (0.13 + hash2D(i, side + 5) * 0.06);
      const fCos = Math.cos(fa);
      const fSin = Math.sin(fa);
      const fDx =
        Math.abs(fCos) > 1e-3
          ? (fCos > 0 ? size - 1 - cx : cx) / Math.abs(fCos)
          : 999;
      const fDy =
        Math.abs(fSin) > 1e-3
          ? (fSin > 0 ? size - 1 - cy : cy) / Math.abs(fSin)
          : 999;
      const fReach = Math.min(fDx, fDy);
      forkSegs.push([fx, fy, cx + fCos * fReach, cy + fSin * fReach]);
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
  grp.userData = {
    webPart: 'catenary_cable',
    anchorA: a.clone(),
    anchorB: b.clone(),
  };
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
 * Constrói uma malha de manto de quina (`sheetWebMat`) ancorada explicitamente em 3 pontos reais:
 * - `cornerOrigin` (UV 0,0): quina densa onde as duas superfícies sólidas se encontram (ex.: Parede ∩ Piso).
 * - `edgeAlongU0`  (UV 0,1): extremidade ao longo da superfície sólida A (ex.: subindo rente à parede real).
 * - `edgeAlongV0`  (UV 1,0): extremidade ao longo da superfície sólida B (ex.: avançando sobre o piso/teto/2ª parede).
 * A curva catenária aberta da textura conecta `edgeAlongU0` a `edgeAlongV0` sem JAMAIS gerar borda reta flutuando no ar!
 */
function buildAnchoredCornerSheet(
  cornerOrigin: THREE.Vector3,
  edgeAlongU0: THREE.Vector3,
  edgeAlongV0: THREE.Vector3,
  mat: THREE.Material
): THREE.Mesh {
  const outer = new THREE.Vector3()
    .addVectors(edgeAlongU0, edgeAlongV0)
    .sub(cornerOrigin);

  const positions = new Float32Array([
    cornerOrigin.x,
    cornerOrigin.y,
    cornerOrigin.z,
    edgeAlongV0.x,
    edgeAlongV0.y,
    edgeAlongV0.z,
    edgeAlongU0.x,
    edgeAlongU0.y,
    edgeAlongU0.z,
    outer.x,
    outer.y,
    outer.z,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const indices = new Uint16Array([0, 1, 2, 2, 1, 3]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = {
    webPart: 'anchored_corner_sheet',
    cornerOrigin: cornerOrigin.clone(),
    edgeAlongU0: edgeAlongU0.clone(),
    edgeAlongV0: edgeAlongV0.clone(),
  };
  return mesh;
}

/**
 * Constrói uma teia orbital (`orbWebMat`) tensionada entre DOIS suportes laterais reais verificados:
 * - Borda esquerda (`botA -> topA`) ancorada 100% na Parede Sólida A.
 * - Borda direita  (`botB -> topB`) ancorada 100% na Parede Sólida B.
 * - Base (`botA -> botB`) rente ao piso sólido.
 */
function buildAnchoredOrbQuad(
  botA: THREE.Vector3,
  botB: THREE.Vector3,
  topA: THREE.Vector3,
  topB: THREE.Vector3,
  mat: THREE.Material
): THREE.Mesh {
  const positions = new Float32Array([
    botA.x,
    botA.y,
    botA.z,
    botB.x,
    botB.y,
    botB.z,
    topA.x,
    topA.y,
    topA.z,
    topB.x,
    topB.y,
    topB.z,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const indices = new Uint16Array([0, 1, 2, 2, 1, 3]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData = {
    webPart: 'anchored_orb_quad',
    botA: botA.clone(),
    botB: botB.clone(),
    topA: topA.clone(),
    topB: topB.clone(),
  };
  return mesh;
}

/**
 * Gerenciador de Armadilhas de Teia + Ninho Principal da Aranha (`Lair`):
 * - Texturas pixel-art 128x128 orgânicas separadas para teia orbital de captura e mantos de quina.
 * - Fios catenários 3D reais no Ninho Sul, nas armadilhas e ao redor do jogador quando capturado!
 * - Suporta corte instantâneo com o Canivete (`slashWebWithKnife`), acionando também o rasgo visual.
 */
let cachedWebTextures: {
  orb: THREE.DataTexture;
  cornerSheet: THREE.DataTexture;
  denseSilk: THREE.DataTexture;
} | null = null;

function getCachedWebTextures() {
  if (!cachedWebTextures) {
    cachedWebTextures = {
      orb: createOrbTrapWebTexture(),
      cornerSheet: createCornerSheetWebTexture(),
      denseSilk: createDenseSilkFiberTexture(),
    };
  }
  return cachedWebTextures;
}

export class DoomSpiderWebManager {
  private readonly root = new THREE.Group();
  private readonly orbWebMat: THREE.ShaderMaterial;
  private readonly sheetWebMat: THREE.ShaderMaterial;
  private readonly silkSolidMat: THREE.ShaderMaterial;
  private readonly traps: SpiderWebTrap[] = [];
  private nextTrapId = 1;
  private readonly maxActiveTraps = 14;

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

    const webTex = getCachedWebTextures();

    this.orbWebMat = createDoomPropMaterial(webTex.orb, sharedUniforms, {
      baseLight: 0.3,
      alphaTest: 0.45,
      doubleSided: true,
      emissiveBoost: 0.03,
    });

    this.sheetWebMat = createDoomPropMaterial(
      webTex.cornerSheet,
      sharedUniforms,
      {
        baseLight: 0.28,
        alphaTest: 0.45,
        doubleSided: true,
        emissiveBoost: 0.03,
      }
    );

    this.silkSolidMat = createDoomPropMaterial(
      webTex.denseSilk,
      sharedUniforms,
      {
        baseLight: 0.28,
        emissiveBoost: 0.03,
      }
    );

    const lairW = gridCellToWorld(LAIR_GRID_CELL.gx, LAIR_GRID_CELL.gz);
    this.lairCenter = new THREE.Vector3(lairW.x, 0, lairW.z);

    const dragStartW = gridCellToWorld(
      DRAG_START_GRID_CELL.gx,
      DRAG_START_GRID_CELL.gz
    );
    this.dragCorridorStart = new THREE.Vector3(
      dragStartW.x,
      0,
      dragStartW.z + 0.4
    );

    this.buildMainSpiderLair();
    this.buildPlayerSnareTethers();

    // Armadilhas iniciais distribuídas estrategicamente pelos 5 setores (fora do corredor de arrasto)
    for (const tc of INITIAL_WEB_TRAP_CELLS) {
      const presetW = gridCellToWorld(tc.gx, tc.gz);
      this.spawnWebTrap(presetW.x, presetW.z, true);
    }
  }

  /**
   * Constrói o feixe 3D de fios viscosos que puxam do manto do piso ao tronco do jogador quando preso
   * (todas as bases partem 100% do piso real `y = 0.03`, nunca flutuando no ar em corredores abertos).
   */
  private buildPlayerSnareTethers(): void {
    this.playerSnareTetherGroup.visible = false;
    const anchors: Array<[number, number, number, number, number]> = [
      [-0.86, 0.03, -0.72, -0.26, 0.92],
      [0.88, 0.03, -0.66, 0.28, 0.86],
      [-0.82, 0.03, 0.78, -0.24, 0.78],
      [0.84, 0.03, 0.74, 0.25, 0.96],
      [-0.92, 0.03, 0.05, -0.3, 1.06],
      [0.92, 0.03, -0.06, 0.3, 1.02],
      [0.08, 0.03, -0.94, 0.04, 0.74],
      [-0.12, 0.03, 0.92, -0.05, 0.82],
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

    // 3. Mantos de funil nas 4 quinas sólidas de pedra (±1.49, ±1.49) varrendo para DENTRO do ninho (sem invadir corredores laterais!)
    const cornerSigns: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    for (const [sx, sz] of cornerSigns) {
      const px = sx * (CELL_SIZE * 0.5 - 0.01);
      const pz = sz * (CELL_SIZE * 0.5 - 0.01);

      // Manto inferior ancorado na aresta vertical da coluna de pedra + piso do ninho
      lairGroup.add(
        buildAnchoredCornerSheet(
          new THREE.Vector3(px, 0.03, pz),
          new THREE.Vector3(px, 2.48, pz),
          new THREE.Vector3(sx * 0.28, 0.035, sz * 0.28),
          this.sheetWebMat
        )
      );
      // Manto superior ancorado na aresta vertical da coluna de pedra + teto do ninho
      lairGroup.add(
        buildAnchoredCornerSheet(
          new THREE.Vector3(px, WALL_HEIGHT - 0.04, pz),
          new THREE.Vector3(px, 1.56, pz),
          new THREE.Vector3(sx * 0.24, WALL_HEIGHT - 0.04, sz * 0.24),
          this.sheetWebMat
        )
      );

      // Cabos curvos catenários ligando piso, quinas sólidas de pedra e teto
      lairGroup.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(sx * 0.88, 0.03, sz * 0.88),
          new THREE.Vector3(px, WALL_HEIGHT - 0.1, pz),
          0.14,
          0.013,
          this.silkSolidMat,
          4
        )
      );
      lairGroup.add(
        buildCatenarySilkGroup(
          new THREE.Vector3(0, WALL_HEIGHT - 0.07, 0),
          new THREE.Vector3(px, 1.82, pz),
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
  ): {
    cutActiveSnare: boolean;
    cutNearbyTrap: boolean;
    cutTrapPos?: { x: number; z: number };
  } {
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
        // Colapsa apenas verticalmente para nunca descolar as âncoras laterais das paredes reais!
        this.activeSnareTrapGroup.scale.set(1, 0.14, 1);
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
        trap.group.scale.set(1, 0.16, 1);
        const grp = trap.group;
        setTimeout(() => {
          this.root.remove(grp);
        }, 700);
        sound.playWebTrapSnap();
        return {
          cutActiveSnare: false,
          cutNearbyTrap: true,
          cutTrapPos: { x: trap.position.x, z: trap.position.z },
        };
      }
    }

    return { cutActiveSnare: false, cutNearbyTrap: false };
  }

  /**
   * Colapsa e remove sincronizadamente uma armadilha de corredor próxima a `(wx, wz)`
   * quando outro jogador do esquadrão a corta ou aciona no Multiplayer.
   */
  collapseTrapNearWorld(wx: number, wz: number): boolean {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i];
      if (trap.triggered) continue;
      if (Math.hypot(trap.position.x - wx, trap.position.z - wz) <= 2.2) {
        trap.triggered = true;
        trap.group.scale.set(1, 0.16, 1);
        const grp = trap.group;
        setTimeout(() => {
          this.root.remove(grp);
        }, 700);
        return true;
      }
    }
    return false;
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

  getActiveTraps(): readonly SpiderWebTrap[] {
    return this.traps;
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
   * Cria uma nova armadilha 3D de teia cuja modelagem adapta-se EXATAMENTE às superfícies reais da célula `(gx, gz)`:
   * - Centraliza na célula para alinhamento milimétrico com paredes (`±1.47m`), piso (`0.025m`) e teto (`3.16m`).
   * - Corredor reto (2 paredes opostas): teia orbital inclinada ancorada de parede a parede + cabo catenário superior + mantos laterais.
   * - Curva em "L" (2 paredes adjacentes perpendiculares): teia orbital diagonal ancorada entre as duas paredes reais + manto de quina interna.
   * - Parede única (bifurcação em "T" / borda de câmara): funis inclinados e cabos catenários da única parede real para o piso/teto (ZERO planos tentando prender no ar!).
   * - Cruzamento aberto sem paredes cardinais: ancoragem exclusiva nas quinas diagonais sólidas reais e no piso/teto.
   */
  spawnWebTrap(wx: number, wz: number, instant = false): SpiderWebTrap | null {
    const { gx, gz } = worldToGridCell(wx, wz);
    if (isSolidCell(LABYRINTH_MAP, gx, gz)) return null;

    const cellCenter = gridCellToWorld(gx, gz);
    const cx = cellCenter.x;
    const cz = cellCenter.z;

    if (this.hasTrapNear(cx, cz, 2.8)) return null;

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
    group.name = `SpiderWebTrap_${gx}_${gz}`;
    group.position.set(cx, 0, cz);

    // 1. Teia orbital assimétrica rente ao piso sólido
    const floorWeb = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      this.orbWebMat
    );
    floorWeb.rotation.x = -Math.PI * 0.5;
    floorWeb.rotation.z = (this.nextTrapId * 0.83) % (Math.PI * 2);
    floorWeb.position.y = 0.026;
    floorWeb.userData = { webPart: 'floor_orb_web' };
    group.add(floorWeb);

    const solidN = isSolidCell(LABYRINTH_MAP, gx, gz - 1);
    const solidS = isSolidCell(LABYRINTH_MAP, gx, gz + 1);
    const solidW = isSolidCell(LABYRINTH_MAP, gx - 1, gz);
    const solidE = isSolidCell(LABYRINTH_MAP, gx + 1, gz);

    const WALL_D = CELL_SIZE * 0.5 + 0.01; // 1.51m: crava 1cm dentro da face sólida da parede (±1.50m) eliminando qualquer fresta!

    // Helper: adiciona um manto de quina + 2 cabos catenários 100% ancorados numa parede cardinal REAL (wallNx, wallNz) e no piso!
    const addVerifiedWallDrape = (
      wallNx: number,
      wallNz: number,
      tangentShiftSign: number
    ): void => {
      const tx = -wallNz;
      const tz = wallNx;

      const cornerOrigin = new THREE.Vector3(
        wallNx * WALL_D + tx * (tangentShiftSign * 0.18),
        0.025,
        wallNz * WALL_D + tz * (tangentShiftSign * 0.18)
      );
      const wallTop = new THREE.Vector3(
        wallNx * WALL_D + tx * (tangentShiftSign * 0.28),
        1.52,
        wallNz * WALL_D + tz * (tangentShiftSign * 0.28)
      );
      const floorInner = new THREE.Vector3(
        wallNx * 0.08 - tx * (tangentShiftSign * 0.16),
        0.028,
        wallNz * 0.08 - tz * (tangentShiftSign * 0.16)
      );

      group.add(
        buildAnchoredCornerSheet(
          cornerOrigin,
          wallTop,
          floorInner,
          this.sheetWebMat
        )
      );
      group.add(
        buildCatenarySilkGroup(
          wallTop,
          floorInner,
          0.11,
          0.009,
          this.silkSolidMat,
          3
        )
      );

      const secondWallAnchor = new THREE.Vector3(
        wallNx * WALL_D - tx * (tangentShiftSign * 0.42),
        1.12,
        wallNz * WALL_D - tz * (tangentShiftSign * 0.42)
      );
      const secondFloorAnchor = new THREE.Vector3(
        wallNx * 0.22 - tx * (tangentShiftSign * 0.34),
        0.03,
        wallNz * 0.22 - tz * (tangentShiftSign * 0.34)
      );
      group.add(
        buildCatenarySilkGroup(
          secondWallAnchor,
          secondFloorAnchor,
          0.09,
          0.009,
          this.silkSolidMat,
          3
        )
      );
    };

    const hasOppositeWE = solidW && solidE;
    const hasOppositeNS = solidN && solidS;

    if (hasOppositeWE || hasOppositeNS) {
      // ======================================================================
      // TOPOLOGIA 1: CORREDOR RETO / BECO COM PAREDES OPOSTAS REAIS
      // ======================================================================
      // Se WE são paredes sólidas, o vão transversal vai de -X a +X; caso contrário vai de -Z a +Z.
      const sideX = hasOppositeWE ? 1 : 0;
      const sideZ = hasOppositeWE ? 0 : 1;
      const alongX = hasOppositeWE ? 0 : 1;
      const alongZ = hasOppositeWE ? 1 : 0;
      const skew = (this.nextTrapId % 2 === 0 ? 1 : -1) * 0.2;

      const botA = new THREE.Vector3(
        -sideX * WALL_D + alongX * (0.28 + skew),
        0.03,
        -sideZ * WALL_D + alongZ * (0.28 + skew)
      );
      const botB = new THREE.Vector3(
        sideX * WALL_D + alongX * (0.28 - skew),
        0.03,
        sideZ * WALL_D + alongZ * (0.28 - skew)
      );
      const topA = new THREE.Vector3(
        -sideX * WALL_D + alongX * (-0.26 + skew),
        1.48,
        -sideZ * WALL_D + alongZ * (-0.26 + skew)
      );
      const topB = new THREE.Vector3(
        sideX * WALL_D + alongX * (-0.26 - skew),
        1.4,
        sideZ * WALL_D + alongZ * (-0.26 - skew)
      );

      group.add(buildAnchoredOrbQuad(botA, botB, topA, topB, this.orbWebMat));
      group.add(
        buildCatenarySilkGroup(
          topA,
          topB,
          0.18,
          0.01,
          this.silkSolidMat,
          4
        )
      );

      if (solidW) addVerifiedWallDrape(-1, 0, 1);
      if (solidE) addVerifiedWallDrape(1, 0, -1);
      if (solidN) addVerifiedWallDrape(0, -1, 1);
      if (solidS) addVerifiedWallDrape(0, 1, -1);
    } else {
      const solidWalls: Array<[number, number]> = [];
      if (solidN) solidWalls.push([0, -1]);
      if (solidS) solidWalls.push([0, 1]);
      if (solidW) solidWalls.push([-1, 0]);
      if (solidE) solidWalls.push([1, 0]);

      if (solidWalls.length === 2) {
        // ====================================================================
        // TOPOLOGIA 2: CURVA EM "L" (2 PAREDES ADJACENTES PERPENDICULARES REAIS)
        // Ancora a teia orbital DIAGONALMENTE da Parede A até a Parede B!
        // ====================================================================
        const [ax, az] = solidWalls[0];
        const [bx, bz] = solidWalls[1];

        const botA = new THREE.Vector3(
          ax * WALL_D - bx * 0.86,
          0.03,
          az * WALL_D - bz * 0.86
        );
        const botB = new THREE.Vector3(
          bx * WALL_D - ax * 0.86,
          0.03,
          bz * WALL_D - az * 0.86
        );
        const topA = new THREE.Vector3(
          ax * WALL_D - bx * 0.58,
          1.48,
          az * WALL_D - bz * 0.58
        );
        const topB = new THREE.Vector3(
          bx * WALL_D - ax * 0.58,
          1.4,
          bz * WALL_D - az * 0.58
        );

        group.add(buildAnchoredOrbQuad(botA, botB, topA, topB, this.orbWebMat));
        group.add(
          buildCatenarySilkGroup(
            topA,
            topB,
            0.16,
            0.01,
            this.silkSolidMat,
            4
          )
        );

        // Manto triangular suspenso bem na quina interna sólida onde Parede A e Parede B se encontram
        const innerCornerHigh = new THREE.Vector3(
          (ax + bx) * WALL_D,
          1.62,
          (az + bz) * WALL_D
        );
        group.add(
          buildAnchoredCornerSheet(
            innerCornerHigh,
            topA,
            topB,
            this.sheetWebMat
          )
        );

        addVerifiedWallDrape(ax, az, 1);
        addVerifiedWallDrape(bx, bz, -1);
      } else if (solidWalls.length === 1) {
        // ====================================================================
        // TOPOLOGIA 3: BIFURCAÇÃO EM "T" / BORDA DE SALA (APENAS 1 PAREDE REAL)
        // ZERO planos verticais soltos no ar! Ancora funis inclinados e cabos
        // exclusivamente entre a única parede sólida existente, o piso e o teto.
        // ====================================================================
        const [wxDir, wzDir] = solidWalls[0];
        const tx = -wzDir;
        const tz = wxDir;

        // Funil esquerdo: Parede Sólida -> Piso Sólido
        const originL = new THREE.Vector3(
          wxDir * WALL_D - tx * 0.76,
          0.025,
          wzDir * WALL_D - tz * 0.76
        );
        const wallTopL = new THREE.Vector3(
          wxDir * WALL_D - tx * 0.5,
          1.6,
          wzDir * WALL_D - tz * 0.5
        );
        const floorOutL = new THREE.Vector3(
          -wxDir * 0.58 + tx * 0.34,
          0.028,
          -wzDir * 0.58 + tz * 0.34
        );
        group.add(
          buildAnchoredCornerSheet(
            originL,
            wallTopL,
            floorOutL,
            this.sheetWebMat
          )
        );
        group.add(
          buildCatenarySilkGroup(
            wallTopL,
            floorOutL,
            0.14,
            0.01,
            this.silkSolidMat,
            4
          )
        );

        // Funil direito: Parede Sólida -> Piso Sólido
        const originR = new THREE.Vector3(
          wxDir * WALL_D + tx * 0.76,
          0.025,
          wzDir * WALL_D + tz * 0.76
        );
        const wallTopR = new THREE.Vector3(
          wxDir * WALL_D + tx * 0.5,
          1.52,
          wzDir * WALL_D + tz * 0.5
        );
        const floorOutR = new THREE.Vector3(
          -wxDir * 0.58 - tx * 0.34,
          0.028,
          -wzDir * 0.58 - tz * 0.34
        );
        group.add(
          buildAnchoredCornerSheet(
            originR,
            wallTopR,
            floorOutR,
            this.sheetWebMat
          )
        );
        group.add(
          buildCatenarySilkGroup(
            wallTopR,
            floorOutR,
            0.14,
            0.01,
            this.silkSolidMat,
            4
          )
        );

        // Cabo central inclinado da Parede Sólida até o manto do Piso + manto superior Parede-Teto
        const wallMidHigh = new THREE.Vector3(
          wxDir * WALL_D,
          1.76,
          wzDir * WALL_D
        );
        const floorMidOut = new THREE.Vector3(
          -wxDir * 0.74,
          0.03,
          -wzDir * 0.74
        );
        group.add(
          buildCatenarySilkGroup(
            wallMidHigh,
            floorMidOut,
            0.16,
            0.011,
            this.silkSolidMat,
            4
          )
        );

        group.add(
          buildAnchoredCornerSheet(
            new THREE.Vector3(wxDir * WALL_D, WALL_HEIGHT - 0.04, wzDir * WALL_D),
            new THREE.Vector3(wxDir * WALL_D, WALL_HEIGHT - 1.15, wzDir * WALL_D),
            new THREE.Vector3(-wxDir * 0.14, WALL_HEIGHT - 0.04, -wzDir * 0.14),
            this.sheetWebMat
          )
        );

        // Cabos baixos adicionais APENAS para quinas diagonais opostas realmente sólidas
        for (const diagSign of [-1, 1]) {
          const dx = -wxDir + tx * diagSign;
          const dz = -wzDir + tz * diagSign;
          if (isSolidCell(LABYRINTH_MAP, gx + dx, gz + dz)) {
            group.add(
              buildCatenarySilkGroup(
                new THREE.Vector3(
                  dx * (CELL_SIZE * 0.5 - 0.01),
                  0.92,
                  dz * (CELL_SIZE * 0.5 - 0.01)
                ),
                new THREE.Vector3(dx * 0.28, 0.03, dz * 0.28),
                0.09,
                0.009,
                this.silkSolidMat,
                3
              )
            );
          }
        }
      } else {
        // ====================================================================
        // TOPOLOGIA 4: CRUZAMENTO ABERTO DE 4 VIAS / CÂMARA SEM PAREDES CARDINAIS
        // Ancora exclusivamente nas quinas diagonais sólidas reais (±1.49, ±1.49)
        // e no piso/teto — JAMAIS nos vãos abertos!
        // ====================================================================
        const diagCorners: Array<[number, number]> = [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ];
        let anchoredAnyPillar = false;
        for (const [dx, dz] of diagCorners) {
          if (!isSolidCell(LABYRINTH_MAP, gx + dx, gz + dz)) continue;
          anchoredAnyPillar = true;
          const px = dx * (CELL_SIZE * 0.5 - 0.01);
          const pz = dz * (CELL_SIZE * 0.5 - 0.01);
          const originPillar = new THREE.Vector3(px, 0.025, pz);
          const pillarHigh = new THREE.Vector3(px, 1.38, pz);
          const floorHub = new THREE.Vector3(dx * 0.18, 0.028, dz * 0.18);

          group.add(
            buildAnchoredCornerSheet(
              originPillar,
              pillarHigh,
              floorHub,
              this.sheetWebMat
            )
          );
          group.add(
            buildCatenarySilkGroup(
              pillarHigh,
              floorHub,
              0.12,
              0.0095,
              this.silkSolidMat,
              3
            )
          );
        }

        if (!anchoredAnyPillar) {
          // Fallback puro teto -> piso caso nem pilares diagonais existam
          for (let k = 0; k < 3; k++) {
            const ang = (k / 3) * Math.PI * 2 + 0.4;
            group.add(
              buildCatenarySilkGroup(
                new THREE.Vector3(
                  Math.cos(ang) * 0.45,
                  WALL_HEIGHT - 0.04,
                  Math.sin(ang) * 0.45
                ),
                new THREE.Vector3(
                  Math.cos(ang + 0.6) * 0.72,
                  0.03,
                  Math.sin(ang + 0.6) * 0.72
                ),
                0.08,
                0.01,
                this.silkSolidMat,
                4
              )
            );
          }
        }
      }
    }

    const initScaleY = instant ? 1 : 0.08;
    // Escala apenas em Y durante a tecelagem para que as âncoras laterais já fiquem 100% cravadas nas paredes desde o frame 0!
    group.scale.set(1, initScaleY, 1);
    this.root.add(group);

    const trap: SpiderWebTrap = {
      id: this.nextTrapId++,
      position: new THREE.Vector3(cx, 0.05, cz),
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
        trap.group.scale.set(1, trap.weaveProgress, 1);
      }

      if (trap.weaveProgress < 0.75) continue;

      const dist = Math.hypot(
        playerPos.x - trap.position.x,
        playerPos.z - trap.position.z
      );
      if (dist < 1.05) {
        trap.triggered = true;
        trap.group.scale.set(1, 0.36, 1);
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
