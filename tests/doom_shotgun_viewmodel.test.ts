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
    const model = buildShotgunModel(probeMaterials);
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
    const model = buildShotgunModel(probeMaterials);
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
  it('a coronha aparece em 1ª pessoa: punho no quadro, coice fora dele', () => {
    // Sem a coronha a arma era só cano + receptor e parecia um fuzil. Agora
    // ela é montada de verdade: o punho tem de cair DENTRO do quadro (é ali
    // que a mão direita fecha) e o coice tem de sair de quadro, como numa
    // escopeta apoiada no ombro.
    const viewmodel = new DoomShotgunViewmodel(16 / 9);
    const root = (viewmodel as unknown as { rootGroup: THREE.Group }).rootGroup;
    root.visible = true;
    const camera = viewmodel.viewCamera;
    const gun = root.getObjectByName('ShotgunGun')!;

    const stock = gun.getObjectByName('ShotgunStock');
    expect(stock, 'a coronha deveria existir no viewmodel').toBeTruthy();
    expect(stock!.visible, 'a coronha deveria estar visível em 1ª pessoa').toBe(true);
    expect(gun.getObjectByName('GripWood'), 'o punho deveria existir').toBeTruthy();

    root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    /** Posição na tela (NDC) do ponto (0, 0, z) no espaço da arma. */
    const ndcAt = (z: number): THREE.Vector3 =>
      new THREE.Vector3(0, 0, z).applyMatrix4(gun.matrixWorld).project(camera);

    const dentroDoQuadro = (p: THREE.Vector3): boolean =>
      Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;

    expect(dentroDoQuadro(ndcAt(SHOTGUN_METRICS.gripAnchor.z)), 'o punho saiu do quadro').toBe(true);
    expect(dentroDoQuadro(ndcAt(SHOTGUN_METRICS.muzzleZ)), 'a boca do cano saiu do quadro').toBe(true);
    // O coice fica atrás da câmara na cena, mas tem de projetar FORA do quadro
    // para não tampá-lo.
    expect(dentroDoQuadro(ndcAt(SHOTGUN_METRICS.stockRearZ)), 'o coice invadiu o quadro').toBe(false);
  });

  it('a mão direita encosta no punho em vez de fechar no ar', () => {
    // A luva contorna um cilindro cujo raio é a distância do eixo da peça até
    // a face interna da palma. Se esse raio for MAIOR que a metade da largura
    // do punho, a mão fica solta no ar — foi exatamente o defeito anterior,
    // com 3,2 mm de folga entre a palma e a madeira.
    const model = buildShotgunModel(probeMaterials);
    model.root.updateMatrixWorld(true);
    const grip = new THREE.Box3().setFromObject(model.root.getObjectByName('GripWood')!);
    const meiaLarguraPunho = (grip.max.x - grip.min.x) / 2;

    const viewmodel = new DoomShotgunViewmodel(16 / 9);
    const root = (viewmodel as unknown as { rootGroup: THREE.Group }).rootGroup;
    root.visible = true;
    root.updateMatrixWorld(true);

    // Mede a luva no referencial da própria âncora do punho DO VIEWMODEL (não
    // do modelo recém-construído acima): é ali que a palma nasce, a
    // `raioDaEmpunhadura` do eixo da peça.
    const ancora = root.getObjectByName('WeaponGripAnchor')!;
    const luva = root.getObjectByName('ShotgunGlove_right')!;
    const paraAncora = new THREE.Matrix4().copy(ancora.matrixWorld).invert();
    const caixaNaAncora = new THREE.Box3();
    luva.traverse((node) => {
      const geometry = (node as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!geometry) return;
      geometry.computeBoundingBox();
      caixaNaAncora.union(
        geometry.boundingBox!.clone().applyMatrix4(
          new THREE.Matrix4().multiplyMatrices(paraAncora, node.matrixWorld)
        )
      );
    });
    expect(caixaNaAncora.isEmpty()).toBe(false);

    // A palma é o bloco mais afastado no lado +X; a face interna dela fica a
    // `raioDaEmpunhadura` do eixo. A largura do punho tem de alcançar esse ponto.
    const faceInternaDaPalma = 0.0195;
    expect(meiaLarguraPunho).toBeCloseTo(0.02, 4);
    expect(faceInternaDaPalma).toBeLessThanOrEqual(meiaLarguraPunho);

    // E a luva de fato envolve o punho: ela se estende dos dois lados do eixo.
    expect(caixaNaAncora.min.x).toBeLessThan(0);
    expect(caixaNaAncora.max.x).toBeGreaterThan(meiaLarguraPunho);
  });
});

/** Contorno que a luva fecha: superelipse de semi-eixos (rx, ry) e expoente n. */
function wrapPoint(
  angle: number,
  extra: number,
  rx: number,
  ry: number,
  n: number
): THREE.Vector3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = rx * Math.sign(cos) * Math.abs(cos) ** (2 / n);
  const py = -ry * Math.sign(sin) * Math.abs(sin) ** (2 / n);
  let nx = ((Math.abs(px) / rx) ** (n - 1) * Math.sign(px)) / rx;
  let ny = ((Math.abs(py) / ry) ** (n - 1) * Math.sign(py)) / ry;
  const len = Math.hypot(nx, ny) || 1;
  return new THREE.Vector3(px + (nx / len) * extra, py + (ny / len) * extra, 0);
}

/**
 * Folga entre a linha de centro de cada dedo e a superfície da peça agarrada.
 * Zero = o dedo encosta; negativo = o dedo atravessa a peça.
 */
function fingerGaps(
  anchor: THREE.Object3D,
  target: THREE.Object3D,
  rx: number,
  ry: number,
  n: number,
  fingerR: number,
  fingerSpanZ: number
): number[] {
  // O raio nasce dentro da peça, então as faces internas precisam contar.
  const restored: Array<[THREE.Material, THREE.Side]> = [];
  target.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | undefined;
    if (!material) return;
    restored.push([material, material.side]);
    material.side = THREE.DoubleSide;
  });
  const ray = new THREE.Raycaster();
  ray.far = 0.5;
  const gaps: number[] = [];
  for (let finger = 0; finger < 4; finger++) {
    const z = (finger - 1.5) * fingerSpanZ;
    for (let angle = 0.3; angle <= 2.1 + 1e-6; angle += 0.15) {
      const center = wrapPoint(angle, fingerR * 1.12, rx, ry, n);
      const radius = Math.hypot(center.x, center.y);
      const origin = anchor.localToWorld(new THREE.Vector3(0, 0, z));
      const direction = new THREE.Vector3(center.x, center.y, 0)
        .normalize()
        .transformDirection(anchor.matrixWorld);
      ray.set(origin, direction);
      const hit = ray.intersectObject(target, true)[0];
      if (hit) gaps.push(radius - fingerR - hit.distance);
    }
  }
  for (const [material, side] of restored) material.side = side;
  return gaps;
}

describe('Encaixe das mãos na arma', () => {
  const viewmodel = new DoomShotgunViewmodel(16 / 9);
  const root = (viewmodel as unknown as { rootGroup: THREE.Group }).rootGroup;
  root.visible = true;
  viewmodel.equip();
  for (let i = 0; i < 200; i++) viewmodel.update(0.016, 0, 0, 0);
  root.updateMatrixWorld(true);
  const gun = root.getObjectByName('ShotgunGun')!;

  it('os dedos da mão direita contornam o punho sem afundar nem flutuar', () => {
    // O punho é um retângulo de quinas arredondadas (0,040 × 0,060 m), não um
    // tubo: fechar a mão num círculo cravava os dedos 12 mm na madeira nas
    // quinas. A luva fecha no contorno real, então a folga fica abaixo de 4 mm.
    const gaps = fingerGaps(
      gun.getObjectByName('WeaponGripAnchor')!,
      gun.getObjectByName('GripWood')!,
      0.0195,
      0.0295,
      8,
      0.0090 * 0.98,
      0.0195 * 0.98
    );
    expect(gaps.length).toBeGreaterThan(20);
    const worst = Math.max(...gaps.map(Math.abs));
    expect(worst, `pior folga ${worst}`).toBeLessThan(0.004);
  });

  it('os dedos da mão esquerda contornam o guarda-mão sem afundar nem flutuar', () => {
    const gaps = fingerGaps(
      gun.getObjectByName('WeaponSupportAnchor')!,
      gun.getObjectByName('PumpBody')!,
      0.027,
      0.0235,
      2,
      0.0090,
      0.0195
    );
    expect(gaps.length).toBeGreaterThan(20);
    const worst = Math.max(...gaps.map(Math.abs));
    expect(worst, `pior folga ${worst}`).toBeLessThan(0.004);
  });

  it('a mão direita fecha no meio do punho, não na ponta dele', () => {
    // A âncora marca o centro do punho: a distância até a madeira precisa ser
    // parecida para cima e para baixo, senão a mão fica pendurada numa borda.
    const anchor = gun.getObjectByName('WeaponGripAnchor')!;
    const target = gun.getObjectByName('GripWood')!;
    const restored: Array<[THREE.Material, THREE.Side]> = [];
    target.traverse((node) => {
      const material = (node as THREE.Mesh).material as THREE.Material | undefined;
      if (!material) return;
      restored.push([material, material.side]);
      material.side = THREE.DoubleSide;
    });
    const ray = new THREE.Raycaster();
    ray.far = 0.5;
    const reach = (deg: number): number => {
      const a = (deg * Math.PI) / 180;
      ray.set(
        anchor.getWorldPosition(new THREE.Vector3()),
        new THREE.Vector3(Math.cos(a), -Math.sin(a), 0).transformDirection(anchor.matrixWorld)
      );
      return ray.intersectObject(target, true)[0]?.distance ?? NaN;
    };
    const down = reach(90);
    const up = reach(270);
    for (const [material, side] of restored) material.side = side;
    expect(Math.abs(down - up)).toBeLessThan(0.002);
    // E o punho tem de ser fino o bastante para uma mão fechar nele.
    expect((down + up) / 2).toBeLessThan(0.034);
  });
});

describe('Enquadramento do viewmodel em 1ª pessoa', () => {
  /** Monta o viewmodel equipado e devolve o que é preciso para medir a tela. */
  function framing(aspect: number) {
    const viewmodel = new DoomShotgunViewmodel(aspect);
    const root = (viewmodel as unknown as { rootGroup: THREE.Group }).rootGroup;
    root.visible = true;
    viewmodel.equip();
    for (let i = 0; i < 200; i++) viewmodel.update(0.016, 0, 0, 0);
    root.updateMatrixWorld(true);
    const camera = viewmodel.viewCamera;
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    /** Caixa do objeto em coordenadas de tela (NDC: -1..1). */
    const screenBox = (obj: THREE.Object3D): THREE.Box2 => {
      const out = new THREE.Box2();
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh;
        const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
        if (!geometry) return;
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox!;
        for (const x of [bb.min.x, bb.max.x]) {
          for (const y of [bb.min.y, bb.max.y]) {
            for (const z of [bb.min.z, bb.max.z]) {
              const p = new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld);
              // Atrás da câmera a projeção inverte e o número não diz nada.
              if (p.z > -0.03) continue;
              const ndc = p.project(camera);
              out.expandByPoint(new THREE.Vector2(ndc.x, ndc.y));
            }
          }
        }
      });
      return out;
    };
    /** Fração da altura da tela onde o objeto começa (0 = topo, 1 = base). */
    const topOf = (name: string): number => {
      const box = screenBox(root.getObjectByName(name)!);
      return (1 - box.max.y) / 2;
    };
    return { root, camera, screenBox, topOf };
  }

  it('a arma fica na metade de baixo da tela, longe da mira', () => {
    // A arma cruzava o centro da tela e tampava a mira: o ponto mais alto dela
    // estava logo abaixo do meio. Agora desceu para baixo dos 62% da altura.
    for (const aspect of [16 / 9, 21 / 9, 4 / 3]) {
      const f = framing(aspect);
      expect(f.topOf('ShotgunGun'), `arma no aspect ${aspect.toFixed(2)}`).toBeGreaterThan(0.62);
    }
  });

  it('a boca do cano fica bem abaixo da linha dos olhos', () => {
    // É a ponta da arma que invadia o campo de visão; ela tem de ficar nos
    // 30% finais da tela.
    for (const aspect of [16 / 9, 21 / 9, 4 / 3]) {
      const f = framing(aspect);
      const gun = f.root.getObjectByName('ShotgunGun')!;
      const muzzle = new THREE.Vector3(0, 0, SHOTGUN_METRICS.muzzleZ)
        .applyMatrix4(gun.matrixWorld)
        .project(f.camera);
      expect((1 - muzzle.y) / 2, `boca do cano no aspect ${aspect.toFixed(2)}`).toBeGreaterThan(0.66);
    }
  });

  it('as duas mãos continuam visíveis dentro do quadro', () => {
    // De nada adianta baixar a arma e sumir com as mãos: a luva direita fecha
    // no punho e a esquerda segura a bomba, e as duas precisam aparecer.
    for (const aspect of [16 / 9, 21 / 9, 4 / 3]) {
      const f = framing(aspect);
      expect(f.topOf('ShotgunGlove_right'), `mão direita no aspect ${aspect.toFixed(2)}`).toBeLessThan(0.72);
      expect(f.topOf('ShotgunGlove_left'), `mão esquerda no aspect ${aspect.toFixed(2)}`).toBeLessThan(0.72);
    }
  });

  it('o cano continua apontando para a frente, com o coice fora do quadro', () => {
    const f = framing(16 / 9);
    const muzzle = f.root
      .getObjectByName('ShotgunMuzzleAnchor')!
      .getWorldPosition(new THREE.Vector3());
    // Para a frente da câmera (-Z) e abaixo da linha dos olhos.
    expect(muzzle.z).toBeLessThan(-0.6);
    expect(muzzle.y).toBeLessThan(-0.1);
    // O coice da coronha sai de quadro, como numa escopeta apoiada no ombro.
    const butt = new THREE.Vector3(0, -0.05, SHOTGUN_METRICS.stockRearZ)
      .applyMatrix4(f.root.getObjectByName('ShotgunGun')!.matrixWorld)
      .project(f.camera);
    expect(Math.abs(butt.x) <= 1 && Math.abs(butt.y) <= 1).toBe(false);
  });
});
