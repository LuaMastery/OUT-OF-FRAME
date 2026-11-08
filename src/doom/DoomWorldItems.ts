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
 * (caixotes de suprimento abertos com ferragens, rolos de gaze, frascos apotecários,
 * baterias industriais 9V, canivete oxidado chanfrado, bastões de magnésio, chave antiga e pranchetas)
 * + Sinalizadores de Magnésio acesos no chão.
 */
export class DoomWorldItems {
  private readonly root = new THREE.Group();
  private readonly pickups: WorldPickupInstance[] = [];
  private readonly activeFlares: ActiveMagnesiumFlare[] = [];

  private readonly matCrateWood: THREE.ShaderMaterial;
  private readonly matDarkIron: THREE.ShaderMaterial;
  private readonly matGauze: THREE.ShaderMaterial;
  private readonly matRedCross: THREE.ShaderMaterial;
  private readonly matAmberGlass: THREE.ShaderMaterial;
  private readonly matCork: THREE.ShaderMaterial;
  private readonly matBattery: THREE.ShaderMaterial;
  private readonly matBrass: THREE.ShaderMaterial;
  private readonly matWoodGrip: THREE.ShaderMaterial;
  private readonly matSteelBlade: THREE.ShaderMaterial;
  private readonly matRustFuller: THREE.ShaderMaterial;
  private readonly matFlareRed: THREE.ShaderMaterial;
  private readonly matPaper: THREE.ShaderMaterial;
  private readonly matFlameOuter: THREE.MeshBasicMaterial;
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

    // 2. Ferro escuro rebitado para cantoneiras, alças e bases
    this.matDarkIron = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const grit = ((x * 5 + y * 13) % 7) - 3;
            const edge = x === 0 || y === 0 ? -12 : x === 1 || y === 1 ? 12 : 0;
            const v = 42 + grit * 2 + edge;
            px(x, y, v, v * 1.01, v * 1.06);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.5 }
    );

    // 3. Trama de algodão da atadura
    this.matGauze = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const weave = (x + y) % 2 === 0 ? 5 : -5;
            const seam = y % 6 === 0 ? -10 : 0;
            const v = 208 + weave + seam;
            px(x, y, v, v * 0.96, v * 0.87);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.08, doubleSided: true }
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

    // 4. Vidro apotecário âmbar translúcido + rótulo
    this.matAmberGlass = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const spec = x >= 4 && x <= 7 ? 38 : 0;
            const grit = ((x * 3 + y * 9) % 7) - 3;
            px(x, y, 148 + spec + grit * 2, 78 + spec * 0.7 + grit, 32 + spec * 0.3);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.09 }
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

    // 5. Célula industrial 9V (jaqueta preta/cobre com listra técnica)
    this.matBattery = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const grit = ((x * 9 + y * 5) % 7) - 3;
            if (y < 9) {
              px(x, y, 186 + grit * 2, 126 + grit * 2, 46 + grit);
            } else if (y === 9) {
              px(x, y, 22, 22, 24);
            } else {
              px(x, y, 42 + grit * 2, 47 + grit * 2, 55 + grit * 2);
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.62, emissiveBoost: 0.08 }
    );

    this.matBrass = createDoomPropMaterial(
      makeDetailedPixelTex(16, 16, (px) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const shine = x === 3 || x === 4 ? 26 : 0;
            const grit = ((x * 5 + y * 11) % 7) - 3;
            px(x, y, 192 + shine + grit * 2, 158 + shine * 0.8 + grit * 2, 82 + grit);
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.66, emissiveBoost: 0.09 }
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
              px(x, y, 174 + bevel + grit * 2, 182 + bevel + grit * 2, 194 + bevel + grit * 2);
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

    // 7. Corpo estriado vermelho do bastão de magnésio
    this.matFlareRed = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const stripe = y >= 10 && y <= 13;
            const rib = x % 4 === 0 ? -12 : 4;
            if (stripe) {
              px(x, y, 42 + rib * 0.5, 40 + rib * 0.5, 42 + rib * 0.5);
            } else {
              px(x, y, 186 + rib, 44 + rib * 0.3, 38 + rib * 0.3);
            }
          }
        }
      }),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.09 }
    );

    // 8. Página manuscrita manchada
    this.matPaper = createDoomPropMaterial(
      makeDetailedPixelTex(32, 32, (px) => {
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const inkLine =
              y >= 5 && y <= 25 && y % 4 === 0 && x >= 4 && x <= 26;
            const blood = x > 19 && y > 19 && (x - 24) * (x - 24) + (y - 24) * (y - 24) < 26;
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

    this.matFlameOuter = new THREE.MeshBasicMaterial({ color: 0xff5a1f });
    this.matFlameCore = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });

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
      // Logo no corredor inicial para o jogador já encontrar seu primeiro registro!
      { gx: 3, gz: 1, ox: 0.55, oz: -0.65, itemId: 'torn_log_04' },
      { gx: 6, gz: 1, ox: 0.6, oz: 0.55, itemId: 'industrial_battery' },
      { gx: 11, gz: 1, ox: 0.0, oz: -0.6, itemId: 'rusty_knife' },
      { gx: 1, gz: 3, ox: -0.55, oz: 0.45, itemId: 'sterile_bandage' },
      { gx: 12, gz: 5, ox: 0.45, oz: -0.55, itemId: 'magnesium_flare' },
      { gx: 6, gz: 6, ox: -0.35, oz: 0.45, itemId: 'old_morphine' },
      { gx: 4, gz: 9, ox: 0.0, oz: 0.55, itemId: 'magnesium_flare' },
      { gx: 9, gz: 11, ox: 0.4, oz: -0.55, itemId: 'arachnid_report_09' },
      { gx: 2, gz: 13, ox: -0.45, oz: 0.5, itemId: 'sterile_bandage' },
      { gx: 4, gz: 13, ox: 0.35, oz: -0.5, itemId: 'industrial_battery' },
      { gx: 10, gz: 13, ox: -0.3, oz: 0.5, itemId: 'old_morphine' },
      { gx: 12, gz: 13, ox: 0.5, oz: -0.45, itemId: 'sector_b_key' },
    ];

    placements.forEach((p, idx) => {
      const world = gridCellToWorld(p.gx, p.gz);
      const wx = world.x + p.ox;
      const wz = world.z + p.oz;

      const group = new THREE.Group();
      group.position.set(wx, 0, wz);

      // Caixote baixo de suprimentos esculpido com bordas, cantoneiras de ferro e tampa aberta
      const crate = this.buildSupplyCrate();
      crate.rotation.y = (idx * 0.7) % Math.PI;
      group.add(crate);

      const itemMesh = this.buildItemMesh(p.itemId);
      itemMesh.position.y = 0.165;
      itemMesh.rotation.y = idx * 1.15;
      group.add(itemMesh);

      this.root.add(group);
      this.pickups.push({
        id: `pickup-${idx}`,
        itemId: p.itemId,
        group,
        itemMesh,
        position: new THREE.Vector3(wx, 0.22, wz),
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

    // Forro escuro interno do estojo
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
      // Rolo espesso de gaze + miolo oco escuro + cinta médica carmim + ponta desenrolada + alfinete
      const outerRoll = new THREE.Mesh(
        new THREE.CylinderGeometry(0.098, 0.098, 0.135, 12),
        this.matGauze
      );
      outerRoll.position.y = 0.068;

      const innerHollow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.14, 10),
        this.matDarkIron
      );
      innerHollow.position.y = 0.068;

      const redBand = new THREE.Mesh(
        new THREE.CylinderGeometry(0.102, 0.102, 0.038, 12),
        this.matRedCross
      );
      redBand.position.y = 0.068;

      const looseTail = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.012, 0.095),
        this.matGauze
      );
      looseTail.position.set(0.11, 0.016, 0.02);
      looseTail.rotation.z = -0.18;
      looseTail.rotation.y = 0.25;

      const safetyPin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.065, 6),
        this.matSteelBlade
      );
      safetyPin.rotation.z = Math.PI * 0.5;
      safetyPin.position.set(0.02, 0.138, 0.04);

      holder.add(outerRoll, innerHollow, redBand, looseTail, safetyPin);
    } else if (itemId === 'old_morphine') {
      // Frasco apotecário octogonal âmbar + ombro cônico + gargalo + bocal + rolha + lacre + rótulo
      const baseRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.074, 0.078, 0.022, 8),
        this.matAmberGlass
      );
      baseRing.position.y = 0.011;

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.125, 8),
        this.matAmberGlass
      );
      body.position.y = 0.082;

      const shoulder = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.072, 0.042, 8),
        this.matAmberGlass
      );
      shoulder.position.y = 0.165;

      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.031, 0.036, 8),
        this.matAmberGlass
      );
      neck.position.y = 0.202;

      const lip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.034, 0.014, 8),
        this.matAmberGlass
      );
      lip.position.y = 0.224;

      const waxSeal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.035, 0.016, 8),
        this.matRedCross
      );
      waxSeal.position.y = 0.214;

      const cork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.027, 0.023, 0.038, 8),
        this.matCork
      );
      cork.position.y = 0.244;

      const label = new THREE.Mesh(
        new THREE.BoxGeometry(0.082, 0.075, 0.008),
        this.matPaper
      );
      label.position.set(0, 0.084, 0.071);

      holder.add(baseRing, body, shoulder, neck, lip, waxSeal, cork, label);
    } else if (itemId === 'industrial_battery') {
      // Célula industrial 9V com tampa frisada, isolador preto e polos positivo/negativo de latão
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.135, 0.165, 0.09),
        this.matBattery
      );
      body.position.y = 0.085;

      const bottomFlange = new THREE.Mesh(
        new THREE.BoxGeometry(0.145, 0.02, 0.098),
        this.matDarkIron
      );
      bottomFlange.position.y = 0.01;

      const topCrimp = new THREE.Mesh(
        new THREE.BoxGeometry(0.142, 0.018, 0.095),
        this.matBrass
      );
      topCrimp.position.y = 0.172;

      const insulator = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.014, 0.064),
        this.matDarkIron
      );
      insulator.position.y = 0.184;

      const posPost = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.018, 0.032, 8),
        this.matBrass
      );
      posPost.position.set(-0.032, 0.204, 0);

      const negCrown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.02, 0.03, 6),
        this.matBrass
      );
      negCrown.position.set(0.032, 0.203, 0);

      holder.add(body, bottomFlange, topCrimp, insulator, posPost, negCrown);
    } else if (itemId === 'rusty_knife') {
      // Canivete tático/oxidado esculpido: pomo com argola, talas de madeira com 3 rebites,
      // guarda/virola de latão, dorso espesso, sulco de sangue/ferrugem e ponta chanfrada clip-point!
      const knife = new THREE.Group();
      knife.position.y = 0.032;
      knife.rotation.x = 0.22;

      const pommel = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, 0.038, 0.046),
        this.matDarkIron
      );
      pommel.position.set(-0.145, 0, 0);

      const lanyardRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.016, 0.004, 6, 8),
        this.matBrass
      );
      lanyardRing.rotation.x = Math.PI * 0.5;
      lanyardRing.position.set(-0.17, 0, 0);

      const handleCore = new THREE.Mesh(
        new THREE.BoxGeometry(0.155, 0.036, 0.048),
        this.matWoodGrip
      );
      handleCore.position.set(-0.055, 0, 0);

      const handleSwell = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.042, 0.053),
        this.matWoodGrip
      );
      handleSwell.position.set(-0.055, 0, 0);

      for (const rx of [-0.105, -0.055, -0.008]) {
        const rivet = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0055, 0.0055, 0.046, 6),
          this.matBrass
        );
        rivet.position.set(rx, 0, 0);
        knife.add(rivet);
      }

      // Guarda / virola de latão maciço
      const bolster = new THREE.Mesh(
        new THREE.BoxGeometry(0.026, 0.046, 0.068),
        this.matBrass
      );
      bolster.position.set(0.032, 0, 0);

      // Lâmina principal de aço + fio iluminado + sulco oxidado + ponta aguda clip-point
      const bladeMain = new THREE.Mesh(
        new THREE.BoxGeometry(0.145, 0.01, 0.036),
        this.matSteelBlade
      );
      bladeMain.position.set(0.116, 0, 0.002);

      const bladeSpine = new THREE.Mesh(
        new THREE.BoxGeometry(0.145, 0.015, 0.01),
        this.matDarkIron
      );
      bladeSpine.position.set(0.116, 0, -0.015);

      const fuller = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.012, 0.009),
        this.matRustFuller
      );
      fuller.position.set(0.108, 0, -0.004);

      const bladeTip = new THREE.Mesh(
        new THREE.ConeGeometry(0.02, 0.068, 4),
        this.matSteelBlade
      );
      bladeTip.rotation.z = -Math.PI * 0.5;
      bladeTip.scale.set(1, 1, 0.34);
      bladeTip.position.set(0.218, 0, 0.002);

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
      // Bastão químico com anel octogonal anti-rolagem, punhos recartilhados, virola de latão e tampa riscadora
      const flare = new THREE.Group();
      flare.position.y = 0.038;

      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.031, 0.031, 0.27, 10),
        this.matFlareRed
      );
      body.rotation.z = Math.PI * 0.5;

      const hexStop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.044, 0.044, 0.024, 6),
        this.matDarkIron
      );
      hexStop.rotation.z = Math.PI * 0.5;
      hexStop.position.x = -0.115;

      for (const gx of [-0.065, -0.02]) {
        const gripBand = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.018, 10),
          this.matDarkIron
        );
        gripBand.rotation.z = Math.PI * 0.5;
        gripBand.position.x = gx;
        flare.add(gripBand);
      }

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.022, 10),
        this.matBrass
      );
      collar.rotation.z = Math.PI * 0.5;
      collar.position.x = 0.112;

      const strikerCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.037, 0.036, 0.042, 10),
        this.matDarkIron
      );
      strikerCap.rotation.z = Math.PI * 0.5;
      strikerCap.position.x = 0.142;

      const tipDot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.024, 0.008, 8),
        this.matRedCross
      );
      tipDot.rotation.z = Math.PI * 0.5;
      tipDot.position.x = 0.164;

      flare.add(body, hexStop, collar, strikerCap, tipDot);
      holder.add(flare);
    } else if (itemId === 'sector_b_key') {
      // Chave antiga trabalhada em latão + colar torneado + palhetas duplas + plaqueta gravada
      const key = new THREE.Group();
      key.position.y = 0.024;

      const bow = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.013, 8, 10),
        this.matBrass
      );
      bow.rotation.x = Math.PI * 0.5;
      bow.position.set(-0.085, 0, 0);

      const bowCross = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.014, 0.085),
        this.matBrass
      );
      bowCross.position.set(-0.085, 0, 0);

      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.024, 8),
        this.matBrass
      );
      collar.rotation.z = Math.PI * 0.5;
      collar.position.set(-0.024, 0, 0);

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.165, 8),
        this.matBrass
      );
      shaft.rotation.z = Math.PI * 0.5;
      shaft.position.set(0.062, 0, 0);

      const bitMain = new THREE.Mesh(
        new THREE.BoxGeometry(0.052, 0.014, 0.048),
        this.matBrass
      );
      bitMain.position.set(0.105, 0, 0.024);

      const bitNotch = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.016, 0.024),
        this.matDarkIron
      );
      bitNotch.position.set(0.105, 0, 0.038);

      const splitRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.022, 0.004, 6, 8),
        this.matSteelBlade
      );
      splitRing.rotation.x = Math.PI * 0.5;
      splitRing.position.set(-0.145, 0, 0.015);

      const keyTag = new THREE.Mesh(
        new THREE.BoxGeometry(0.068, 0.01, 0.042),
        this.matDarkIron
      );
      keyTag.position.set(-0.165, -0.002, 0.055);
      keyTag.rotation.y = 0.42;

      key.add(
        bow,
        bowCross,
        collar,
        shaft,
        bitMain,
        bitNotch,
        splitRing,
        keyTag
      );
      holder.add(key);
    } else {
      // Prancheta de campo metálica/madeira + folha de caderno arqueada com clipe de pressão
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.016, 0.33),
        this.matWoodGrip
      );
      board.position.y = 0.01;
      board.rotation.y = 0.18;

      const clipBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.026, 0.038),
        this.matSteelBlade
      );
      clipBase.position.set(-0.024, 0.026, -0.135);
      clipBase.rotation.y = 0.18;

      const pageLower = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.006, 0.16),
        this.matPaper
      );
      pageLower.position.set(0.012, 0.022, 0.055);
      pageLower.rotation.y = 0.18;
      pageLower.rotation.x = -0.06;

      const pageUpper = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.006, 0.14),
        this.matPaper
      );
      pageUpper.position.set(-0.012, 0.025, -0.075);
      pageUpper.rotation.y = 0.18;
      pageUpper.rotation.x = 0.05;

      holder.add(board, clipBase, pageLower, pageUpper);
    }

    return holder;
  }

  /**
   * Acende e solta um Sinalizador de Magnésio esculpido no piso diante do jogador,
   * iluminando o setor e afugentando a Aranha por ~16 segundos.
   */
  spawnLitFlare(pos: THREE.Vector3, yaw: number): void {
    const fx = pos.x - Math.sin(yaw) * 0.65;
    const fz = pos.z - Math.cos(yaw) * 0.65;

    const group = new THREE.Group();
    group.position.set(fx, 0.042, fz);

    const flareBody = new THREE.Group();
    flareBody.rotation.y = yaw + 0.5;

    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.26, 10),
      this.matFlareRed
    );
    stick.rotation.z = Math.PI * 0.5;
    flareBody.add(stick);

    const hexStop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.042, 0.022, 6),
      this.matDarkIron
    );
    hexStop.rotation.z = Math.PI * 0.5;
    hexStop.position.x = -0.105;
    flareBody.add(hexStop);

    const burnNozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.032, 0.025, 8),
      this.matBrass
    );
    burnNozzle.rotation.z = Math.PI * 0.5;
    burnNozzle.position.x = 0.125;
    flareBody.add(burnNozzle);

    // Tampa descartada ao lado no chão
    const droppedCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.038, 8),
      this.matDarkIron
    );
    droppedCap.rotation.z = 1.2;
    droppedCap.position.set(0.18, -0.015, 0.14);
    flareBody.add(droppedCap);

    group.add(flareBody);

    // Chama dupla intensa (núcleo incandescente branco + coroa rubra pulsante)
    const flameHolder = new THREE.Group();
    flameHolder.position.set(
      Math.cos(yaw + 0.5) * 0.15,
      0.045,
      -Math.sin(yaw + 0.5) * 0.15
    );

    const outerFlame = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.095, 0),
      this.matFlameOuter
    );
    outerFlame.scale.set(1.15, 1.45, 1.15);

    const innerCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.052, 0),
      this.matFlameCore
    );

    flameHolder.add(outerFlame, innerCore);
    group.add(flameHolder);

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

      // Leve respiração sutil para destacar o suprimento dentro do caixote aberto
      p.itemMesh.position.y = 0.165 + Math.sin(elapsed * 2.2 + i) * 0.01;

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
        (0.84 + 0.34 * Math.sin(elapsed * 29 + i * 3)) * lifeRatio;
      fl.flameMesh.scale.setScalar(Math.max(0.15, pulse));
      fl.flameMesh.rotation.y = elapsed * 9.5 + i;
    }
  }
}
