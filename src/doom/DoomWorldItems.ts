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
  flameMesh: THREE.Mesh;
  remainingSec: number;
  maxSec: number;
}

function makeSolidPixelTex(
  r: number,
  g: number,
  b: number,
  stripe?: [number, number, number]
): THREE.DataTexture {
  const w = 16;
  const h = 16;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const useStripe = stripe && y >= 6 && y <= 9;
      const grit = ((x * 7 + y * 13) % 9) - 4;
      const cr = (useStripe ? stripe[0] : r) + grit * 2;
      const cg = (useStripe ? stripe[1] : g) + grit * 2;
      const cb = (useStripe ? stripe[2] : b) + grit * 2;
      data[idx] = Math.max(0, Math.min(255, cr));
      data[idx + 1] = Math.max(0, Math.min(255, cg));
      data[idx + 2] = Math.max(0, Math.min(255, cb));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Objetos 3D coletáveis espalhados pelo labirinto (bandagens, analgésicos, baterias,
 * canivete, sinalizadores, chave e registros) + Sinalizadores de Magnésio acesos no chão.
 */
export class DoomWorldItems {
  private readonly root = new THREE.Group();
  private readonly pickups: WorldPickupInstance[] = [];
  private readonly activeFlares: ActiveMagnesiumFlare[] = [];

  private readonly matCrate: THREE.ShaderMaterial;
  private readonly matGauze: THREE.ShaderMaterial;
  private readonly matAmberGlass: THREE.ShaderMaterial;
  private readonly matBattery: THREE.ShaderMaterial;
  private readonly matBrass: THREE.ShaderMaterial;
  private readonly matSteel: THREE.ShaderMaterial;
  private readonly matFlareRed: THREE.ShaderMaterial;
  private readonly matPaper: THREE.ShaderMaterial;
  private readonly matFlame: THREE.MeshBasicMaterial;

  constructor(
    scene: THREE.Scene,
    sharedUniforms: DoomSharedUniforms
  ) {
    this.root.name = 'DoomWorldItems';
    scene.add(this.root);

    this.matCrate = createDoomPropMaterial(
      makeSolidPixelTex(48, 44, 40, [34, 31, 28]),
      sharedUniforms,
      { baseLight: 0.5 }
    );
    this.matGauze = createDoomPropMaterial(
      makeSolidPixelTex(208, 198, 178, [145, 36, 36]),
      sharedUniforms,
      { baseLight: 0.62, emissiveBoost: 0.08 }
    );
    this.matAmberGlass = createDoomPropMaterial(
      makeSolidPixelTex(155, 86, 38, [205, 188, 155]),
      sharedUniforms,
      { baseLight: 0.62, emissiveBoost: 0.08 }
    );
    this.matBattery = createDoomPropMaterial(
      makeSolidPixelTex(46, 52, 60, [196, 134, 48]),
      sharedUniforms,
      { baseLight: 0.6, emissiveBoost: 0.08 }
    );
    this.matBrass = createDoomPropMaterial(
      makeSolidPixelTex(188, 154, 82),
      sharedUniforms,
      { baseLight: 0.64, emissiveBoost: 0.09 }
    );
    this.matSteel = createDoomPropMaterial(
      makeSolidPixelTex(168, 176, 188, [88, 56, 42]),
      sharedUniforms,
      { baseLight: 0.62, emissiveBoost: 0.08 }
    );
    this.matFlareRed = createDoomPropMaterial(
      makeSolidPixelTex(178, 44, 40, [52, 46, 44]),
      sharedUniforms,
      { baseLight: 0.62, emissiveBoost: 0.09 }
    );
    this.matPaper = createDoomPropMaterial(
      makeSolidPixelTex(212, 200, 176, [122, 32, 32]),
      sharedUniforms,
      { baseLight: 0.66, emissiveBoost: 0.1, doubleSided: true }
    );
    this.matFlame = new THREE.MeshBasicMaterial({
      color: 0xff6b2b,
    });

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

      // Pequena base/caixote baixo de ferro escuro sob o suprimento
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.12, 0.38),
        this.matCrate
      );
      slab.position.y = 0.06;
      slab.rotation.y = (idx * 0.7) % Math.PI;
      group.add(slab);

      const itemMesh = this.buildItemMesh(p.itemId);
      itemMesh.position.y = 0.18;
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

  private buildItemMesh(itemId: string): THREE.Object3D {
    const holder = new THREE.Group();

    if (itemId === 'sterile_bandage') {
      const roll = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.095, 0.13, 8),
        this.matGauze
      );
      roll.position.y = 0.04;
      holder.add(roll);
    } else if (itemId === 'old_morphine') {
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.072, 0.16, 8),
        this.matAmberGlass
      );
      bottle.position.y = 0.06;
      const cork = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.034, 0.05, 6),
        this.matBrass
      );
      cork.position.y = 0.16;
      holder.add(bottle, cork);
    } else if (itemId === 'industrial_battery') {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.16, 0.08),
        this.matBattery
      );
      body.position.y = 0.06;
      const termL = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6),
        this.matBrass
      );
      termL.position.set(-0.03, 0.155, 0);
      const termR = termL.clone();
      termR.position.x = 0.03;
      holder.add(body, termL, termR);
    } else if (itemId === 'rusty_knife') {
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.035, 0.045),
        this.matCrate
      );
      grip.position.set(-0.05, 0.02, 0);
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.17, 0.012, 0.032),
        this.matSteel
      );
      blade.position.set(0.09, 0.022, 0);
      holder.add(grip, blade);
    } else if (itemId === 'magnesium_flare') {
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.28, 8),
        this.matFlareRed
      );
      stick.rotation.z = Math.PI * 0.5;
      stick.position.y = 0.02;
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.036, 0.04, 8),
        this.matBrass
      );
      cap.rotation.z = Math.PI * 0.5;
      cap.position.set(0.13, 0.02, 0);
      holder.add(stick, cap);
    } else if (itemId === 'sector_b_key') {
      const bow = new THREE.Mesh(
        new THREE.TorusGeometry(0.048, 0.014, 6, 8),
        this.matBrass
      );
      bow.rotation.x = Math.PI * 0.5;
      bow.position.set(-0.07, 0.015, 0);
      const shaft = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.016, 0.02),
        this.matBrass
      );
      shaft.position.set(0.03, 0.015, 0);
      const teeth = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.016, 0.042),
        this.matBrass
      );
      teeth.position.set(0.08, 0.015, 0.022);
      holder.add(bow, shaft, teeth);
    } else {
      // Folha de registro/diário manchada
      const sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(0.24, 0.3),
        this.matPaper
      );
      sheet.rotation.x = -Math.PI * 0.5;
      sheet.rotation.z = 0.22;
      sheet.position.y = 0.006;
      holder.add(sheet);
    }

    return holder;
  }

  /**
   * Acende e solta um Sinalizador de Magnésio no piso diante do jogador,
   * iluminando o setor e afugentando a Aranha por ~16 segundos.
   */
  spawnLitFlare(pos: THREE.Vector3, yaw: number): void {
    const fx = pos.x - Math.sin(yaw) * 0.65;
    const fz = pos.z - Math.cos(yaw) * 0.65;

    const group = new THREE.Group();
    group.position.set(fx, 0.04, fz);

    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8),
      this.matFlareRed
    );
    stick.rotation.z = Math.PI * 0.5;
    stick.rotation.y = yaw + 0.5;
    group.add(stick);

    const flameMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.085, 0),
      this.matFlame
    );
    flameMesh.position.set(
      Math.cos(yaw + 0.5) * 0.14,
      0.04,
      -Math.sin(yaw + 0.5) * 0.14
    );
    group.add(flameMesh);

    this.root.add(group);
    this.activeFlares.push({
      position: new THREE.Vector3(fx, 0.35, fz),
      group,
      flameMesh,
      remainingSec: 16.0,
      maxSec: 16.0,
    });
  }

  getActiveFlares(): readonly ActiveMagnesiumFlare[] {
    return this.activeFlares;
  }

  /**
   * Tenta pegar um objeto próximo (automaticamente ao encostar a <1.08m
   * ou intencionalmente ao pressionar E / clicar olhando até <2.35m).
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

      // Leve cintilação/respiração sutil para destacar o objeto sobre o caixote
      p.itemMesh.position.y = 0.18 + Math.sin(elapsed * 2.2 + i) * 0.012;

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
        (0.82 + 0.32 * Math.sin(elapsed * 29 + i * 3)) * lifeRatio;
      fl.flameMesh.scale.setScalar(Math.max(0.15, pulse));
    }
  }
}
