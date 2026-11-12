import * as THREE from 'three';

/* ==========================================================================
   MODELAGEM 3D DA SHOTGUN DE PUMP (FONTE ÚNICA DE VERDADE)
   --------------------------------------------------------------------------
   Um único construtor alimenta as três situações em que a arma aparece:
   o viewmodel de 1ª pessoa, a arma nas mãos dos aliados em 3ª pessoa e as
   peças soltas que o jogador recolhe no mundo. Assim as peças do chão são
   literalmente as mesmas peças da arma montada — e não uma reinterpretação
   aproximada feita de caixas.

   Referencial canônico ("espaço da arma"):
     -Z = direção do cano (a boca do tiro está em z negativo)
     +Y = para cima
     +X = lado direito da arma (lado da porta de ejeção)
   Origem: encontro do cano com o receptor, na altura do eixo da alma.
   Todas as cotas estão em metros e seguem uma escopeta pump clássica de
   cano longo (~0,98 m de comprimento total, cano de 0,50 m).
   ========================================================================== */

export interface ShotgunMaterialSet {
  /** Aço azulado do receptor e do cano. */
  steel: THREE.Material;
  /** Aço claro: arestas vivas, parafusos, trilho, colarinhos. */
  steelBright: THREE.Material;
  /** Aço escuro: tubo de cartuchos, ferrolho, interior das cavidades. */
  steelDark: THREE.Material;
  /** Polímero do guarda-mão. */
  polymer: THREE.Material;
  /** Polímero escuro: nervuras e colarinhos do guarda-mão. */
  polymerDark: THREE.Material;
  /** Nogueira da coronha. */
  wood: THREE.Material;
  /** Nogueira escura: frisos de checagem e cunhas. */
  woodDark: THREE.Material;
  /** Borracha do coice e do soleira. */
  rubber: THREE.Material;
  /** Latão: massa de mira, cartuchos, pequenos detalhes. */
  brass: THREE.Material;
  /** Cavidades (boca do cano, porta de ejeção, alça de alimentação). */
  cavity: THREE.Material;
}

/** Cotas da arma, expostas para os testes e para a pose das mãos. */
export const SHOTGUN_METRICS = {
  /** Raio externo do cano (12 gauge: ~21,6 mm de diâmetro). */
  barrelRadius: 0.0108,
  /** Raio da alma. */
  boreRadius: 0.0093,
  /** Posição da boca do cano no eixo Z. */
  muzzleZ: -0.5,
  /** Centro do tubo de cartuchos (abaixo do cano). */
  magazineY: -0.0215,
  magazineRadius: 0.0102,
  /** Comprimento do receptor (z negativo = frente). */
  receiverFrontZ: -0.03,
  receiverRearZ: 0.2,
  receiverHalfWidth: 0.02,
  receiverTopY: 0.024,
  receiverBottomY: -0.034,
  /**
   * Guarda-mão (bomba): centro, meio-comprimento e curso do bombeamento.
   * A altura/centro cobrem o envelope inteiro do que passa por dentro dele —
   * cano (até +0,0108), nervura ventilada (até +0,0160) e tubo de cartuchos
   * (até -0,0317) — com parede de ~3 mm, para que nenhuma peça fique
   * coincidente com a superfície externa do polímero (o que causava
   * cintilação de profundidade ao longo de todo o guarda-mão).
   */
  foreEndCenterZ: -0.16,
  foreEndHalfLength: 0.1,
  foreEndHalfWidth: 0.023,
  foreEndHalfHeight: 0.028,
  foreEndCenterY: -0.008,
  pumpTravel: 0.085,
  /** Coronha. */
  stockRearZ: 0.475,
  /**
   * Âncora da mão direita (punho da coronha).
   *
   * O eixo acompanha o centro real do punho — 12,5° abaixo do eixo da arma,
   * que é a inclinação da linha média do perfil da coronha — e o ponto cai no
   * meio do punho (z = 0,235), logo atrás do guarda-mato. Com o eixo antigo
   * (19,8° e 5 mm mais baixo) a linha da mão saía da madeira antes do fim do
   * punho e os dedos contornavam o vazio atrás dele.
   */
  gripAnchor: { y: -0.0121, z: 0.2362, pitchX: 0.218 },
  /** Âncora da mão esquerda (guarda-mão), em relação ao grupo da bomba. */
  pumpAnchor: { rollZ: 1.21 },
} as const;

/* --------------------------------------------------------------------------
   Helpers de modelagem
   -------------------------------------------------------------------------- */

/** Extruda um perfil lateral (Z × Y) na largura X, com bisel opcional. */
export function extrudeProfile(
  profile: ReadonlyArray<readonly [number, number]>,
  width: number,
  bevel = 0,
  curveSegments = 3
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();
  const depth = Math.max(0.002, width - bevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Corpo de revolução em torno do eixo Z (perfil [raio, z]). */
export function latheZ(
  profile: ReadonlyArray<readonly [number, number]>,
  segments = 20
): THREE.LatheGeometry {
  const points = profile.map(([radius, z]) => new THREE.Vector2(radius, z));
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export type MeshAdder = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation?: [number, number, number],
  parent?: THREE.Object3D
) => THREE.Mesh;

export function createMeshAdder(defaultParent: THREE.Object3D): MeshAdder {
  return (geometry, material, position, rotation = [0, 0, 0], parent = defaultParent) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    parent.add(mesh);
    return mesh;
  };
}

/** Cápsula esticada entre dois pontos — dedos, punho, mangote. */
export function capsuleBetween(
  parent: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = Math.max(0.001, dir.length());
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(mesh);
  return mesh;
}

/** Anel de parafuso/pino: cabeça cilíndrica rente à superfície. */
function addScrew(
  add: MeshAdder,
  parent: THREE.Object3D,
  position: [number, number, number],
  material: THREE.Material,
  axis: 'x' | 'y' | 'z' = 'x'
): void {
  const rotation: [number, number, number] =
    axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'y' ? [0, 0, 0] : [Math.PI / 2, 0, 0];
  add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0022, 10), material, position, rotation, parent);
  const slot = add(
    new THREE.BoxGeometry(0.005, 0.0008, 0.0012),
    material,
    position,
    rotation,
    parent
  );
  slot.translateX(0.0012);
}

/* --------------------------------------------------------------------------
   Peças
   -------------------------------------------------------------------------- */

/**
 * Cano + tubo de cartuchos + cinta + massa de mira.
 * Vai de z = +0.01 (boca da câmara, dentro do receptor) até a boca em
 * z = -0.50, com a alma vazia para a boca nunca virar um disco sólido.
 */
export function buildShotgunBarrelAssembly(mats: ShotgunMaterialSet): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ShotgunBarrelAssembly';
  const add = createMeshAdder(group);
  const M = SHOTGUN_METRICS;
  const barrelLength = Math.abs(M.muzzleZ) + 0.01;

  // Tubo do cano (aberto nas duas pontas) e alma vazia.
  add(
    new THREE.CylinderGeometry(M.barrelRadius, M.barrelRadius, barrelLength, 20, 1, true),
    mats.steel,
    [0, 0, 0.005 - barrelLength / 2],
    [Math.PI / 2, 0, 0]
  ).name = 'BarrelOuter';
  add(
    new THREE.CylinderGeometry(M.boreRadius, M.boreRadius, barrelLength, 20, 1, true),
    mats.cavity,
    [0, 0, 0.005 - barrelLength / 2],
    [Math.PI / 2, 0, 0]
  ).name = 'BarrelBore';

  // Boca do cano: anel de aço vivo + parede da alma visível.
  const muzzleRim = add(
    new THREE.RingGeometry(M.boreRadius, M.barrelRadius, 22),
    mats.steelBright,
    [0, 0, M.muzzleZ + 0.0004],
    [0, Math.PI, 0]
  );
  muzzleRim.name = 'MuzzleRim';
  const breechRim = add(
    new THREE.RingGeometry(M.boreRadius, M.barrelRadius, 22),
    mats.steelBright,
    [0, 0, 0.0045],
    [0, 0, 0]
  );
  breechRim.name = 'BreechRim';

  // Reforço da câmara: o cano engrossa onde encaixa no receptor.
  add(
    latheZ([
      [0.0135, 0.008],
      [0.0138, -0.01],
      [0.0138, -0.062],
      [0.0124, -0.082],
      [0.0112, -0.094],
    ], 20),
    mats.steel,
    [0, 0, 0]
  );
  // Extrator: pequena lâmina de aço na altura da câmara.
  add(new THREE.BoxGeometry(0.0032, 0.0026, 0.03), mats.steelBright, [0.0118, 0.006, -0.05]);

  // Trilho ventilado sobre o cano + massa de mira de latão.
  add(
    new THREE.BoxGeometry(0.0072, 0.0042, 0.43),
    mats.steelDark,
    [0, M.barrelRadius + 0.0022, -0.275]
  ).name = 'BarrelRib';
  // Postes da nervura ventilada: ficam ABAIXO do topo do guarda-mão, senão
  // atravessam o polímero e aparecem furando a peça.
  for (let i = 0; i < 10; i++) {
    add(
      new THREE.BoxGeometry(0.0034, 0.0028, 0.009),
      mats.steel,
      [0, M.barrelRadius + 0.0038, -0.075 - i * 0.042]
    );
  }
  add(
    new THREE.SphereGeometry(0.0029, 10, 8),
    mats.brass,
    [0, M.barrelRadius + 0.0058, M.muzzleZ + 0.014]
  ).name = 'FrontSight';

  // Tubo de cartuchos, paralelo e colado sob o cano.
  const magLength = 0.452;
  add(
    new THREE.CylinderGeometry(M.magazineRadius, M.magazineRadius, magLength, 16, 1, false),
    mats.steelDark,
    [0, M.magazineY, -0.032 - magLength / 2],
    [Math.PI / 2, 0, 0]
  ).name = 'MagazineTube';
  // Tampa dianteira do tubo com anel de retenção da mola.
  add(
    latheZ([
      [0.0124, 0],
      [0.0124, -0.012],
      [0.0106, -0.016],
      [0.0106, -0.019],
      [0.0, -0.019],
    ], 16),
    mats.steelBright,
    [0, M.magazineY, -0.484]
  ).name = 'MagazineCap';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    add(
      new THREE.BoxGeometry(0.0014, 0.0014, 0.011),
      mats.steelDark,
      [
        Math.cos(a) * 0.0124,
        M.magazineY + Math.sin(a) * 0.0124,
        -0.476,
      ]
    );
  }

  // Cinta que prende cano e tubo perto da boca, com parafuso passante.
  add(
    new THREE.BoxGeometry(0.030, 0.046, 0.013),
    mats.steelDark,
    [0, (M.magazineY) / 2, -0.436]
  ).name = 'BarrelBand';
  add(
    new THREE.CylinderGeometry(0.0034, 0.0034, 0.032, 8),
    mats.steelBright,
    [0, (M.magazineY) / 2 + 0.002, -0.436],
    [0, 0, Math.PI / 2]
  );
  addScrew(add, group, [0.0155, (M.magazineY) / 2 - 0.008, -0.436], mats.steelBright, 'x');

  return group;
}

/**
 * Receptor de aço: tampa do ferrolho, porta de ejeção no lado direito,
 * porta de alimentação embaixo, guarda-mato aberto, gatilho e travas.
 */
export function buildShotgunReceiver(mats: ShotgunMaterialSet): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ShotgunReceiver';
  const add = createMeshAdder(group);

  // Carcaça: perfil lateral extrudado, com o dorso levemente mais alto atrás.
  const shellProfile: ReadonlyArray<readonly [number, number]> = [
    [-0.030, 0.014],
    [-0.030, -0.016],
    [0.010, -0.030],
    [0.110, -0.034],
    [0.200, -0.032],
    [0.200, 0.018],
    [0.130, 0.023],
    [0.010, 0.024],
  ];
  // Carcaça com os lados arredondados (bisel de 9 mm numa largura de 40 mm):
  // o receptor de uma escopeta tem flancos abaulados, e não faces planas —
  // com bisel de 4 mm a peça virava uma chapa e a luz batia nela como numa
  // caixa de papelão.
  add(extrudeProfile(shellProfile, 0.04, 0.009), mats.steel, [0, 0, 0]);
  // Tampa do ferrolho com frisos de aderência (a "costela" do receptor).
  add(new THREE.BoxGeometry(0.041, 0.006, 0.12), mats.steelBright, [0, 0.026, 0.085]);
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(0.043, 0.0018, 0.0055), mats.steel, [0, 0.0295, 0.035 + i * 0.019]);
  }

  // Porta de ejeção (lado direito) com o ferrolho aparecendo dentro.
  add(
    new THREE.BoxGeometry(0.004, 0.020, 0.09),
    mats.cavity,
    [0.0205, 0.002, 0.11]
  ).name = 'EjectionPort';
  add(new THREE.BoxGeometry(0.004, 0.014, 0.052), mats.steelBright, [0.0218, 0.002, 0.128]).name =
    'Bolt';
  // Alavanca de manejo do ferrolho saindo pela porta.
  add(
    new THREE.CylinderGeometry(0.0034, 0.0034, 0.026, 8),
    mats.steelDark,
    [0.0235, 0.0, 0.108],
    [Math.PI / 2, 0, 0]
  );
  add(
    new THREE.SphereGeometry(0.0042, 8, 6),
    mats.steelDark,
    [0.0235, 0.0, 0.096]
  );

  // Porta de alimentação + elevador de cartucho na parte de baixo.
  add(new THREE.BoxGeometry(0.026, 0.004, 0.086), mats.cavity, [0, -0.033, 0.085]).name =
    'LoadingPort';
  add(new THREE.BoxGeometry(0.020, 0.0034, 0.062), mats.steelBright, [0, -0.0305, 0.09]).name =
    'Carrier';

  // Guarda-mato ABERTO (nunca uma silhueta cheia): dois montantes, o arco
  // inferior e o gatilho pendurado no meio — dá para ver através dele.
  add(new THREE.BoxGeometry(0.030, 0.030, 0.009), mats.steel, [0, -0.049, 0.055]).name =
    'GuardFront';
  add(new THREE.BoxGeometry(0.030, 0.030, 0.009), mats.steel, [0, -0.049, 0.130]).name =
    'GuardRear';
  add(new THREE.BoxGeometry(0.030, 0.009, 0.086), mats.steel, [0, -0.0625, 0.0925]).name =
    'GuardBottom';
  add(new THREE.BoxGeometry(0.0075, 0.022, 0.008), mats.steelDark, [0, -0.05, 0.088], [0.22, 0, 0]).name =
    'Trigger';
  // Trava de segurança (pino transversal atrás do guarda-mato) e botão de
  // liberação da bomba, no lado direito.
  add(
    new THREE.CylinderGeometry(0.0032, 0.0032, 0.046, 10),
    mats.steelBright,
    [0, -0.038, 0.158],
    [0, 0, Math.PI / 2]
  ).name = 'Safety';
  add(new THREE.BoxGeometry(0.0035, 0.012, 0.026), mats.steelBright, [0.0212, -0.014, 0.055]).name =
    'SlideRelease';
  // Pinos do mecanismo (um à frente, um atrás) na lateral direita.
  for (const z of [0.015, 0.182]) {
    addScrew(add, group, [0.0208, -0.008, z], mats.steelBright, 'x');
  }

  return group;
}

/**
 * Guarda-mão (bomba) de polímero com nervuras, colarinhos e as barras de
 * ação de aço que desaparecem dentro do receptor ao bombear.
 * Construído centrado na própria origem: o chamador o posiciona.
 */
export function buildShotgunForend(mats: ShotgunMaterialSet): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ShotgunForend';
  const add = createMeshAdder(group);
  const M = SHOTGUN_METRICS;
  const half = M.foreEndHalfLength;

  // Corpo ovalado envolvendo cano e tubo de cartuchos, oco por dentro.
  add(
    new THREE.CylinderGeometry(M.foreEndHalfHeight, M.foreEndHalfHeight, half * 2, 20, 1, true),
    mats.polymer,
    [0, 0, 0],
    [Math.PI / 2, 0, 0]
  ).name = 'PumpBody';
  const body = group.children[group.children.length - 1];
  body.scale.set(M.foreEndHalfWidth / M.foreEndHalfHeight, 1, 1);
  // Alma oca oval: envolve o cano, a nervura e o tubo de cartuchos de uma vez
  // (altura útil de -0,0330 a +0,0172 no espaço da arma). Antes era um círculo
  // de raio 0,017 e o tubo de cartuchos atravessava a parede inferior.
  const bore = add(
    new THREE.CylinderGeometry(0.0251, 0.0251, half * 2 + 0.006, 20, 1, true),
    mats.cavity,
    [0, 0.0001, 0],
    [Math.PI / 2, 0, 0]
  );
  bore.name = 'PumpBore';
  bore.scale.set(0.0145 / 0.0251, 1, 1);

  // Nervuras horizontais de aderência (o "corrugado" do guarda-mão).
  for (let i = 0; i < 9; i++) {
    const z = -half + 0.012 + i * 0.021;
    const rib = add(
      new THREE.CylinderGeometry(M.foreEndHalfHeight + 0.0016, M.foreEndHalfHeight + 0.0016, 0.006, 20, 1, false),
      mats.polymerDark,
      [0, 0, z],
      [Math.PI / 2, 0, 0]
    );
    rib.name = 'PumpRib';
    rib.scale.set(M.foreEndHalfWidth / M.foreEndHalfHeight, 1, 1);
  }
  // Colarinhos de aço nas duas pontas.
  for (const z of [-half - 0.004, half + 0.004]) {
    const collar = add(
      new THREE.CylinderGeometry(M.foreEndHalfHeight + 0.001, M.foreEndHalfHeight + 0.001, 0.012, 20, 1, false),
      mats.steelDark,
      [0, 0, z],
      [Math.PI / 2, 0, 0]
    );
    collar.name = 'PumpEndCollar';
    collar.scale.set(M.foreEndHalfWidth / M.foreEndHalfHeight, 1, 1);
  }
  // Barras de ação: duas hastes de aço que ligam a bomba ao ferrolho. O
  // comprimento cobre o curso inteiro do bombeamento (0,085 m) e ainda deixa
  // a ponta dentro do receptor — antes elas se soltavam da carcaça no fim do
  // curso e ficavam flutuando no vão entre a bomba e o receptor.
  for (const x of [-0.0155, 0.0155]) {
    add(
      new THREE.BoxGeometry(0.005, 0.0075, 0.17),
      mats.steelBright,
      [x, -0.019, half + 0.0575]
    ).name = 'ActionBar';
  }

  return group;
}

/**
 * Coronha de nogueira: punho estreito (onde a mão direita fecha), barriga,
 * soleira emborrachada com frisos e olhal de bandoleira.
 */
export function buildShotgunStock(mats: ShotgunMaterialSet): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ShotgunStock';
  const add = createMeshAdder(group);

  // Perfil lateral da coronha inteira (do encontro com o receptor ao coice).
  const stockProfile: ReadonlyArray<readonly [number, number]> = [
    [0.196, 0.018],
    [0.196, -0.036],
    [0.232, -0.044],
    [0.268, -0.056],
    [0.300, -0.068],
    [0.360, -0.070],
    [0.430, -0.060],
    [0.452, -0.048],
    [0.452, 0.008],
    [0.392, 0.012],
    [0.330, 0.014],
    [0.286, 0.014],
    [0.246, 0.014],
  ];
  // Corpo da coronha também de flancos abaulados: com a coronha aparecendo em
  // 1ª pessoa, a chapa reta ficava evidente no canto da tela.
  add(extrudeProfile(stockProfile, 0.042, 0.011), mats.wood, [0, 0, 0]).name = 'StockWood';

  // Punho (empunhadura): um pouco mais estreito que a coronha, com checagem.
  // A seção é FORTEMENTE biselada (0,040 m de largura com bisel de 0,012):
  // o punho de uma escopeta real é um punho torneado arredondado, não uma
  // chapa de lados retos — e é essa seção que a mão da luva contorna.
  const gripProfile: ReadonlyArray<readonly [number, number]> = [
    [0.196, 0.014],
    [0.196, -0.028],
    [0.238, -0.036],
    [0.286, -0.042],
    [0.300, -0.038],
    [0.282, -0.004],
    [0.246, 0.010],
  ];
  add(extrudeProfile(gripProfile, 0.04, 0.007), mats.woodDark, [0, 0, 0]).name = 'GripWood';
  // Checagem: frisos cruzados um pouco mais largos que o punho, para marcar
  // a madeira sem virar uma chapa solta por cima dela.
  for (let i = 0; i < 6; i++) {
    const line = add(
      new THREE.BoxGeometry(0.0412, 0.030, 0.0022),
      mats.woodDark,
      [0, -0.028, 0.212 + i * 0.013],
      [0.28, 0, 0]
    );
    line.name = 'GripCheckering';
  }

  // Soleira de borracha com frisos e o olhal de bandoleira.
  add(extrudeProfile(
    [
      [0.452, 0.012],
      [0.476, 0.010],
      [0.478, -0.052],
      [0.452, -0.050],
    ],
    0.042,
    0.003
  ), mats.rubber, [0, 0, 0]).name = 'StockButtPad';
  for (let i = 0; i < 5; i++) {
    add(
      new THREE.BoxGeometry(0.0432, 0.0032, 0.0042),
      mats.cavity,
      [0, 0.004 - i * 0.011, 0.4662]
    );
  }
  add(
    new THREE.TorusGeometry(0.0075, 0.0018, 6, 12),
    mats.steelBright,
    [0, -0.062, 0.356],
    [0, Math.PI / 2, 0]
  );

  return group;
}

export interface ShotgunModel {
  /** Grupo raiz da arma no espaço canônico (ver comentário do arquivo). */
  readonly root: THREE.Group;
  /** Grupo do guarda-mão — desliza em Z a cada bombeada. */
  readonly pump: THREE.Group;
  /** Âncora da mão direita (punho da coronha), filha da raiz. */
  readonly gripAnchor: THREE.Object3D;
  /** Âncora da mão esquerda (guarda-mão), filha da bomba. */
  readonly pumpAnchor: THREE.Object3D;
  /** Âncora da boca do cano (clarão, som e feixe). */
  readonly muzzleAnchor: THREE.Object3D;
}

/**
 * Monta a escopeta completa no espaço canônico.
 *
 * A coronha faz parte da arma em qualquer situação — inclusive em 1ª pessoa,
 * onde o punho aparece no canto inferior direito da tela e o coice sai de
 * quadro. Sem ela a arma parecia um fuzil: só cano e receptor.
 */
export function buildShotgunModel(mats: ShotgunMaterialSet): ShotgunModel {
  const M = SHOTGUN_METRICS;
  const root = new THREE.Group();
  root.name = 'ShotgunModel';

  const barrel = buildShotgunBarrelAssembly(mats);
  const receiver = buildShotgunReceiver(mats);
  const stock = buildShotgunStock(mats);
  root.add(barrel, receiver, stock);

  const pump = buildShotgunForend(mats);
  pump.position.set(0, M.foreEndCenterY, M.foreEndCenterZ);
  root.add(pump);

  const gripAnchor = new THREE.Object3D();
  gripAnchor.name = 'WeaponGripAnchor';
  gripAnchor.position.set(0, M.gripAnchor.y, M.gripAnchor.z);
  gripAnchor.rotation.set(M.gripAnchor.pitchX, 0, 0);
  root.add(gripAnchor);

  const pumpAnchor = new THREE.Object3D();
  pumpAnchor.name = 'WeaponSupportAnchor';
  pumpAnchor.rotation.set(0, 0, M.pumpAnchor.rollZ);
  pump.add(pumpAnchor);

  const muzzleAnchor = new THREE.Object3D();
  muzzleAnchor.name = 'ShotgunMuzzleAnchor';
  muzzleAnchor.position.set(0, 0, M.muzzleZ);
  root.add(muzzleAnchor);

  return {
    root,
    pump,
    gripAnchor,
    pumpAnchor,
    muzzleAnchor,
  };
}

/* --------------------------------------------------------------------------
   Mãos enluvadas do Traje Biológico Nível-A
   --------------------------------------------------------------------------
   As mãos da arma em 1ª pessoa são as MESMAS luvas do personagem — não uma
   luva genérica. Nenhuma cor é inventada aqui: a luva é montada com o
   conjunto de materiais do traje (`createAstronautMaterials`), então a mão
   na tela e o braço do aliado em 3ª pessoa são literalmente a mesma peça:

     · borracha butílica preta fosca ......... `bootRubber`
     · anel carmim de vedação do punho ....... `anodizedCrimson`
     · mangote em polímero chartreuse ........ `astroCamo`

   As cotas seguem o rig do traje (`createAstronautArmRig`): punho de ~0,10 m
   de diâmetro, quatro dedos de ~0,058 m contornando a peça e polegar de dois
   segmentos cruzando por cima. É a anatomia do personagem, não a de uma mão
   qualquer.

   A luva é construída no mesmo referencial das âncoras (eixo do tubo = Z
   local), com a mesma convenção do rig do traje em 3ª pessoa:
     · mão direita  → palma no lado +X, dedos contornando por baixo até -X;
     · mão esquerda → imagem espelhada (palma no lado -X).
   Todos os raios derivam do raio do tubo agarrado, então a mão encosta na
   peça em vez de flutuar ao redor dela.
   -------------------------------------------------------------------------- */

export interface ShotgunGloveMaterials {
  /** Borracha butílica preta fosca da luva química (igual ao traje). */
  glove: THREE.Material;
  /** Anel carmim de vedação hermética do punho (igual ao traje). */
  cuff: THREE.Material;
  /** Mangote pressurizado em polímero chartreuse (igual ao traje). */
  sleeve: THREE.Material;
}

export interface ShotgunGloveOptions {
  side: 'right' | 'left';
  /** Raio horizontal do tubo agarrado (cano, guarda-mão ou punho da coronha). */
  radius: number;
  /**
   * Raio vertical do tubo agarrado. Quando ausente, vale o horizontal.
   *
   * Importa porque nenhuma das duas pegadas é redonda: o punho da coronha
   * tem 0,040 m de largura por ~0,056 m de altura e o guarda-mão é um oval
   * mais alto que largo. Fechar a mão num círculo fazia os dedos afundarem
   * na peça embaixo e flutuarem nas laterais — daí o contorno elíptico.
   */
  radiusY?: number;
  /**
   * Expoente do contorno: 2 fecha a mão numa elipse (guarda-mão oval) e
   * valores altos (8) num retângulo de quinas arredondadas (punho da coronha).
   */
  wrapExponent?: number;
  /** Escala geral da mão (1 = luva do traje em escala real). */
  scale?: number;
  /** Direção do mangote no referencial da luva. */
  sleeveDirection?: THREE.Vector3;
  /** Comprimento do mangote. */
  sleeveLength?: number;
}

/**
 * Luva do Traje Nível-A fechada em volta de um tubo (eixo Z local).
 * O resultado é filho da âncora correspondente da arma.
 */
export function buildShotgunGlove(
  mats: ShotgunGloveMaterials,
  options: ShotgunGloveOptions
): THREE.Group {
  const mirror = options.side === 'right' ? 1 : -1;
  const s = options.scale ?? 1;
  const R = options.radius;
  const RY = options.radiusY ?? options.radius;
  const N = Math.max(2, options.wrapExponent ?? 2);
  const fingerR = 0.0090 * s;
  const glove = new THREE.Group();
  glove.name = `ShotgunGlove_${options.side}`;

  /**
   * Ponto a `extra` metros da superfície da peça, no ângulo dado
   * (0 = lado da palma).
   *
   * O contorno é uma SUPERELIPSE inflada ao longo da própria normal: com
   * expoente 2 ela é a elipse do guarda-mão, e com expoente alto ela vira o
   * retângulo de quinas arredondadas que o punho da coronha realmente é
   * (0,040 × 0,060 m). Fechar a mão num círculo — ou mesmo numa elipse —
   * deixava os dedos cruzando a madeira nas quinas e soltos nas faces.
   */
  const surface = (angle: number, extra: number, z: number): THREE.Vector3 => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const px = R * Math.sign(cos) * Math.abs(cos) ** (2 / N);
    const py = -RY * Math.sign(sin) * Math.abs(sin) ** (2 / N);
    // Normal externa: gradiente de (|x|/R)^N + (|y|/RY)^N.
    let nx = ((Math.abs(px) / R) ** (N - 1) * Math.sign(px)) / R;
    let ny = ((Math.abs(py) / RY) ** (N - 1) * Math.sign(py)) / RY;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    return new THREE.Vector3(mirror * (px + nx * extra), py + ny * extra, z);
  };

  /**
   * Ângulos que dividem o arco [de, até] em `parts` trechos de MESMO
   * COMPRIMENTO. Com o contorno retangular, ângulos iguais amontoam as
   * articulações nas quinas; distribuir por comprimento de arco espalha os
   * nós do dedo como numa mão de verdade.
   */
  const spreadAngles = (from: number, to: number, parts: number): number[] => {
    const steps = 96;
    const lengths: number[] = [0];
    let total = 0;
    let prev = surface(from, 0, 0);
    for (let i = 1; i <= steps; i++) {
      const p = surface(from + ((to - from) * i) / steps, 0, 0);
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
      lengths.push(total);
      prev = p;
    }
    const out: number[] = [from];
    for (let k = 1; k <= parts; k++) {
      const target = (total * k) / parts;
      let i = 1;
      while (i < lengths.length && lengths[i] < target) i++;
      const before = lengths[i - 1];
      const span = lengths[i] - before || 1;
      out.push(from + ((to - from) * (i - 1 + (target - before) / span)) / steps);
    }
    return out;
  };

  // ---- Palma e dorso -------------------------------------------------------
  // Bloco achatado encostado no tubo do lado da palma: a face interna fica
  // exatamente sobre a superfície da peça (raio R), sem penetrar nem pairar.
  // É o equivalente à concha metacarpiana do rig do traje (0,042 × 0,066 ×
  // 0,076 m), achatada contra a peça agarrada.
  const palmThickness = 0.021 * s;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(palmThickness * 2, 0.058 * s, 0.070 * s), mats.glove);
  palm.position.copy(surface(0, palmThickness, 0.006 * s));
  palm.rotation.set(0, 0, mirror * 0.08);
  glove.add(palm);
  // Dorso da mão: mesmo bloco de borracha, sem almofada de outra cor — no
  // traje a luva é uniforme, do punho à ponta dos dedos.
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(palmThickness * 0.95, 0.052 * s, 0.064 * s),
    mats.glove
  );
  back.position.copy(surface(0, palmThickness * 1.9, 0.010 * s));
  back.rotation.set(0, 0, mirror * 0.08);
  glove.add(back);

  // ---- Quatro dedos contornando o tubo ------------------------------------
  // Cada dedo nasce na base da palma (25°), passa por baixo (90°) e sobe
  // pelo lado oposto (170°): é esse arco que faz a mão agarrar a peça.
  // Comprimento total ~0,058 m por dedo, como no rig do traje.
  const fingerSpanZ = 0.0195 * s;
  const sweeps: Array<readonly number[]> = [
    [0.52, 0.50, 0.44, 0.34],
    [0.54, 0.52, 0.44, 0.32],
    [0.50, 0.48, 0.42, 0.30],
    [0.44, 0.42, 0.36, 0.26],
  ];
  for (let f = 0; f < 4; f++) {
    const z = (f - 1.5) * fingerSpanZ;
    // A linha de centro dos dedos passa a um raio do dedo da superfície: o
    // arco encosta na peça em vez de atravessá-la. O desconto ao longo do
    // dedo acompanha o afinamento natural até a ponta.
    const seg = sweeps[f];
    // As juntas caem em pontos igualmente espaçados ao longo do contorno, não
    // em ângulos iguais: é o que mantém as falanges do mesmo tamanho.
    const angles = spreadAngles(0.3, 0.3 + seg.reduce((a, b) => a + b, 0), seg.length);
    const joints = angles.map((angle, i) =>
      surface(angle, fingerR * 1.12 - (i / seg.length) * fingerR * 0.45, z - mirror * 0.0006 * i)
    );
    for (let i = 0; i < joints.length - 1; i++) {
      capsuleBetween(glove, joints[i], joints[i + 1], fingerR * (1 - i * 0.055), mats.glove);
    }
    const start = joints[0];
    const mid = joints[2];
    const tip = joints[joints.length - 1];
    // Nó do dedo na base e a articulação do meio: borracha, como no traje —
    // a luva química não tem anéis metálicos aparentes.
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(fingerR * 1.08, 10, 8), mats.glove);
    knuckle.position.copy(start);
    glove.add(knuckle);
    const midJoint = new THREE.Mesh(new THREE.SphereGeometry(fingerR * 0.94, 8, 6), mats.glove);
    midJoint.position.copy(mid);
    glove.add(midJoint);
    // Ponta arredondada encostando na peça.
    const tipCap = new THREE.Mesh(new THREE.SphereGeometry(fingerR * 0.82, 8, 6), mats.glove);
    tipCap.position.copy(tip);
    glove.add(tipCap);
  }

  // ---- Polegar cruzando por cima ------------------------------------------
  // Nasce na palma, sobe pelo dorso do tubo e desce do outro lado. Dois
  // segmentos, como o polegar do rig do traje.
  const thumbR = fingerR * 1.24;
  const thumbAngles = spreadAngles(-0.45, -2.15, 3);
  const thumbZ = [-0.024, -0.038, -0.047, -0.052];
  const thumbPads = [thumbR * 1.3, thumbR * 1.4, thumbR * 1.3, thumbR * 1.05];
  const [thumbA, thumbB, thumbC, thumbD] = thumbAngles.map((angle, i) =>
    surface(angle, thumbPads[i], thumbZ[i] * s)
  );
  capsuleBetween(glove, thumbA, thumbB, thumbR, mats.glove);
  capsuleBetween(glove, thumbB, thumbC, thumbR * 0.92, mats.glove);
  capsuleBetween(glove, thumbC, thumbD, thumbR * 0.8, mats.glove);
  const thumbJoint = new THREE.Mesh(new THREE.SphereGeometry(thumbR * 1.06, 10, 8), mats.glove);
  thumbJoint.position.copy(thumbB);
  glove.add(thumbJoint);

  // ---- Punho, anel carmim de vedação e mangote chartreuse -----------------
  // A sequência é a do traje: borracha preta → anel carmim → manga amarela.
  const sleeveDir = (options.sleeveDirection ?? new THREE.Vector3(0.42, -0.86, 0.30))
    .clone()
    .normalize();
  sleeveDir.x *= mirror;
  const sleeveQuat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    sleeveDir
  );
  const wristStart = surface(-0.35, palmThickness * 0.9, 0.030 * s);
  const wristEnd = wristStart.clone().addScaledVector(sleeveDir, 0.046 * s);
  capsuleBetween(glove, wristStart, wristEnd, 0.047 * s, mats.glove);

  // Anel liso de travamento hermético — a mesma peça carmim do punho do traje.
  const sealRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0565 * s, 0.0545 * s, 0.021 * s, 14),
    mats.cuff
  );
  sealRing.position.copy(wristEnd);
  sealRing.quaternion.copy(sleeveQuat);
  glove.add(sealRing);

  // Mangote pressurizado: afunila do punho para o cotovelo (0,055 → 0,068 m),
  // exatamente como a manga do antebraço do personagem.
  const sleeveLength = options.sleeveLength ?? 0.2;
  const sleeveStart = wristEnd.clone().addScaledVector(sleeveDir, 0.013 * s);
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.068 * s, 0.055 * s, sleeveLength, 12),
    mats.sleeve
  );
  sleeve.position.copy(sleeveStart).addScaledVector(sleeveDir, sleeveLength / 2);
  sleeve.quaternion.copy(sleeveQuat);
  glove.add(sleeve);

  return glove;
}
