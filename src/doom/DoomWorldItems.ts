import * as THREE from 'three';
import { DoomInventory } from './DoomInventory';
import { gridCellToWorld } from './DoomMazeBuilder';
import { createDoomPropMaterial, DoomSharedUniforms } from './DoomShader';

interface WorldPickupInstance {
  id: string;
  itemId: string;
  group: THREE.Group;
  itemMesh: THREE.Object3D;
  position: THREE.Vector3;
  collected: boolean;
}

export interface ActiveMagnesiumFlare {
  position: THREE.Vector3;
  group: THREE.Group;
  flameMesh: THREE.Object3D;
  remainingSec: number;
  maxSec: number;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function makeDetailedPixelTex(
  w: number,
  h: number,
  draw: (
    px: (x: number, y: number, r: number, g: number, b: number) => void
  ) => void
): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  const px = (x: number, y: number, r: number, g: number, b: number) => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    const idx = ((h - 1 - wy) * w + wx) * 4;
    data[idx] = clamp255(r);
    data[idx + 1] = clamp255(g);
    data[idx + 2] = clamp255(b);
    data[idx + 3] = 255;
  };
  draw(px);
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Objetos 3D coletáveis esculpidos em múltiplas peças pelo labirinto
 * (apoiados fisicamente dentro dos caixotes abertos de suprimento, sem flutuar nem atravessar bordas)
 * + Sinalizadores de Magnésio acesos no chão.
 */
export class DoomWorldItems {
  private readonly root = new THREE.Group();
  private readonly pickups: WorldPickupInstance[] = [];
  private readonly activeFlares: ActiveMagnesiumFlare[] = [];

  private readonly matCrateWood: THREE.ShaderMaterial;
  private readonly matDarkIron: THREE.ShaderMaterial;
  private readonly matCleanSteel: THREE.ShaderMaterial;
  private readonly matGauze: THREE.ShaderMaterial;
  private readonly matGauzeSpiral: THREE.ShaderMaterial;
  private readonly matGauzeWrapper: THREE.ShaderMaterial;
  private readonly matRedCross: THREE.ShaderMaterial;
  private readonly matAmberGlass: THREE.ShaderMaterial;
  private readonly matApothecaryLabel: THREE.ShaderMaterial;
  private readonly matCork: THREE.ShaderMaterial;
  private readonly matBattery: THREE.ShaderMaterial;
  private readonly matBrass: THREE.ShaderMaterial;
  private readonly matKeyTag: THREE.ShaderMaterial;
  private readonly matWoodGrip: THREE.ShaderMaterial;
  private readonly matSteelBlade: THREE.ShaderMaterial;
  private readonly matRustFuller: THREE.ShaderMaterial;
  private readonly matFlareRed: THREE.ShaderMaterial;
  private readonly matPaper: THREE.ShaderMaterial;
  private readonly matFlameOuter: THREE.MeshBasicMaterial;
  private readonly matFlameMid: THREE.MeshBasicMaterial;
  private readonly matFlameCore: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, sharedUniforms: DoomSharedUniforms) {
    this.root.name = 'DoomWorldItems';
    scene.add(this.root);

    // 1. Madeira escura ripada para caixotes de suprimento
    this.matCrateWood = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          const plank = Math.floor(y / 8);
          const ly = y % 8;
          for (let x = 0; x < 32; x++) {
            const grit = ((x * 11 + y * 17) % 9) - 4;
            if (ly === 0) {
              px(x, y, 22, 18, 15);
              continue;
            }
            const grain = Math.sin((x + plank * 7) * 0.45) * 6;
            const v = 64 + grain + grit + (ly === 1 ? 10 : ly === 7 ? -10 : 0);
            px(x, y, v * 1.06, v * 0.82, v * 0.6);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.52 }
    );

    // 2. Ferro escuro rebitado para cantoneiras e bases
    this.matDarkIron = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const grit = ((x * 5 + y * 13) % 7) - 3;
            const edge = x === 0 || y === 0 ? -12 : x === 1 || y === 1 ? 12 : 0;
            const v = 40 + grit * 2 + edge;
            px(x, y, v, v * 1.01, v * 1.06);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.5, doubleSided: true }
    );

    // Aço escovado limpo (para grampos, argolas de chaveiro, etc., sem manchas de ferrugem)
    this.matCleanSteel = createDoomPropMaterial(
      makeDetailedPixelTex(16, 16, (px) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const sheen = x === 4 || x === 5 ? 24 : 0;
            const grit = ((x * 5 + y * 9) % 7) - 3;
            const v = 148 + sheen + grit * 2;
            px(x, y, v, v * 1.02, v * 1.06);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.08 }
    );

    // 3. Gaze médica: trama lateral + espiral concêntrica do topo + cinta de papel com cruz médica
    this.matGauze = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const weave = (x + y) % 2 === 0 ? 5 : -4;
            const thread = y % 5 === 0 ? -8 : 0;
            const v = 212 + weave + thread;
            px(x, y, v, v * 0.96, v * 0.88);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.08, doubleSided: true }
    );

    this.matGauzeSpiral = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const dx = x - 15.5;
            const dy = y - 15.5;
            const r = Math.hypot(dx, dy);
            const ang = Math.atan2(dy, dx);
            const spiral = Math.sin(r * 2.3 + ang) > 0.55 ? -20 : 4;
            const v = 204 + spiral;
            px(x, y, v, v * 0.96, v * 0.87);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.08, doubleSided: true }
    );

    this.matGauzeWrapper = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const border = y <= 1 || y >= 30;
            // Compensado pela circunferência 2πR vs altura 0.048m -> cruz '+' perfeitamente proporcional em 3D!
            const inCrossV = x === 16 && y >= 4 && y <= 27;
            const inCrossH = x >= 15 && x <= 17 && y >= 12 && y <= 19;
            // Segunda cruz no verso (x = 0) para ser visível de ambos os lados
            const inBackV = x === 0 && y >= 4 && y <= 27;
            const inBackH = (x <= 1 || x === 31) && y >= 12 && y <= 19;
            if (border || inCrossV || inCrossH || inBackV || inBackH) {
              px(x, y, 156, 34, 32);
            } else {
              const grit = ((x * 7 + y * 5) % 5) - 2;
              px(x, y, 224 + grit * 2, 214 + grit * 2, 194 + grit * 2);
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.66, emissiveBoost: 0.08, doubleSided: true }
    );

    this.matRedCross = createDoomPropMaterial(
      makeDetailedPixelTex(16, 16, (px) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const grit = ((x * 7 + y * 3) % 7) - 3;
            px(x, y, 152 + grit * 3, 34 + grit, 32 + grit);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.62, emissiveBoost: 0.08 }
    );

    // 4. Vidro apotecário âmbar rico (com nível escuro de láudano e reflexo vertical) + rótulo curvo dedicado
    this.matAmberGlass = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          const inLiquid = y >= 11;
          for (let x = 0; x < 32; x++) {
            const spec = x >= 5 && x <= 7 ? 52 : x === 24 ? 18 : 0;
            const meniscus = y === 11 ? 24 : 0;
            const grit = ((x * 3 + y * 9) % 5) - 2;
            const baseR = inLiquid ? 104 : 152;
            const baseG = inLiquid ? 48 : 82;
            const baseB = inLiquid ? 18 : 30;
            px(
              x,
              y,
              baseR + spec + meniscus + grit * 2,
              baseG + spec * 0.72 + meniscus * 0.5 + grit,
              baseB + spec * 0.38 + grit
            );
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.66, emissiveBoost: 0.1 }
    );

    this.matApothecaryLabel = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const outerFrame = x <= 1 || x >= 30 || y <= 1 || y >= 30;
            const innerFrame =
              (x === 3 || x === 28) && y >= 3 && y <= 28
                ? true
                : (y === 3 || y === 28) && x >= 3 && x <= 28;
            const redBanner = y >= 6 && y <= 10 && x >= 6 && x <= 25;
            const textLine =
              (y === 15 && x >= 7 && x <= 24) ||
              (y === 19 && x >= 8 && x <= 23) ||
              (y === 23 && x >= 10 && x <= 21);

            if (outerFrame) {
              px(x, y, 78, 64, 48);
            } else if (innerFrame) {
              px(x, y, 124, 96, 68);
            } else if (redBanner) {
              px(x, y, 138, 38, 34);
            } else if (textLine) {
              px(x, y, 64, 56, 46);
            } else {
              const age = ((x * 7 + y * 11) % 7) - 3;
              px(x, y, 222 + age * 2, 210 + age * 2, 184 + age * 2);
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.68, emissiveBoost: 0.09, doubleSided: true }
    );

    this.matCork = createDoomPropMaterial(
      makeDetailedPixelTex(16, 16, (px) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const pore = (x * 13 + y * 7) % 5 === 0 ? -18 : 4;
            px(x, y, 162 + pore, 128 + pore, 88 + pore);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.6, emissiveBoost: 0.06 }
    );

    // 5. Célula industrial 9V (faixa superior de cobre + corpo blindado escuro + polos + / - gravados)
    this.matBattery = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const grit = ((x * 9 + y * 5) % 7) - 3;
            const plusMark =
              (x === 8 && y >= 13 && y <= 17) ||
              (y === 15 && x >= 6 && x <= 10);
            const minusMark = y === 15 && x >= 21 && x <= 25;
            const bottomRule = y === 26 && x >= 6 && x <= 25;

            if (y < 9) {
              const shine = x >= 4 && x <= 7 ? 24 : 0;
              px(
                x,
                y,
                192 + shine + grit * 2,
                132 + shine * 0.7 + grit * 2,
                52 + grit
              );
            } else if (y === 9) {
              px(x, y, 18, 19, 22);
            } else if (plusMark || minusMark) {
              px(x, y, 214, 204, 182);
            } else if (bottomRule) {
              px(x, y, 96, 90, 78);
            } else {
              const seam = x === 0 || x === 31 ? -10 : x === 3 ? 10 : 0;
              px(
                x,
                y,
                40 + seam + grit * 2,
                44 + seam + grit * 2,
                52 + seam + grit * 2
              );
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.08 }
    );

    this.matBrass = createDoomPropMaterial(
      makeDetailedPixelTex(16, 16, (px) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const shine = x === 3 || x === 4 ? 28 : 0;
            const grit = ((x * 5 + y * 11) % 7) - 3;
            px(
              x,
              y,
              196 + shine + grit * 2,
              162 + shine * 0.8 + grit * 2,
              84 + grit
            );
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.66, emissiveBoost: 0.09, doubleSided: true }
    );

    // Plaqueta metálica gravada da Chave da Ala B
    this.matKeyTag = createDoomPropMaterial(
      makeDetailedPixelTex(16, 16, (px) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const border = x === 0 || x === 15 || y === 0 || y === 15;
            const stamp = y >= 6 && y <= 9 && x >= 4 && x <= 11 && (x + y) % 2 === 0;
            if (border) {
              px(x, y, 62, 56, 46);
            } else if (stamp) {
              px(x, y, 42, 38, 32);
            } else {
              px(x, y, 134, 124, 104);
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.08 }
    );

    // 6. Cabo de madeira nobre e lâmina de aço oxidado para o canivete
    this.matWoodGrip = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const grain = Math.sin(x * 0.55 + y * 0.2) * 10;
            px(x, y, 92 + grain, 62 + grain * 0.7, 42 + grain * 0.5);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.6, emissiveBoost: 0.07 }
    );

    this.matSteelBlade = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const rustSpot = (x * 17 + y * 23) % 19 === 0;
            if (rustSpot) {
              px(x, y, 118, 62, 40);
            } else {
              const bevel = y > 22 ? 32 : 0;
              const grit = ((x * 7 + y * 11) % 7) - 3;
              px(
                x,
                y,
                174 + bevel + grit * 2,
                182 + bevel + grit * 2,
                194 + bevel + grit * 2
              );
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.66, emissiveBoost: 0.1 }
    );

    this.matRustFuller = createDoomPropMaterial(
      makeDetailedPixelTex(16, 16, (px) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const grit = ((x * 9 + y * 7) % 7) - 3;
            px(x, y, 98 + grit * 2, 52 + grit, 38 + grit);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.56, emissiveBoost: 0.06 }
    );

    // 7. Corpo encerado vermelho do bastão de magnésio com rótulo técnico creme/escuro próximo à ponta
    this.matFlareRed = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const rib = x % 4 === 0 ? -10 : x % 4 === 2 ? 6 : 0;
            if (y >= 5 && y <= 9) {
              const hazard = (x + y) % 4 < 2;
              if (y === 5 || y === 9) {
                px(x, y, 36, 34, 34);
              } else if (hazard) {
                px(x, y, 214, 192, 132);
              } else {
                px(x, y, 52, 46, 44);
              }
            } else {
              px(x, y, 188 + rib, 44 + rib * 0.3, 38 + rib * 0.3);
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.09 }
    );

    // 8. Página manuscrita manchada (folha única contínua sobre a prancheta)
    this.matPaper = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const inkLine =
              y >= 5 && y <= 25 && y % 4 === 0 && x >= 4 && x <= 26;
            const blood =
              x > 20 &&
              y > 20 &&
              (x - 25) * (x - 25) + (y - 25) * (y - 25) < 18;
            if (blood) {
              px(x, y, 118, 28, 26);
            } else if (inkLine && (x * 7 + y) % 5 !== 0) {
              px(x, y, 68, 60, 50);
            } else {
              const grit = ((x * 5 + y * 9) % 7) - 3;
              px(x, y, 214 + grit * 2, 202 + grit * 2, 178 + grit * 2);
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.68, emissiveBoost: 0.1, doubleSided: true }
    );

    this.matFlameOuter = new THREE.MeshBasicMaterial({
      color: 0xff541c,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.matFlameMid = new THREE.MeshBasicMaterial({
      color: 0xffb84d,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.matFlameCore = new THREE.MeshBasicMaterial({ color: 0xfff8dc });

    this.populateLabyrinthItems();
  }

  private populateLabyrinthItems(): void {
    const placements: Array<{
      gx: number;
      gz: number;
      ox: number;
      oz: number;
      itemId: string;
    }> = [
      // 1. Setor Noroeste — Corredor de Chegada & Enfermaria Médica
      { gx: 3, gz: 1, ox: 0.35, oz: -0.58, itemId: 'torn_log_04' },
      { gx: 6, gz: 1, ox: 0.45, oz: -0.58, itemId: 'industrial_battery' },
      { gx: 5, gz: 3, ox: -0.52, oz: -0.52, itemId: 'sterile_bandage' },
      { gx: 9, gz: 5, ox: 0.52, oz: 0.52, itemId: 'old_morphine' },
      { gx: 1, gz: 7, ox: -0.55, oz: 0.35, itemId: 'magnesium_flare' },

      // 2. Ponte de Comando Norte & Galeria Central
      { gx: 11, gz: 1, ox: 0.0, oz: -0.58, itemId: 'rusty_knife' },
      { gx: 13, gz: 7, ox: -0.45, oz: 0.52, itemId: 'industrial_battery' },
      { gx: 11, gz: 9, ox: -0.52, oz: -0.52, itemId: 'sterile_bandage' },
      { gx: 17, gz: 13, ox: 0.52, oz: 0.52, itemId: 'magnesium_flare' },

      // 3. Setor Nordeste — Salão dos Reatores & Passarela Leste
      { gx: 19, gz: 3, ox: -0.52, oz: -0.52, itemId: 'industrial_battery' },
      { gx: 24, gz: 5, ox: 0.48, oz: -0.42, itemId: 'magnesium_flare' },
      { gx: 27, gz: 5, ox: 0.55, oz: 0.0, itemId: 'old_morphine' },

      // 4. Alas Laterais — Logística Oeste & Subestação de Munições Leste
      { gx: 3, gz: 9, ox: 0.0, oz: -0.56, itemId: 'industrial_battery' },
      { gx: 3, gz: 15, ox: -0.42, oz: 0.54, itemId: 'sterile_bandage' },
      { gx: 25, gz: 9, ox: 0.52, oz: -0.48, itemId: 'magnesium_flare' },
      { gx: 25, gz: 15, ox: 0.45, oz: 0.54, itemId: 'industrial_battery' },

      // 5. Divisória Blindada & Minas de Escavação Sudoeste
      { gx: 15, gz: 17, ox: 0.42, oz: -0.52, itemId: 'sterile_bandage' },
      { gx: 3, gz: 17, ox: -0.48, oz: -0.52, itemId: 'industrial_battery' },
      { gx: 6, gz: 21, ox: 0.0, oz: 0.54, itemId: 'old_morphine' },
      { gx: 3, gz: 25, ox: -0.48, oz: 0.52, itemId: 'magnesium_flare' },

      // 6. Catacumbas Centrais, Santuário do Ninho & Cripta Abobadada Ala B (Sudeste)
      { gx: 10, gz: 23, ox: -0.38, oz: -0.54, itemId: 'arachnid_report_09' },
      { gx: 14, gz: 26, ox: 0.45, oz: 0.38, itemId: 'sterile_bandage' },
      { gx: 23, gz: 17, ox: 0.0, oz: -0.55, itemId: 'industrial_battery' },
      { gx: 25, gz: 26, ox: 0.48, oz: -0.48, itemId: 'sector_b_key' },
    ];

    placements.forEach((p, idx) => {
      const world = gridCellToWorld(p.gx, p.gz);
      const wx = world.x + p.ox;
      const wz = world.z + p.oz;

      const group = new THREE.Group();
      group.position.set(wx, 0, wz);

      // Caixote baixo de suprimentos esculpido voltado para o centro livre do corredor
      const crate = this.buildSupplyCrate();
      crate.rotation.y = Math.atan2(-p.ox, -p.oz + 0.01);
      group.add(crate);

      // Apoiado FISICAMENTE sobre o forro interno do caixote (y = 0.095), alinhado à bandeja sem flutuar nem atravessar paredes!
      const itemMesh = this.buildItemMesh(p.itemId);
      itemMesh.position.set(0, 0.095, 0.01);
      itemMesh.rotation.y = ((idx % 3) - 1) * 0.14;
      crate.add(itemMesh);

      this.root.add(group);
      this.pickups.push({
        id: `pickup-${idx}`,
        itemId: p.itemId,
        group,
        itemMesh,
        position: new THREE.Vector3(wx, 0.18, wz),
        collected: false,
      });
    });
  }

  /**
   * Constrói um caixote/estojo de campo aberto em 3D (fundo, 4 paredes de borda,
   * 4 cantoneiras rebitadas de ferro, alças laterais e tampa ripada apoiada atrás).
   */
  private buildSupplyCrate(): THREE.Group {
    const crate = new THREE.Group();

    // Base de tábuas
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.08, 0.42),
      this.matCrateWood
    );
    base.position.y = 0.04;
    crate.add(base);

    // Pés/trilhos inferiores de ferro
    for (const sx of [-0.2, 0.2]) {
      const skid = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.03, 0.44),
        this.matDarkIron
      );
      skid.position.set(sx, 0.015, 0);
      crate.add(skid);
    }

    // 4 bordas elevadas formando bandeja interna côncava
    const rimFront = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.085, 0.045),
      this.matCrateWood
    );
    rimFront.position.set(0, 0.115, 0.188);
    const rimBack = rimFront.clone();
    rimBack.position.z = -0.188;
    const rimLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.085, 0.34),
      this.matCrateWood
    );
    rimLeft.position.set(-0.238, 0.115, 0);
    const rimRight = rimLeft.clone();
    rimRight.position.x = 0.238;
    crate.add(rimFront, rimBack, rimLeft, rimRight);

    // Forro escuro interno do estojo (superfície superior em y = 0.094)
    const liner = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.018, 0.32),
      this.matDarkIron
    );
    liner.position.y = 0.085;
    crate.add(liner);

    // 4 cantoneiras de ferro fundido nos cantos
    for (const cx of [-0.245, 0.245]) {
      for (const cz of [-0.195, 0.195]) {
        const bracket = new THREE.Mesh(
          new THREE.BoxGeometry(0.065, 0.15, 0.065),
          this.matDarkIron
        );
        bracket.position.set(cx, 0.085, cz);
        crate.add(bracket);
      }
    }

    // Alças metálicas nas laterais
    for (const sx of [-0.27, 0.27]) {
      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.03, 0.14),
        this.matBrass
      );
      handle.position.set(sx, 0.1, 0);
      crate.add(handle);
    }

    // Tampa ripada entreaberta apoiada na borda traseira
    const openLid = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.03, 0.22),
      this.matCrateWood
    );
    openLid.position.set(0, 0.21, -0.24);
    openLid.rotation.x = -0.98;
    crate.add(openLid);

    return crate;
  }

  private buildItemMesh(itemId: string): THREE.Object3D {
    const holder = new THREE.Group();

    if (itemId === 'sterile_bandage') {
      // Rolo de gaze estéril com cavidade central oca REAL, espiral visível no topo,
      // cinta de papel médico com cruz vermelha nítida e aba curta pousada dentro do caixote
      const outerWall = new THREE.Mesh(
        new THREE.CylinderGeometry(0.076, 0.076, 0.106, 16, 1, true),
        this.matGauze
      );
      outerWall.position.y = 0.053;

      const innerTube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.106, 12, 1, true),
        this.matDarkIron
      );
      innerTube.position.y = 0.053;

      const topRing = new THREE.Mesh(
        new THREE.RingGeometry(0.025, 0.076, 16, 2),
        this.matGauzeSpiral
      );
      topRing.rotation.x = -Math.PI * 0.5;
      topRing.position.y = 0.106;

      const bottomRing = new THREE.Mesh(
        new THREE.RingGeometry(0.025, 0.076, 16, 1),
        this.matGauzeSpiral
      );
      bottomRing.rotation.x = Math.PI * 0.5;
      bottomRing.position.y = 0.001;

      // Cinta de papel médico envolvendo o centro com cruz carmim nítida na frente
      const wrapperBand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0785, 0.0785, 0.048, 16, 1, true),
        this.matGauzeWrapper
      );
      wrapperBand.position.y = 0.053;
      wrapperBand.rotation.y = Math.PI;

      // Aba curta da gaze pousada naturalmente sobre o fundo do caixote (sem atravessar bordas!)
      const tailSlope = new THREE.Mesh(
        new THREE.BoxGeometry(0.036, 0.005, 0.074),
        this.matGauze
      );
      tailSlope.position.set(0.084, 0.014, 0.008);
      tailSlope.rotation.z = -0.38;

      const tailFlat = new THREE.Mesh(
        new THREE.BoxGeometry(0.046, 0.004, 0.072),
        this.matGauze
      );
      tailFlat.position.set(0.116, 0.004, 0.01);
      tailFlat.rotation.y = 0.12;

      holder.add(
        outerWall,
        innerTube,
        topRing,
        bottomRing,
        wrapperBand,
        tailSlope,
        tailFlat
      );
    } else if (itemId === 'old_morphine') {
      // Frasco apotecário âmbar de 12 facetas suaves + rótulo curvo CONFORME (zero bordas soltas no ar!) + rolha
      const baseRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.056, 0.059, 0.014, 12),
        this.matAmberGlass
      );
      baseRing.position.y = 0.007;

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.056, 0.098, 12),
        this.matAmberGlass
      );
      body.position.y = 0.063;

      const shoulder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.023, 0.055, 0.032, 12),
        this.matAmberGlass
      );
      shoulder.position.y = 0.128;

      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.022, 0.026, 12),
        this.matAmberGlass
      );
      neck.position.y = 0.157;

      const lip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.026, 0.024, 0.009, 12),
        this.matAmberGlass
      );
      lip.position.y = 0.174;

      const cork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.019, 0.015, 0.026, 10),
        this.matCork
      );
      cork.position.y = 0.189;

      // Rótulo cilíndrico curvo abraçando perfeitamente a parede do frasco sem descolar nas laterais!
      const curvedLabel = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.057,
          0.058,
          0.058,
          10,
          1,
          true,
          -0.66,
          1.32
        ),
        this.matApothecaryLabel
      );
      curvedLabel.position.y = 0.062;

      holder.add(baseRing, body, shoulder, neck, lip, cork, curvedLabel);
    } else if (itemId === 'industrial_battery') {
      // Bateria industrial 9V com topo frisado rente (sem degrau exagerado) e polos + / - distintos
      const bottomFlange = new THREE.Mesh(
        new THREE.BoxGeometry(0.122, 0.008, 0.082),
        this.matDarkIron
      );
      bottomFlange.position.y = 0.004;

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.118, 0.142, 0.078),
        this.matBattery
      );
      body.position.y = 0.079;

      // Aro superior frisado rente ao corpo
      const topBezel = new THREE.Mesh(
        new THREE.BoxGeometry(0.118, 0.007, 0.078),
        this.matDarkIron
      );
      topBezel.position.y = 0.1535;

      // Placa isolante preta levemente recuada onde ficam os terminais
      const insulator = new THREE.Mesh(
        new THREE.BoxGeometry(0.102, 0.007, 0.062),
        this.matDarkIron
      );
      insulator.position.y = 0.159;

      // Polo Positivo (+): pino cilíndrico compacto de encaixe macho
      const posWasher = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.013, 0.004, 8),
        this.matBrass
      );
      posWasher.position.set(-0.029, 0.164, 0);

      const posStud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0095, 0.0085, 0.016, 8),
        this.matBrass
      );
      posStud.position.set(-0.029, 0.173, 0);

      // Polo Negativo (-): coroa sextavada oca de encaixe fêmea (distinta do polo +!)
      const negOuterCrown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0165, 0.0135, 0.017, 6, 1, true),
        this.matBrass
      );
      negOuterCrown.position.set(0.029, 0.171, 0);

      const negBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0135, 0.0135, 0.004, 6),
        this.matDarkIron
      );
      negBase.position.set(0.029, 0.164, 0);

      holder.add(
        bottomFlange,
        body,
        topBezel,
        insulator,
        posWasher,
        posStud,
        negOuterCrown,
        negBase
      );
    } else if (itemId === 'rusty_knife') {
      // Canivete oxidado pousado sobre o fundo do caixote
      const knife = new THREE.Group();
      knife.position.y = 0.024;
      knife.rotation.x = 0.22;

      const pommel = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.034, 0.042),
        this.matDarkIron
      );
      pommel.position.set(-0.135, 0, 0);

      const lanyardRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.014, 0.0035, 6, 8),
        this.matBrass
      );
      lanyardRing.rotation.x = Math.PI * 0.5;
      lanyardRing.position.set(-0.158, 0, 0);

      const handleCore = new THREE.Mesh(
        new THREE.BoxGeometry(0.145, 0.032, 0.044),
        this.matWoodGrip
      );
      handleCore.position.set(-0.05, 0, 0);

      const handleSwell = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.038, 0.048),
        this.matWoodGrip
      );
      handleSwell.position.set(-0.05, 0, 0);

      for (const rx of [-0.098, -0.05, -0.005]) {
        const rivet = new THREE.Mesh(
          new THREE.CylinderGeometry(0.005, 0.005, 0.042, 6),
          this.matBrass
        );
        rivet.position.set(rx, 0, 0);
        knife.add(rivet);
      }

      const bolster = new THREE.Mesh(
        new THREE.BoxGeometry(0.024, 0.042, 0.062),
        this.matBrass
      );
      bolster.position.set(0.032, 0, 0);

      const bladeMain = new THREE.Mesh(
        new THREE.BoxGeometry(0.135, 0.009, 0.034),
        this.matSteelBlade
      );
      bladeMain.position.set(0.108, 0, 0.002);

      const bladeSpine = new THREE.Mesh(
        new THREE.BoxGeometry(0.135, 0.013, 0.009),
        this.matDarkIron
      );
      bladeSpine.position.set(0.108, 0, -0.014);

      const fuller = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.011, 0.008),
        this.matRustFuller
      );
      fuller.position.set(0.1, 0, -0.004);

      const bladeTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.019, 0.062, 4),
        this.matSteelBlade
      );
      bladeTip.rotation.z = -Math.PI * 0.5;
      bladeTip.scale.set(1, 1, 0.34);
      bladeTip.position.set(0.204, 0, 0.002);

      knife.add(
        pommel,
        lanyardRing,
        handleCore,
        handleSwell,
        bolster,
        bladeMain,
        bladeSpine,
        fuller,
        bladeTip
      );
      holder.add(knife);
    } else if (itemId === 'magnesium_flare') {
      // Bastão químico de magnésio pousado sobre o fundo do caixote (sem atravessar a tampa!)
      const flare = new THREE.Group();
      flare.position.y = 0.034;

      // Tampão octogonal anti-rolagem na base esquerda (cobre a extremidade sem sobra vermelha!)
      const hexBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.034, 0.032, 0.026, 8),
        this.matDarkIron
      );
      hexBase.rotation.z = Math.PI * 0.5;
      hexBase.position.x = -0.116;

      // Punho recartilhado escuro junto à base
      const gripSleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0285, 0.0285, 0.048, 12),
        this.matDarkIron
      );
      gripSleeve.rotation.z = Math.PI * 0.5;
      gripSleeve.position.x = -0.08;

      // Tubo encerado carmim com faixa de aviso próxima ao bocal
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0265, 0.0265, 0.215, 12),
        this.matFlareRed
      );
      body.rotation.z = Math.PI * 0.5;
      body.position.x = 0.004;

      // Virola de latão do bocal de ignição
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0285, 0.0285, 0.016, 12),
        this.matBrass
      );
      collar.rotation.z = Math.PI * 0.5;
      collar.position.x = 0.106;

      // Tampa protetora riscadora de fósforo
      const strikerCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0305, 0.0295, 0.032, 12),
        this.matDarkIron
      );
      strikerCap.rotation.z = Math.PI * 0.5;
      strikerCap.position.x = 0.128;

      const strikerHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.006, 10),
        this.matRedCross
      );
      strikerHead.rotation.z = Math.PI * 0.5;
      strikerHead.position.x = 0.146;

      flare.add(hexBase, gripSleeve, body, collar, strikerCap, strikerHead);
      holder.add(flare);
    } else if (itemId === 'sector_b_key') {
      // Chave antiga de latão maciço com dentes recortados REAIS (sem bloco cinza sobreposto!) e etiqueta
      const key = new THREE.Group();
      key.position.y = 0.012;

      // Argola oval ornamentada (sem barra cortando o furo ao meio)
      const bow = new THREE.Mesh(
        new THREE.TorusGeometry(0.042, 0.01, 8, 12),
        this.matBrass
      );
      bow.rotation.x = Math.PI * 0.5;
      bow.scale.set(1.05, 0.86, 1.0);
      bow.position.set(-0.082, 0, 0);

      for (const sz of [-0.036, 0.036]) {
        const boss = new THREE.Mesh(
          new THREE.SphereGeometry(0.011, 6, 6),
          this.matBrass
        );
        boss.position.set(-0.082, 0, sz);
        key.add(boss);
      }

      // Colar duplo torneado
      const collar1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0155, 0.0155, 0.014, 10),
        this.matBrass
      );
      collar1.rotation.z = Math.PI * 0.5;
      collar1.position.set(-0.032, 0, 0);

      const collar2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0125, 0.0125, 0.01, 10),
        this.matBrass
      );
      collar2.rotation.z = Math.PI * 0.5;
      collar2.position.set(-0.02, 0, 0);

      // Haste cilíndrica + ponta arredondada
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0085, 0.0085, 0.155, 8),
        this.matBrass
      );
      shaft.rotation.z = Math.PI * 0.5;
      shaft.position.set(0.058, 0, 0);

      // Dentes/segredos recortados em latão real (com vãos abertos de verdade!)
      const bitBridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.052, 0.01, 0.012),
        this.matBrass
      );
      bitBridge.position.set(0.1, 0, 0.012);

      const tooth1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.01, 0.032),
        this.matBrass
      );
      tooth1.position.set(0.08, 0, 0.026);

      const tooth2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.01, 0.02),
        this.matBrass
      );
      tooth2.position.set(0.1, 0, 0.02);

      const tooth3 = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.01, 0.036),
        this.matBrass
      );
      tooth3.position.set(0.119, 0, 0.028);

      // Argola metálica inclinada passando pelo olhal + plaqueta gravada pousada no fundo
      const splitRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.016, 0.0032, 6, 10),
        this.matCleanSteel
      );
      splitRing.rotation.set(1.05, 0.42, 0);
      splitRing.position.set(-0.132, 0.004, 0.008);

      const keyTag = new THREE.Mesh(
        new THREE.BoxGeometry(0.056, 0.006, 0.032),
        this.matKeyTag
      );
      keyTag.position.set(-0.152, -0.005, 0.034);
      keyTag.rotation.y = 0.48;

      key.add(
        bow,
        collar1,
        collar2,
        shaft,
        bitBridge,
        tooth1,
        tooth2,
        tooth3,
        splitRing,
        keyTag
      );
      holder.add(key);
    } else {
      // Prancheta de campo cabendo folgadamente dentro da bandeja do caixote + folha única (sem duplicar mancha!)
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.27, 0.012, 0.2),
        this.matWoodGrip
      );
      board.position.y = 0.006;

      const clipBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.028, 0.02, 0.088),
        this.matCleanSteel
      );
      clipBase.position.set(-0.118, 0.018, 0);

      const pageSheet = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.005, 0.165),
        this.matPaper
      );
      pageSheet.position.set(0.012, 0.015, 0.004);
      pageSheet.rotation.y = 0.04;

      holder.add(board, clipBase, pageSheet);
    }

    return holder;
  }

  /**
   * Acende e solta um Sinalizador de Magnésio esculpido no piso diante do jogador,
   * com jato incandescente em camadas preso diretamente ao bocal (sem cubo vermelho opaco gigante!).
   */
  spawnLitFlare(pos: THREE.Vector3, yaw: number): void {
    const fx = pos.x - Math.sin(yaw) * 0.65;
    const fz = pos.z - Math.cos(yaw) * 0.65;

    const group = new THREE.Group();
    group.position.set(fx, 0, fz);

    const flareBody = new THREE.Group();
    flareBody.position.y = 0.034;
    flareBody.rotation.y = yaw + 0.5;
    flareBody.rotation.z = 0.05;

    const hexStop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.032, 0.026, 8),
      this.matDarkIron
    );
    hexStop.rotation.z = Math.PI * 0.5;
    hexStop.position.x = -0.114;
    flareBody.add(hexStop);

    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.22, 12),
      this.matFlareRed
    );
    stick.rotation.z = Math.PI * 0.5;
    flareBody.add(stick);

    const burnNozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.027, 0.022, 10),
      this.matBrass
    );
    burnNozzle.rotation.z = Math.PI * 0.5;
    burnNozzle.position.x = 0.114;
    flareBody.add(burnNozzle);

    // Jato incandescente de magnésio preso diretamente à boca do sinalizador
    const flameHolder = new THREE.Group();
    flameHolder.position.set(0.128, 0, 0);

    const slagTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.019, 8, 6),
      this.matFlameCore
    );
    slagTip.position.x = -0.004;

    const innerJet = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.078, 8),
      this.matFlameCore
    );
    innerJet.rotation.z = -Math.PI * 0.5;
    innerJet.position.x = 0.034;

    const midJet = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.115, 8),
      this.matFlameMid
    );
    midJet.rotation.z = -Math.PI * 0.5;
    midJet.position.x = 0.048;

    const outerPlume = new THREE.Mesh(
      new THREE.ConeGeometry(0.042, 0.15, 8),
      this.matFlameOuter
    );
    outerPlume.rotation.z = -Math.PI * 0.5;
    outerPlume.position.x = 0.062;

    flameHolder.add(outerPlume, midJet, innerJet, slagTip);
    for (let s = 0; s < 3; s++) {
      const ang = (s / 3) * Math.PI * 2;
      const spark = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.008, 0),
        this.matFlameCore
      );
      spark.position.set(
        0.075 + s * 0.022,
        Math.sin(ang) * 0.022,
        Math.cos(ang) * 0.022
      );
      flameHolder.add(spark);
    }

    flareBody.add(flameHolder);
    group.add(flareBody);

    // Tampa descartada pousada sobre o piso ao lado (sem atravessar o chão!)
    const droppedCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.029, 0.032, 10),
      this.matDarkIron
    );
    droppedCap.rotation.set(0.3, yaw - 0.4, Math.PI * 0.5);
    droppedCap.position.set(
      Math.cos(yaw + 1.2) * 0.16,
      0.029,
      -Math.sin(yaw + 1.2) * 0.16
    );
    group.add(droppedCap);

    this.root.add(group);
    this.activeFlares.push({
      position: new THREE.Vector3(fx, 0.35, fz),
      group,
      flameMesh: flameHolder,
      remainingSec: 16.0,
      maxSec: 16.0,
    });
  }

  getActiveFlares(): readonly ActiveMagnesiumFlare[] {
    return this.activeFlares;
  }

  /**
   * Tenta pegar um objeto próximo (automaticamente ao encostar a <1.02m
   * ou intencionalmente ao pressionar E / clicar olhando até <2.4m).
   */
  updateAndCheckPickups(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    cameraPos: THREE.Vector3,
    cameraForward: THREE.Vector3,
    interactPressed: boolean,
    inventory: DoomInventory
  ): void {
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      if (p.collected) continue;

      const dx = p.position.x - playerPos.x;
      const dz = p.position.z - playerPos.z;
      const flatDist = Math.hypot(dx, dz);

      let shouldCollect = flatDist < 1.02;

      if (!shouldCollect && interactPressed && flatDist < 2.4) {
        const toItem = new THREE.Vector3()
          .subVectors(p.position, cameraPos)
          .normalize();
        if (toItem.dot(cameraForward) > 0.72) {
          shouldCollect = true;
        }
      }

      if (shouldCollect) {
        if (inventory.addItem(p.itemId, 1, false)) {
          p.collected = true;
          p.itemMesh.visible = false;
        }
      }
    }

    // Atualiza sinalizadores de magnésio acesos no chão
    for (let i = this.activeFlares.length - 1; i >= 0; i--) {
      const fl = this.activeFlares[i];
      fl.remainingSec -= dt;
      if (fl.remainingSec <= 0) {
        fl.flameMesh.visible = false;
        this.activeFlares.splice(i, 1);
        continue;
      }
      const lifeRatio = Math.min(1, fl.remainingSec / 2.5);
      const pulse =
        (0.86 + 0.26 * Math.sin(elapsed * 31 + i * 3)) * lifeRatio;
      fl.flameMesh.scale.set(
        Math.max(0.2, pulse),
        Math.max(0.2, 0.88 + 0.18 * Math.cos(elapsed * 37 + i)),
        Math.max(0.2, 0.88 + 0.18 * Math.sin(elapsed * 41 + i))
      );
      fl.flameMesh.rotation.x = elapsed * 11 + i;
    }
  }
}
