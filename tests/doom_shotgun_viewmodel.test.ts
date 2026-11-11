import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildShotgunModel,
  SHOTGUN_METRICS,
  type ShotgunMaterialSet,
} from '../src/doom/DoomShotgunModel';
import { createAstronautMaterials } from '../src/doom/DoomAstronaut';
import { DoomShotgunViewmodel } from '../src/doom/DoomShotgun';

const M = SHOTGUN_METRICS;

const lambert = (color: number): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ color, flatShading: true });

const probeMaterials: ShotgunMaterialSet = {
  steel: lambert(0x6b7480),
  steelBright: lambert(0x9aa4b0),
  steelDark: lambert(0x3f454d),
  polymer: lambert(0x2e3339),
  polymerDark: lambert(0x20242a),
  wood: lambert(0x6b4a2d),
  woodDark: lambert(0x472d17),
  rubber: lambert(0x1b1d20),
  brass: lambert(0xc19a52),
  cavity: lambert(0x0d0f12),
};

/**
 * União das caixas das malhas que cruzam a faixa Z informada, ignorando as
 * subárvores cujos nomes estão em `ignorar`.
 *
 * Serve para responder "o que passa por dentro do guarda-mão?" sem arrastar
 * peças que ficam longe dali (a massa de mira, o receptor, a coronha).
 */
function contentWithinZSpan(
  root: THREE.Object3D,
  zMin: number,
  zMax: number,
  ignore: ReadonlySet<string>
): THREE.Box3 {
  const out = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node as THREE.Mesh).geometry) return;
    for (let p: THREE.Object3D | null = node; p; p = p.parent) {
      if (ignore.has(p.name)) return;
    }
    const box = new THREE.Box3().setFromObject(node);
    if (box.max.z < zMin || box.min.z > zMax) return;
    out.union(box);
  });
  return out;
}

describe('Viewmodel da shotgun: mãos do personagem e integridade da arma', () => {
  it('as duas mãos são montadas só com os materiais do Traje Biológico Nível-A', () => {
    // As mãos em 1ª pessoa precisam ser a MESMA luva do personagem — borracha
    // butílica preta, anel carmim de vedação e mangote chartreuse. Nenhuma cor
    // própria pode entrar, senão a mão na tela não tem nada a ver com o
    // modelo do jogador.
    const suit = createAstronautMaterials();
    const signature = (material: THREE.Material): string => {
      const m = material as THREE.MeshLambertMaterial;
      const map = m.map as THREE.Texture | null;
      return `${m.color.getHexString()}|${map ? map.uuid : 'sem-textura'}`;
    };
    const expected = new Map<string, string>([
      [signature(suit.bootRubber), 'luva preta'],
      [signature(suit.anodizedCrimson), 'anel carmim'],
      [signature(suit.astroCamo), 'manga chartreuse'],
    ]);

    const viewmodel = new DoomShotgunViewmodel(16 / 9);
    const root = (viewmodel as unknown as { rootGroup: THREE.Group }).rootGroup;
    root.visible = true;
    root.updateMatrixWorld(true);

    for (const handName of ['ShotgunGlove_right', 'ShotgunGlove_left']) {
      const hand = root.getObjectByName(handName);
      expect(hand, `${handName} deveria existir`).toBeTruthy();

      const tally = new Map<string, number>();
      hand!.traverse((node) => {
        const material = (node as THREE.Mesh).material as THREE.Material | undefined;
        if (!material) return;
        const label = expected.get(signature(material)) ?? `FORA DO TRAJE(${signature(material)})`;
        tally.set(label, (tally.get(label) ?? 0) + 1);
      });

      expect([...tally.keys()].filter((k) => k.startsWith('FORA')), `${handName}: ${[...tally]}`).toEqual([]);
      // A luva é quase toda borracha preta; cada mão tem exatamente um anel
      // carmim no punho e um mangote chartreuse saindo de quadro.
      expect(tally.get('luva preta') ?? 0).toBeGreaterThan(10);
      expect(tally.get('anel carmim')).toBe(1);
      expect(tally.get('manga chartreuse')).toBe(1);
    }
  });

  it('o guarda-mão envolve cano, nervura e tubo de cartuchos com folga', () => {
    // Quando uma peça interna fica rente à superfície externa do polímero, o
    // depth buffer briga e a bomba inteira cintila. Aqui a folga mínima é de
    // 1,5 mm para cima e para baixo.
    const model = buildShotgunModel(probeMaterials, { withStock: true });
    model.root.updateMatrixWorld(true);

    const forend = new THREE.Box3().setFromObject(model.root.getObjectByName('ShotgunForend')!);
    const bore = new THREE.Box3().setFromObject(model.root.getObjectByName('PumpBore')!);

    // Só o corpo de polímero: as barras de ação avançam para dentro do
    // receptor de propósito e não participam do envelope.
    const bodyZMin = M.foreEndCenterZ - M.foreEndHalfLength;
    const bodyZMax = M.foreEndCenterZ + M.foreEndHalfLength;
    const content = contentWithinZSpan(model.root, bodyZMin, bodyZMax, new Set(['ShotgunForend']));
    expect(content.isEmpty()).toBe(false);

    expect(forend.max.y - content.max.y).toBeGreaterThan(0.0015);
    expect(content.min.y - forend.min.y).toBeGreaterThan(0.0015);

    // O furo interno precisa acomodar tudo o que passa por ali, senão o tubo
    // de cartuchos atravessa a parede do guarda-mão.
    expect(bore.max.y).toBeGreaterThanOrEqual(content.max.y);
    expect(bore.min.y).toBeLessThanOrEqual(content.min.y);
    expect(bore.min.x).toBeLessThanOrEqual(content.min.x);
    expect(bore.max.x).toBeGreaterThanOrEqual(content.max.x);
  });

  it('as barras de ação continuam dentro do receptor em todo o curso da bomba', () => {
    // Curso completo = 0,085 m para a frente. Se a haste for curta demais, ela
    // se solta da carcaça no fim do bombeamento e fica flutuando no vão.
    const model = buildShotgunModel(probeMaterials, { withStock: true });
    model.root.updateMatrixWorld(true);
    const receiver = new THREE.Box3().setFromObject(model.root.getObjectByName('ShotgunReceiver')!);
    const pump = model.root.getObjectByName('ShotgunForend')!;

    for (const offset of [0, -M.pumpTravel * 0.25, -M.pumpTravel * 0.5, -M.pumpTravel]) {
      pump.position.z = M.foreEndCenterZ + offset;
      pump.updateMatrixWorld(true);
      const bars = new THREE.Box3();
      for (const child of pump.children) {
        if (child.name === 'ActionBar') bars.union(new THREE.Box3().setFromObject(child));
      }
      expect(bars.isEmpty(), `nenhuma barra de ação no curso ${offset}`).toBe(false);
      expect(bars.max.z, `barra solta do receptor no curso ${offset}`).toBeGreaterThanOrEqual(
        receiver.min.z
      );
    }
    pump.position.z = M.foreEndCenterZ;
  });
});
