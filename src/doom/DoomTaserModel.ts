import * as THREE from 'three';

/**
 * Corpo do Taser de contenção (modelo 3D compartilhado).
 *
 * A mesma peça aparece em três lugares — equipado na mão direita
 * (`DoomTaserViewmodel`), recém-recuperado na luva esquerda
 * (`DoomFlashlight`) e largado dentro do caixote (`DoomWorldItems`) — então a
 * geometria mora aqui e cada cena só fornece os seus próprios materiais
 * (shader DOOM no mundo, Lambert iluminado nas cenas em 1ª pessoa).
 *
 * Referência: a boca dos eletrodos aponta para -Z, o topo do casco para +Y e
 * a largura (±25 mm) corre em X. A origem fica na traseira do casco, na altura
 * do eixo do cano, que é exatamente onde a empunhadura se apoia na luva.
 */

export const TASER_COLORS = {
  shell: 0xe0b02c,
  shellShade: 0xc5941f,
  graphite: 0x2b2f33,
  gloveDark: 0x1b1f22,
  rubber: 0x191c1f,
  steel: 0xb4bfc6,
  steelDark: 0x6d787f,
  brass: 0xc7a253,
  ceramic: 0xcfd2c9,
  glass: 0x1d3a41,
  led: 0x8ef4ff,
  green: 0x63ff9b,
  strap: 0x4a4232,
} as const;

export function extrudeSideProfile(
  profile: ReadonlyArray<readonly [number, number]>,
  width: number,
  bevel: number
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.002, width - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, (width - bevel * 2) / 2);
  geometry.rotateY(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Bloco com cantos arredondados e chanfros — peças de polímero fundido. */
export function beveledBox(width: number, height: number, depth: number, radius: number): THREE.ExtrudeGeometry {
  const x = width / 2 - radius;
  const y = height / 2 - radius;
  const shape = new THREE.Shape();
  shape.moveTo(-x, -y - radius);
  shape.lineTo(x, -y - radius);
  shape.quadraticCurveTo(x + radius, -y - radius, x + radius, -y);
  shape.lineTo(x + radius, y);
  shape.quadraticCurveTo(x + radius, y + radius, x, y + radius);
  shape.lineTo(-x, y + radius);
  shape.quadraticCurveTo(-x - radius, y + radius, -x - radius, y);
  shape.lineTo(-x - radius, -y);
  shape.quadraticCurveTo(-x - radius, -y - radius, -x, -y - radius);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.002, depth - 0.006),
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.0025,
    bevelSegments: 2,
    curveSegments: 3,
    steps: 1,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

/** Textura procedural de plástico injetado: grão fino + marcas de molde. */
export function createShellTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Grão determinístico (sem Math.random, o viewmodel é recriado a cada partida).
      const grain = ((x * 73 + y * 151 + ((x * y) % 17) * 31) % 23) - 11;
      // Costura de molde vertical a cada 16 px.
      const seam = x % 16 === 0 ? -16 : x % 16 === 1 ? 7 : 0;
      const v = Math.max(140, Math.min(255, 214 + grain + seam));
      data[i] = v;
      data[i + 1] = Math.max(140, Math.min(255, v - 2));
      data[i + 2] = Math.max(120, Math.min(255, v - 26));
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Textura de empunhadura emborrachada com losangos em relevo. */
export function createGripTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const diamond = (x + y) % 8 < 4 === ((x - y + 64) % 8 < 4);
      const edge = x % 8 === 0 || y % 8 === 0 ? -22 : 0;
      const v = Math.max(60, Math.min(200, (diamond ? 168 : 122) + edge));
      data[i] = v;
      data[i + 1] = v + 2;
      data[i + 2] = v + 4;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Plaquinha estampada: fundo escuro com "texto" de traços claros. */
export function createLabelTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const words: Array<[number, number, number]> = [
    [8, 10, 12],
    [8, 18, 9],
    [8, 25, 6],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let ink = 0;
      for (const [startX, row, len] of words) {
        if (Math.abs(y - row) <= 1 && x >= startX && x < startX + len && (x + row) % 3 !== 0) {
          ink = 1;
        }
      }
      const v = ink ? 206 : 34;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = ink ? 196 : 36;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Pistola de contenção elétrica (taser) em primeira e terceira pessoa.
 *
 * Modelagem no tamanho real de um equipamento de contenção (~28 cm): casco de
 * polímero amarelo com silhueta extrudada e chanfros de injeção, chassi interno
 * em grafite, empunhadura emborrachada com textura em relevo, guarda-mato,
 * gatilho articulado, trava de segurança, janela de carga com mostrador e LEDs,
 * baioneta dianteira com dois eletrodos de cerâmica/aço/latão e a porta de
 * descarga (blast door) entre eles.
 *
 * A arma é segurada por uma luva articulada: palma, quatro dedos em dois
 * segmentos, polegar apoiado na lateral do chassi e o punho do traje saindo do
 * quadro. Os dedos fecham junto com o gatilho no disparo.
 */

export interface TaserBodyMaterials {
  /** Casco injetado (amarelo de segurança). */
  shell: THREE.Material;
  /** Mesmo casco em tom mais fechado (tampa traseira, trilho, ressaltos). */
  shellShade: THREE.Material;
  /** Chassi de grafite: bloco do gatilho, guarda-mato, cartucho dianteiro. */
  graphite: THREE.Material;
  /** Empunhadura emborrachada. */
  rubber: THREE.Material;
  /** Anéis de aderência e reforços escuros da empunhadura. */
  gloveDark: THREE.Material;
  /** Aço claro (eletrodos, parafusos, massa de mira). */
  steel: THREE.Material;
  /** Aço fosco (arcos, travas, base da célula). */
  steelDark: THREE.Material;
  /** Contatos e barbelas de latão. */
  brass: THREE.Material;
  /** Isoladores cerâmicos dos eletrodos. */
  ceramic: THREE.Material;
  /** Janela translúcida da carga. */
  glass: THREE.Material;
  /** Faixa de advertência amarela/preta. */
  strap: THREE.Material;
  /** Plaqueta de série/advertência. */
  label: THREE.Material;
}

export interface TaserBody {
  /** Grupo com todas as peças do corpo da arma. */
  readonly group: THREE.Group;
  /** Gatilho articulado (gira no disparo). */
  readonly trigger: THREE.Group;
  /** Trava de segurança (gira ao engatilhar). */
  readonly safetyLever: THREE.Group;
  /** Empunhadura, com a base da célula. */
  readonly grip: THREE.Group;
  /** Lâmpada do LED de carga. */
  readonly ledBulb: THREE.Mesh;
  /** Material do mostrador (muda de cor com a carga). */
  readonly displayMaterial: THREE.MeshBasicMaterial;
  /** Pontas dos dois eletrodos, no espaço de `group`. */
  readonly prongTips: THREE.Vector3[];
}

/** Comprimento do casco, da traseira até a boca dos eletrodos (m). */
export const TASER_BODY_FRONT = 0.176;

/** Paleta Lambert usada nas cenas em 1ª pessoa (mesmo visual nas duas mãos). */
export function createTaserLambertMaterials(): TaserBodyMaterials {
  const shellTex = createShellTexture();
  shellTex.repeat.set(3, 2);
  const gripTex = createGripTexture();
  gripTex.repeat.set(2, 3);
  const labelTex = createLabelTexture();
  return {
    shell: new THREE.MeshLambertMaterial({
      color: TASER_COLORS.shell,
      map: shellTex,
      flatShading: true,
    }),
    shellShade: new THREE.MeshLambertMaterial({
      color: TASER_COLORS.shellShade,
      flatShading: true,
    }),
    graphite: new THREE.MeshLambertMaterial({
      color: TASER_COLORS.graphite,
      flatShading: true,
    }),
    rubber: new THREE.MeshLambertMaterial({
      color: TASER_COLORS.rubber,
      map: gripTex,
      flatShading: true,
    }),
    gloveDark: new THREE.MeshLambertMaterial({
      color: TASER_COLORS.gloveDark,
      flatShading: true,
    }),
    steel: new THREE.MeshLambertMaterial({ color: TASER_COLORS.steel }),
    steelDark: new THREE.MeshLambertMaterial({ color: TASER_COLORS.steelDark }),
    brass: new THREE.MeshLambertMaterial({ color: TASER_COLORS.brass }),
    ceramic: new THREE.MeshLambertMaterial({
      color: TASER_COLORS.ceramic,
      flatShading: true,
    }),
    glass: new THREE.MeshLambertMaterial({
      color: TASER_COLORS.glass,
      emissive: 0x0b2e36,
      transparent: true,
      opacity: 0.78,
      flatShading: true,
    }),
    strap: new THREE.MeshLambertMaterial({ color: TASER_COLORS.strap }),
    label: new THREE.MeshLambertMaterial({ map: labelTex }),
  };
}

/**
 * Monta o corpo do Taser de contenção: casco com perfil real de pistola de
 * contenção, chassi, janela de carga, mostrador, empunhadura emborrachada e
 * cartucho dianteiro com os dois eletrodos.
 */
export function buildTaserBody(mats: TaserBodyMaterials): TaserBody {
  const group = new THREE.Group();
  group.name = 'TaserBodyRig';

  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0],
    parent: THREE.Object3D = group
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    parent.add(mesh);
    return mesh;
  };

  const {
    shell: shellMat,
    shellShade: shellShadeMat,
    graphite: graphiteMat,
    rubber: rubberMat,
    gloveDark: gloveDarkMat,
    steel: steelMat,
    steelDark: steelDarkMat,
    brass: brassMat,
    ceramic: ceramicMat,
    glass: glassMat,
    strap: strapMat,
    label: labelMat,
  } = mats;

  // 1. CASCO PRINCIPAL — perfil real de pistola de contenção
  // ======================================================================
  // Perfil lateral mapeado a partir de equipamentos reais (Piexon/X26):
  // traseira baixa com a janela de carga no topo, dorso subindo até a frente,
  // bico inclinado onde ficam os eletrodos e o ressalto do guarda-mato embaixo.
  // Colunas: 0 = avanço desde a traseira, 1 = altura em torno do eixo do cano.
  const SHELL_FRONT = 0.176;
  const shellProfile: ReadonlyArray<readonly [number, number]> = [
    [0.0, -0.012],
    [0.0, 0.026],
    [0.012, 0.036],
    [0.07, 0.036],
    [0.082, 0.042],
    [0.132, 0.042],
    [0.146, 0.03],
    [0.168, -0.006],
    [0.176, -0.026],
    [0.166, -0.036],
    [0.13, -0.04],
    [0.062, -0.04],
    [0.05, -0.03],
    [0.024, -0.03],
    [0.006, -0.026],
  ];
  const shell = new THREE.Mesh(extrudeSideProfile(shellProfile, 0.05, 0.0035), shellMat);
  shell.name = 'TaserShellUpper';
  group.add(shell);

  // Chassi de grafite: bloco do gatilho, guarda-mato e a ponte onde a
  // empunhadura se prende. É mais estreito que o casco e aparece nas laterais.
  const frameProfile: ReadonlyArray<readonly [number, number]> = [
    [0.012, -0.074],
    [0.098, -0.074],
    [0.106, -0.062],
    [0.106, -0.036],
    [0.012, -0.036],
    [0.004, -0.05],
  ];
  const frame = new THREE.Mesh(extrudeSideProfile(frameProfile, 0.036, 0.0025), graphiteMat);
  frame.name = 'TaserFrame';
  group.add(frame);

  // Tampa traseira (compartimento da célula) com dois parafusos prisioneiros.
  const backCap = new THREE.Mesh(extrudeSideProfile([
    [-0.008, -0.014],
    [-0.008, 0.028],
    [0.002, 0.032],
    [0.002, -0.02],
  ], 0.044, 0.0025), shellShadeMat);
  backCap.position.set(0, 0.002, 0.004);
  group.add(backCap);
  for (const sy of [0.024, -0.012]) {
    for (const sx of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.004, 8), steelDarkMat, [sx * 0.014, sy, 0.008], [Math.PI / 2, 0, 0]);
    }
  }
  // Trava de ejeção da célula, na traseira inferior.
  add(beveledBox(0.024, 0.009, 0.016, 0.003), steelDarkMat, [0, -0.024, 0.006]);

  // Cristas serrilhadas do carregador (engatilhar) no dorso traseiro.
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(0.028, 0.004, 0.0035), graphiteMat, [0, 0.039, -0.086 - i * 0.007]);
  }

  // ======================================================================
  // 2. PAINEL LATERAL ESQUERDO — mostrador, LEDs e plaqueta de série
  // ======================================================================
  const panelZ = -0.092;
  add(beveledBox(0.012, 0.026, 0.05, 0.004), graphiteMat, [-0.022, 0.006, panelZ]);
  add(beveledBox(0.007, 0.022, 0.036, 0.002), steelDarkMat, [-0.027, 0.008, panelZ]);
  const displayMaterial = new THREE.MeshBasicMaterial({ color: 0x0d2a30 });
  add(new THREE.PlaneGeometry(0.032, 0.018), displayMaterial, [-0.0312, 0.008, panelZ], [0, -Math.PI / 2, 0]);
  // Barras de carga do mostrador.
  add(new THREE.PlaneGeometry(0.022, 0.0035), new THREE.MeshBasicMaterial({ color: 0x6ee6ff, transparent: true, opacity: 0.85 }), [-0.0322, 0.012, panelZ]);
  add(new THREE.PlaneGeometry(0.014, 0.0028), new THREE.MeshBasicMaterial({ color: 0x45d693, transparent: true, opacity: 0.7 }), [-0.0322, 0.004, panelZ]);
  // LEDs: carga pronta (azul) e descarga (verde), com a luz real do painel.
  const ledBulb = add(new THREE.SphereGeometry(0.0034, 8, 6), new THREE.MeshBasicMaterial({ color: TASER_COLORS.led }), [-0.028, 0.026, panelZ - 0.014]);
  ledBulb.name = 'TaserChargeLed';
  add(new THREE.SphereGeometry(0.0025, 8, 6), new THREE.MeshBasicMaterial({ color: TASER_COLORS.green }), [-0.028, 0.026, panelZ + 0.006]);

  // Plaqueta estampada (modelo/série) na lateral do chassi.
  add(new THREE.PlaneGeometry(0.028, 0.012), labelMat, [-0.0255, -0.052, -0.055], [0, -Math.PI / 2, 0]);

  // Lado direito (o que a câmera vê): costura de injeção, grelha de
  // ventilação, plaqueta de advertência e parafusos de fixação.
  add(new THREE.BoxGeometry(0.0024, 0.032, 0.116), shellShadeMat, [0.0246, 0.004, -0.09]);
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.0028, 0.015, 0.005), graphiteMat, [0.025, 0.008, -0.15 - i * 0.009]);
  }
  add(beveledBox(0.006, 0.014, 0.032, 0.003), shellShadeMat, [0.025, -0.024, -0.055]);
  add(new THREE.PlaneGeometry(0.03, 0.013), labelMat, [0.0247, -0.012, -0.098], [0, Math.PI / 2, 0]);
  for (const off of [-0.032, 0.014]) {
    add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0035, 6), steelDarkMat, [0.0252, 0.03, off], [0, 0, Math.PI / 2]);
  }
  // Ressalto de pega sob o polegar, com serrilha antiderrapante.
  for (let i = 0; i < 3; i++) {
    add(new THREE.BoxGeometry(0.006, 0.0035, 0.02), shellShadeMat, [0.025, -0.03 + i * 0.006, -0.03]);
  }

  // Janela de carga translúcida no dorso, com a célula de íon e contatos de latão.
  add(beveledBox(0.03, 0.012, 0.056, 0.004), steelDarkMat, [0, 0.038, -0.048]);
  add(beveledBox(0.024, 0.008, 0.048, 0.003), glassMat, [0, 0.042, -0.048]);
  for (let i = 0; i < 3; i++) {
    add(new THREE.CylinderGeometry(0.0032, 0.0032, 0.044, 8), brassMat, [0, 0.039, -0.068 + i * 0.02], [Math.PI / 2, 0, 0]);
  }

  // Faixa de advertência amarela/preta na lateral dianteira.
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.0026, 0.011, 0.0065), i % 2 === 0 ? strapMat : graphiteMat, [-0.0252, -0.012, -0.132 - i * 0.007]);
  }

  // ======================================================================
  // 3. CONTROLES — trava de segurança e gatilho articulado
  // ======================================================================
  const safetyLever = new THREE.Group();
  safetyLever.position.set(-0.024, 0.016, -0.03);
  group.add(safetyLever);
  add(beveledBox(0.005, 0.007, 0.019, 0.002), steelDarkMat, [0, 0, 0], [0, 0, 0], safetyLever);
  add(new THREE.BoxGeometry(0.0035, 0.004, 0.005), brassMat, [-0.002, 0.005, 0.004], [0, 0, 0], safetyLever);

  // Guarda-mato: arco de aço fundido sob o chassi.
  add(new THREE.TorusGeometry(0.023, 0.004, 6, 16, Math.PI * 1.1), graphiteMat, [0, -0.07, -0.052], [0, Math.PI / 2, Math.PI * 0.4]);
  add(new THREE.BoxGeometry(0.032, 0.007, 0.007), graphiteMat, [0, -0.077, -0.026]);

  const trigger = new THREE.Group();
  trigger.position.set(0, -0.062, -0.05);
  group.add(trigger);
  add(beveledBox(0.007, 0.022, 0.006, 0.002), steelDarkMat, [0, -0.011, 0.001], [0.24, 0, 0], trigger);

  // ======================================================================
  // 4. EMPUNHADURA — emborrachada com textura em relevo e base da bateria
  // ======================================================================
  const grip = new THREE.Group();
  grip.name = 'TaserGrip';
  grip.position.set(0, -0.058, -0.03);
  grip.rotation.x = 0.22;
  group.add(grip);

  const gripBody = new THREE.Mesh(beveledBox(0.04, 0.104, 0.05, 0.012), rubberMat);
  gripBody.position.set(0, -0.046, 0.002);
  grip.add(gripBody);
  // Lombada traseira (encosto da palma), mais espessa embaixo.
  const gripBack = new THREE.Mesh(extrudeSideProfile([
    [0.0, 0.008],
    [0.019, 0.0],
    [0.023, -0.03],
    [0.02, -0.086],
    [0.004, -0.092],
    [0.0, -0.06],
  ], 0.032, 0.005), rubberMat);
  gripBack.position.set(0, 0.0, 0.028);
  grip.add(gripBack);
  // Anéis de aderência envolvendo a frente da empunhadura.
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0205, 0.0021, 5, 12, Math.PI * 1.05), gloveDarkMat);
    ring.rotation.set(Math.PI / 2, 0, Math.PI * 0.475);
    ring.position.set(0, -0.016 - i * 0.023, 0.002);
    grip.add(ring);
  }
  // Base da célula + trava + cordão de segurança.
  const base = new THREE.Mesh(beveledBox(0.038, 0.016, 0.046, 0.005), graphiteMat);
  base.position.set(0, -0.106, 0.006);
  grip.add(base);
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.007, 0.007), steelDarkMat);
  latch.position.set(0, -0.1, -0.016);
  grip.add(latch);
  const lanyard = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0016, 5, 10), steelDarkMat);
  lanyard.rotation.x = Math.PI / 2;
  lanyard.position.set(0, -0.112, 0.022);
  grip.add(lanyard);

  // ======================================================================
  // 5. BAIONETA DIANTEIRA — corpo do cartucho e eletrodos
  // ======================================================================
  const bay = new THREE.Group();
  bay.position.set(0, -0.006, -SHELL_FRONT + 0.004);
  group.add(bay);
  const bayBody = new THREE.Mesh(beveledBox(0.044, 0.04, 0.046, 0.008), graphiteMat);
  bayBody.position.set(0, 0.004, -0.02);
  bay.add(bayBody);
  // Fendas de ventilação no topo do cartucho.
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.0028, 0.0035), steelDarkMat);
    vent.position.set(0, 0.022, -0.038 - i * 0.008);
    bay.add(vent);
  }
  // Travas laterais de liberação rápida.
  for (const sx of [-1, 1]) {
    const release = new THREE.Mesh(beveledBox(0.004, 0.012, 0.011, 0.002), steelDarkMat);
    release.position.set(sx * 0.022, 0.0, -0.02);
    bay.add(release);
  }
  // Placa frontal de fixação dos eletrodos.
  const facePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.007, 12), steelDarkMat);
  facePlate.rotation.x = Math.PI / 2;
  facePlate.position.set(0, 0.002, -0.044);
  bay.add(facePlate);
  // Porta de descarga (blast door) entre as hastes, com dois parafusos.
  const door = new THREE.Mesh(beveledBox(0.026, 0.028, 0.005, 0.003), graphiteMat);
  door.position.set(0, -0.006, -0.046);
  bay.add(door);
  for (const sx of [-1, 1]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.003, 6), steelMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(sx * 0.009, 0.004, -0.05);
    bay.add(screw);
  }

  // Eletrodos: isolador cerâmico, haste de aço e barbela de latão.
  const prongTips: THREE.Vector3[] = [];
  for (const side of [-1, 1]) {
    const prong = new THREE.Group();
    prong.position.set(side * 0.012, 0.002, -0.048);
    prong.rotation.y = side * -0.11;
    bay.add(prong);

    const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.0078, 0.0092, 0.016, 10), ceramicMat);
    insulator.rotation.x = Math.PI / 2;
    insulator.position.set(0, 0, -0.006);
    prong.add(insulator);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0078, 0.001, 5, 10), steelDarkMat);
      ring.position.set(0, 0, -0.002 - i * 0.008);
      prong.add(ring);
    }
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.003, 0.042, 8), steelMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, -0.032);
    prong.add(shaft);
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.0038, 0.008, 8), brassMat);
    barb.rotation.x = -Math.PI / 2;
    barb.position.set(0, 0, -0.056);
    prong.add(barb);

    const tip = new THREE.Vector3(0, 0, -0.06).applyEuler(prong.rotation).add(prong.position);
    prongTips.push(tip.clone().add(bay.position));
  }

  // ======================================================================
  // 6. MIRA — alça traseira com entalhe e massa de mira dianteira
  // ======================================================================
  add(new THREE.BoxGeometry(0.014, 0.005, 0.044), graphiteMat, [0, 0.04, -0.05]);
  for (const sx of [-1, 1]) {
    add(beveledBox(0.005, 0.008, 0.007, 0.001), steelDarkMat, [sx * 0.005, 0.045, -0.032]);
  }
  add(new THREE.BoxGeometry(0.0035, 0.01, 0.004), steelMat, [0, 0.046, -0.128]);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.003, 0.006, 0.028), shellShadeMat, [sx * 0.0185, 0.04, -0.104]);
  }

  return {
    group,
    trigger,
    safetyLever,
    grip,
    ledBulb,
    displayMaterial,
    prongTips,
  };
}
