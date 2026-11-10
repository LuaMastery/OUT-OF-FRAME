import * as THREE from 'three';
import { computeAdaptiveVerticalFov } from './DoomTouchControls';

export const TASER_ITEM_ID = 'field_taser';
/** Effective range to the spider's surface, in metres. */
export const TASER_RANGE = 8;
/** A discharge immobilises the spider without hurting it or interrupting a capture. */
export const TASER_STUN_SECONDS = 5;
/** The integrated cell automatically recharges; a missed discharge also consumes a charge. */
export const TASER_RECHARGE_SECONDS = 9;

/** Recharge follows simulation time, so pausing a solo game also pauses the cell. */
export function advanceTaserRecharge(remaining: number, dt: number): number {
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.max(0, remaining - (Number.isFinite(dt) ? Math.max(0, dt) : 0));
}

/** Short-range line of sight test against the same physical colliders as the shotgun. */
export function taserImpactDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  target: THREE.Vector3,
  obstacles: readonly THREE.Box3[]
): number | null {
  if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.0001) return null;
  const ray = new THREE.Ray(origin, direction.clone().normalize());
  const hit = ray.intersectSphere(new THREE.Sphere(target, 1.05), new THREE.Vector3());
  if (!hit) return null;
  const distance = origin.distanceTo(hit);
  if (distance > TASER_RANGE) return null;
  for (const box of obstacles) {
    const obstruction = ray.intersectBox(box, new THREE.Vector3());
    if (obstruction && origin.distanceTo(obstruction) < distance - 0.02) return null;
  }
  return distance;
}

/** Paleta física do equipamento de contenção. */
const TASER_COLORS = {
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

/** Segmentos de arco elétrico gerados em torno do eixo dos eletrodos. */
export function buildTaserArcSegments(
  from: THREE.Vector3,
  to: THREE.Vector3,
  seed = 1
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [from.clone()];
  const segments = 7;
  let s = seed;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const dir = new THREE.Vector3().subVectors(to, from);
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const jitter = 0.022 * Math.sin(t * Math.PI);
    points.push(
      new THREE.Vector3(
        from.x + dir.x * t + (rand() - 0.5) * jitter * 2,
        from.y + dir.y * t + (rand() - 0.5) * jitter * 2 + Math.sin(t * Math.PI) * 0.012,
        from.z + dir.z * t + (rand() - 0.5) * jitter * 2
      )
    );
  }
  points.push(to.clone());
  return points;
}

// ============================================================================
// GEOMETRIA: perfis e corpos chanfrados
// ============================================================================

/**
 * Extruda um perfil lateral (silhueta vista de lado) na largura informada.
 *
 * O perfil é dado em `(avanço, altura)`, com `avanço` medido a partir da traseira
 * da arma e `altura` em torno do eixo do cano. O resultado já sai orientado para
 * o espaço da arma: avanço cresce para -Z, largura centrada em X.
 *
 * É o que dá à peça o contorno de plástico injetado de verdade — em vez de
 * caixas retangulares empilhadas.
 */
function extrudeSideProfile(
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
function beveledBox(width: number, height: number, depth: number, radius: number): THREE.ExtrudeGeometry {
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
function createShellTexture(): THREE.DataTexture {
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
function createGripTexture(): THREE.DataTexture {
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
function createLabelTexture(): THREE.DataTexture {
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
export class DoomTaserViewmodel {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;
  /** Enquadramento geral na tela (balanço, recuo, escorregada). */
  private readonly root = new THREE.Group();
  /** Peças da arma que se movem juntas (recuo e tremor do disparo). */
  private readonly gunGroup = new THREE.Group();
  private readonly handGroup = new THREE.Group();
  private readonly fingerJoints: THREE.Group[] = [];
  private readonly arc: THREE.Line;
  private readonly arcGlow: THREE.Line;
  private readonly muzzleLight: THREE.PointLight;
  private readonly ledBulb: THREE.Mesh;
  private readonly ledLight: THREE.PointLight;
  private readonly displayMaterial: THREE.MeshBasicMaterial;
  private readonly trigger: THREE.Group;
  private readonly safetyLever: THREE.Group;
  private equipped = false;
  private progress = 0;
  private flashTime = 0;
  private chargeTime = 0;
  private recoilTime = 0;
  private arcSeed = 1;
  private handSign: 1 | -1 = 1;
  private swayX = 0;
  private swayY = 0;
  private readonly arcPoints: THREE.Vector3[] = [];

  constructor(aspect: number) {
    this.viewCamera = new THREE.PerspectiveCamera(
      computeAdaptiveVerticalFov(aspect, 56, 76),
      aspect,
      0.02,
      5
    );

    // Iluminação de estúdio: luz-chave quente à frente/esquerda, preenchimento
    // azulado frio e um contraluz que recorta a silhueta contra o corredor.
    this.viewScene.add(new THREE.AmbientLight(0x8ea4b6, 0.62));
    const key = new THREE.DirectionalLight(0xfff0d2, 1.05);
    key.position.set(-1.05, 1.7, 1.25);
    this.viewScene.add(key);
    const fill = new THREE.DirectionalLight(0x86b3d8, 0.42);
    fill.position.set(1.5, 0.35, -0.85);
    this.viewScene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.5);
    rim.position.set(0.9, -0.6, 1.4);
    this.viewScene.add(rim);

    const shellTex = createShellTexture();
    shellTex.repeat.set(3, 2);
    const gripTex = createGripTexture();
    gripTex.repeat.set(2, 3);
    const labelTex = createLabelTexture();

    const shellMat = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.shell,
      map: shellTex,
      flatShading: true,
    });
    const shellShadeMat = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.shellShade,
      flatShading: true,
    });
    const graphiteMat = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.graphite,
      flatShading: true,
    });
    const rubberMat = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.rubber,
      map: gripTex,
      flatShading: true,
    });
    const steelMat = new THREE.MeshLambertMaterial({ color: TASER_COLORS.steel });
    const steelDarkMat = new THREE.MeshLambertMaterial({ color: TASER_COLORS.steelDark });
    const brassMat = new THREE.MeshLambertMaterial({ color: TASER_COLORS.brass });
    const ceramicMat = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.ceramic,
      flatShading: true,
    });
    const glassMat = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.glass,
      emissive: 0x0b2e36,
      transparent: true,
      opacity: 0.78,
      flatShading: true,
    });
    const gloveDarkMat = new THREE.MeshLambertMaterial({
      color: TASER_COLORS.gloveDark,
      flatShading: true,
    });
    const strapMat = new THREE.MeshLambertMaterial({ color: TASER_COLORS.strap });
    const labelMat = new THREE.MeshLambertMaterial({ map: labelTex });

    this.root.name = 'TaserViewmodelRoot';
    this.gunGroup.name = 'TaserBody';
    this.root.add(this.gunGroup);

    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
      parent: THREE.Object3D = this.gunGroup
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      parent.add(mesh);
      return mesh;
    };

    // ======================================================================
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
    this.gunGroup.add(shell);

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
    this.gunGroup.add(frame);

    // Tampa traseira (compartimento da célula) com dois parafusos prisioneiros.
    const backCap = new THREE.Mesh(extrudeSideProfile([
      [-0.008, -0.014],
      [-0.008, 0.028],
      [0.002, 0.032],
      [0.002, -0.02],
    ], 0.044, 0.0025), shellShadeMat);
    backCap.position.set(0, 0.002, 0.004);
    this.gunGroup.add(backCap);
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
    this.displayMaterial = new THREE.MeshBasicMaterial({ color: 0x0d2a30 });
    add(new THREE.PlaneGeometry(0.032, 0.018), this.displayMaterial, [-0.0312, 0.008, panelZ], [0, -Math.PI / 2, 0]);
    // Barras de carga do mostrador.
    add(new THREE.PlaneGeometry(0.022, 0.0035), new THREE.MeshBasicMaterial({ color: 0x6ee6ff, transparent: true, opacity: 0.85 }), [-0.0322, 0.012, panelZ]);
    add(new THREE.PlaneGeometry(0.014, 0.0028), new THREE.MeshBasicMaterial({ color: 0x45d693, transparent: true, opacity: 0.7 }), [-0.0322, 0.004, panelZ]);
    // LEDs: carga pronta (azul) e descarga (verde), com a luz real do painel.
    this.ledBulb = add(new THREE.SphereGeometry(0.0034, 8, 6), new THREE.MeshBasicMaterial({ color: TASER_COLORS.led }), [-0.028, 0.026, panelZ - 0.014]);
    this.ledBulb.name = 'TaserChargeLed';
    add(new THREE.SphereGeometry(0.0025, 8, 6), new THREE.MeshBasicMaterial({ color: TASER_COLORS.green }), [-0.028, 0.026, panelZ + 0.006]);
    this.ledLight = new THREE.PointLight(TASER_COLORS.led, 0.06, 0.24);
    this.ledLight.position.set(-0.028, 0.026, panelZ - 0.014);
    this.gunGroup.add(this.ledLight);

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
    this.safetyLever = new THREE.Group();
    this.safetyLever.position.set(-0.024, 0.016, -0.03);
    this.gunGroup.add(this.safetyLever);
    add(beveledBox(0.005, 0.007, 0.019, 0.002), steelDarkMat, [0, 0, 0], [0, 0, 0], this.safetyLever);
    add(new THREE.BoxGeometry(0.0035, 0.004, 0.005), brassMat, [-0.002, 0.005, 0.004], [0, 0, 0], this.safetyLever);

    // Guarda-mato: arco de aço fundido sob o chassi.
    add(new THREE.TorusGeometry(0.023, 0.004, 6, 16, Math.PI * 1.1), graphiteMat, [0, -0.07, -0.052], [0, Math.PI / 2, Math.PI * 0.4]);
    add(new THREE.BoxGeometry(0.032, 0.007, 0.007), graphiteMat, [0, -0.077, -0.026]);

    this.trigger = new THREE.Group();
    this.trigger.position.set(0, -0.062, -0.05);
    this.gunGroup.add(this.trigger);
    add(beveledBox(0.007, 0.022, 0.006, 0.002), steelDarkMat, [0, -0.011, 0.001], [0.24, 0, 0], this.trigger);

    // ======================================================================
    // 4. EMPUNHADURA — emborrachada com textura em relevo e base da bateria
    // ======================================================================
    const grip = new THREE.Group();
    grip.name = 'TaserGrip';
    grip.position.set(0, -0.058, -0.03);
    grip.rotation.x = 0.22;
    this.gunGroup.add(grip);

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
    this.gunGroup.add(bay);
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

    // ======================================================================
    // 7. ARCO ELÉTRICO entre as pontas dos eletrodos
    // ======================================================================
    const arcFrom = prongTips[0];
    const arcTo = prongTips[1];
    this.arcPoints.push(arcFrom.clone(), arcTo.clone());
    this.arc = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.arcPoints),
      new THREE.LineBasicMaterial({ color: 0xf2feff, transparent: true, opacity: 1 })
    );
    this.arc.name = 'TaserArcCore';
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.gunGroup.add(this.arc);

    this.arcGlow = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(this.arcPoints),
      new THREE.LineBasicMaterial({ color: 0x86e8ff, transparent: true, opacity: 0.55 })
    );
    this.arcGlow.name = 'TaserArcGlow';
    this.arcGlow.frustumCulled = false;
    this.arcGlow.visible = false;
    this.gunGroup.add(this.arcGlow);

    this.muzzleLight = new THREE.PointLight(0xa8ecff, 0, 0.9);
    this.muzzleLight.position.copy(arcFrom).lerp(arcTo, 0.5).add(new THREE.Vector3(0, 0.003, -0.012));
    this.gunGroup.add(this.muzzleLight);

    // ======================================================================
    // 8. MÃO — luva anatômica fechada na empunhadura
    // ======================================================================
    // Peças em cápsula (falanges, polegar, antebraço) em vez de blocos: a luva
    // lê como tecido pressurizado dobrando em volta do punho, com as articulações
    // marcadas por anéis de compressão, e o braço sai pela borda inferior direita.
    this.handGroup.name = 'TaserViewmodelHand';
    this.root.add(this.handGroup);

    const gloveMat = new THREE.MeshLambertMaterial({ color: 0x3d464f, flatShading: true });
    const glovePadMat = new THREE.MeshLambertMaterial({ color: 0x262d34, flatShading: true });
    const gloveSeamMat = new THREE.MeshLambertMaterial({ color: 0x161b20 });
    const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x2f3630, flatShading: true });
    const cuffMat = new THREE.MeshLambertMaterial({ color: TASER_COLORS.steelDark });

    // Palma: cápsula achatada apoiada na lombada da empunhadura.
    const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.05, 4, 10), gloveMat);
    palm.scale.set(0.82, 1, 1.15);
    palm.position.set(0.028, -0.106, 0.024);
    palm.rotation.set(0.22, 0.06, -0.12);
    this.handGroup.add(palm);
    // Almofada do polegar e tendão do dorso.
    const palmPad = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), glovePadMat);
    palmPad.scale.set(0.7, 1, 1.2);
    palmPad.position.set(0.012, -0.092, 0.004);
    palmPad.rotation.set(0.2, 0.2, 0.3);
    this.handGroup.add(palmPad);
    const knuckleGuard = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.038, 4, 8), glovePadMat);
    knuckleGuard.rotation.set(0.2, 0.06, Math.PI / 2 - 0.12);
    knuckleGuard.position.set(0.05, -0.104, 0.012);
    this.handGroup.add(knuckleGuard);

    // Quatro dedos em dois segmentos, fechando na frente do punho.
    const fingerRows: Array<{ y: number; len: number; thick: number }> = [
      { y: -0.073, len: 1.0, thick: 0.0135 },
      { y: -0.091, len: 1.05, thick: 0.014 },
      { y: -0.109, len: 1.0, thick: 0.0135 },
      { y: -0.126, len: 0.9, thick: 0.0125 },
    ];
    for (const row of fingerRows) {
      const knuckle = new THREE.Group();
      knuckle.position.set(0.03, row.y, -0.016);
      knuckle.rotation.set(0.04, 0.7, 0);
      this.handGroup.add(knuckle);
      this.fingerJoints.push(knuckle);

      const proximal = new THREE.Mesh(
        new THREE.CapsuleGeometry(row.thick, 0.026 * row.len, 3, 8),
        gloveMat
      );
      proximal.rotation.z = Math.PI / 2;
      proximal.position.set(-0.016 * row.len, 0, 0);
      knuckle.add(proximal);
      const joint = new THREE.Mesh(new THREE.TorusGeometry(row.thick * 1.02, 0.0016, 4, 9), gloveSeamMat);
      joint.rotation.y = Math.PI / 2;
      joint.position.set(-0.03 * row.len, 0, 0);
      knuckle.add(joint);

      const mid = new THREE.Group();
      mid.position.set(-0.031 * row.len, 0, 0);
      mid.rotation.y = -1.0;
      knuckle.add(mid);
      const distal = new THREE.Mesh(
        new THREE.CapsuleGeometry(row.thick * 0.94, 0.02 * row.len, 3, 8),
        gloveMat
      );
      distal.rotation.z = Math.PI / 2;
      distal.position.set(-0.013 * row.len, 0, 0);
      mid.add(distal);
    }

    // Polegar: falanges em cápsula, base no lado do chassi.
    const thumbBase = new THREE.Group();
    thumbBase.position.set(-0.02, -0.086, 0.006);
    thumbBase.rotation.set(0.12, 0.45, 0.62);
    this.handGroup.add(thumbBase);
    const thumbProximal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0115, 0.024, 3, 8), gloveMat);
    thumbProximal.rotation.x = Math.PI / 2;
    thumbProximal.position.set(0, 0, -0.012);
    thumbBase.add(thumbProximal);
    const thumbTipPivot = new THREE.Group();
    thumbTipPivot.position.set(0, 0.001, -0.028);
    thumbTipPivot.rotation.y = -0.5;
    thumbBase.add(thumbTipPivot);
    const thumbDistal = new THREE.Mesh(new THREE.CapsuleGeometry(0.0102, 0.018, 3, 8), gloveMat);
    thumbDistal.rotation.x = Math.PI / 2;
    thumbDistal.position.set(0, 0, -0.009);
    thumbTipPivot.add(thumbDistal);

    // Punho: luva esferóide, anel de vedação e manguito pressurizado saindo
    // pela borda inferior direita, na diagonal do antebraço.
    const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.028, 4, 10), gloveMat);
    wrist.scale.set(0.9, 1.1, 0.95);
    wrist.position.set(0.03, -0.148, 0.05);
    wrist.rotation.set(0.5, 0.1, -0.18);
    this.handGroup.add(wrist);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.033, 0.012, 12), cuffMat);
    cuff.position.set(0.044, -0.174, 0.07);
    cuff.rotation.set(0.44, 0.2, -0.28);
    this.handGroup.add(cuff);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.13, 4, 12), sleeveMat);
    sleeve.position.set(0.075, -0.238, 0.1);
    sleeve.rotation.set(0.36, 0.5, -0.62);
    this.handGroup.add(sleeve);
    // Cintas de compressão da manga, para dar escala ao tecido.
    for (let i = 0; i < 2; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.0285, 0.0028, 5, 12), glovePadMat);
      band.position.set(0.075 + i * 0.014, -0.232 - i * 0.022, 0.1 + i * 0.008);
      band.rotation.set(Math.PI / 2 + 0.36, 0.5, -0.62);
      this.handGroup.add(band);
    }

    this.root.visible = false;
    this.viewScene.add(this.root);
  }

  createThirdPersonWeapon(): THREE.Object3D {
    const gun = this.root.clone(true);
    const hand = gun.getObjectByName('TaserViewmodelHand');
    hand?.removeFromParent();
    const arc = gun.getObjectByName('TaserArcCore');
    if (arc) arc.visible = false;
    const glow = gun.getObjectByName('TaserArcGlow');
    if (glow) glow.visible = false;
    const led = gun.getObjectByName('TaserChargeLed');
    if (led) led.visible = false;
    gun.scale.setScalar(1.55);
    gun.position.set(0, 0.1, -0.055);
    gun.rotation.set(0.05, 0, 0);
    gun.visible = true;
    return gun;
  }

  get isEquipped(): boolean { return this.equipped; }
  get isVisibleInView(): boolean { return this.root.visible; }
  /** Estado usado pelos testes e pela HUD (recarga e faísca). */
  get isDischarging(): boolean { return this.flashTime > 0; }
  get arcVisible(): boolean { return this.arc.visible; }
  equip(): void { this.equipped = true; }
  stow(): void { this.equipped = false; }

  /**
   * Disparo: o motor carrega (0,32 s), o gatilho desce, a arma recua, o punho
   * aperta e o arco salta entre os eletrodos com clarões irregulares.
   */
  fire(): void {
    this.chargeTime = 0.32;
    this.flashTime = 0.36;
    this.recoilTime = 0.22;
    this.arcSeed = (this.arcSeed * 7919 + 13) % 2147483647;
    this.rewriteArcGeometry();
    this.arc.visible = true;
    this.arcGlow.visible = true;
  }

  setHandedness(hand: 'right' | 'left'): void { this.handSign = hand === 'left' ? -1 : 1; }

  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.fov = computeAdaptiveVerticalFov(aspect, 56, 76);
    this.viewCamera.updateProjectionMatrix();
  }

  /** Inércia da arma ao virar a câmera, no mesmo idioma da lanterna e da shotgun. */
  addLookImpulse(dYaw: number, dPitch: number): void {
    this.swayX = Math.max(-1, Math.min(1, this.swayX + dYaw * 1.4));
    this.swayY = Math.max(-1, Math.min(1, this.swayY + dPitch * 1.4));
  }

  /** Regera o zigue-zague do arco com um novo padrão a cada faísca. */
  private rewriteArcGeometry(): void {
    const from = this.arcPoints[0].clone();
    const to = this.arcPoints[this.arcPoints.length - 1].clone();
    const points = buildTaserArcSegments(from, to, this.arcSeed || 1);
    this.arc.geometry.dispose();
    this.arc.geometry = new THREE.BufferGeometry().setFromPoints(points);
    // O halo é o mesmo traçado com folga lateral.
    const halo = points.map((p, i) =>
      i === 0 || i === points.length - 1
        ? p.clone()
        : p.clone().add(new THREE.Vector3(0, (i % 2 === 0 ? 1 : -1) * 0.008, 0))
    );
    this.arcGlow.geometry.dispose();
    this.arcGlow.geometry = new THREE.BufferGeometry().setFromPoints(halo);
  }

  /** Enquadramento travado para inspeção visual (uso interno do desenvolvimento). */
  frozen = false;

  update(dt: number, bobPhase: number, speed: number, slideAmount = 0): void {
    const step = Math.min(0.05, Math.max(0, dt));
    this.progress += ((this.equipped ? 1 : 0) - this.progress) * (1 - Math.exp(-13 * step));
    this.flashTime = Math.max(0, this.flashTime - step);
    this.chargeTime = Math.max(0, this.chargeTime - step);
    this.recoilTime = Math.max(0, this.recoilTime - step);
    const discharging = this.flashTime > 0;
    this.arc.visible = discharging;
    this.arcGlow.visible = discharging;

    // Faísca viva: o arco se redesenha e o clarão pisca de forma irregular.
    if (discharging) {
      this.arcSeed = (this.arcSeed * 48271 + 7) % 2147483647;
      this.rewriteArcGeometry();
      const flicker =
        0.55 +
        0.45 * Math.abs(Math.sin(this.arcSeed % 1000)) *
          (0.6 + 0.4 * Math.sin(performance.now() * 0.05));
      this.muzzleLight.intensity = 1.5 * flicker;
      (this.arcGlow.material as THREE.LineBasicMaterial).opacity = 0.3 + 0.5 * flicker;
      this.displayMaterial.color.setHex(0x1f6f7e);
    } else {
      this.muzzleLight.intensity = 0;
      this.displayMaterial.color.setHex(0x0d2a30);
    }

    // LED de carga pulsa devagar e trava aceso quando a célula está pronta.
    const ledPulse = 0.055 + 0.045 * Math.sin(performance.now() * 0.004);
    this.ledLight.intensity = ledPulse;

    this.root.visible = this.progress > 0.02;
    if (!this.root.visible) return;
    if (this.frozen) return;

    const slide = THREE.MathUtils.clamp(slideAmount, 0, 1);
    const bob = Math.min(1, speed / 5) * (1 - slide);
    const recoil = this.recoilTime / 0.22;
    const chargeKick = this.chargeTime > 0 ? (0.32 - this.chargeTime) / 0.32 : 1;
    const shake = discharging ? Math.sin(performance.now() * 0.09) * 0.0035 : 0;

    // Recuo: a arma sobe e volta, com o punho apertando no gatilho.
    this.gunGroup.position.set(
      this.swayX * 0.006 * this.handSign + shake * this.handSign,
      recoil * 0.014 + (1 - this.progress) * -0.03,
      0.028 * recoil * (0.35 + chargeKick * 0.65)
    );
    this.gunGroup.rotation.set(
      -recoil * 0.2,
      this.swayX * 0.05,
      this.swayY * 0.04 + recoil * 0.05 * this.handSign
    );
    this.handGroup.position.copy(this.gunGroup.position).multiplyScalar(0.55);
    this.handGroup.rotation.set(this.gunGroup.rotation.x * 0.4, 0, this.gunGroup.rotation.z * 0.5);

    // Gatilho e trava reagem ao disparo; o pulso acompanha o recuo.
    this.trigger.rotation.x = -Math.min(1, this.chargeTime / 0.32) * 0.55;
    this.safetyLever.rotation.z = -0.16 + Math.min(1, this.chargeTime / 0.32) * 0.1;
    // O punho aperta no disparo: os dedos fecham um pouco mais na empunhadura.
    const squeeze = 1 - Math.min(1, this.chargeTime / 0.32);
    for (let i = 0; i < this.fingerJoints.length; i++) {
      const joint = this.fingerJoints[i];
      joint.rotation.y = 0.62 + squeeze * 0.12;
      joint.rotation.z = -recoil * 0.05;
    }

    // Enquadramento: arma no canto inferior direito, cano convergindo para o
    // centro da mira, corpo inteiro dentro do frustum.
    const bobX = Math.sin(bobPhase) * 0.006 * bob;
    const bobY = Math.abs(Math.cos(bobPhase)) * 0.005 * bob;
    this.root.position.set(
      (0.17 - slide * 0.025) * this.handSign + bobX,
      -0.15 - (1 - this.progress) * 0.34 + bobY - slide * 0.03,
      -0.6 + recoil * 0.03
    );
    this.root.rotation.set(
      0.03 - recoil * 0.07 + slide * 0.05,
      0.34 * this.handSign - this.swayX * 0.03,
      -0.05 - slide * 0.16 * this.handSign
    );
    this.root.scale.setScalar(1.1);
    this.root.scale.x *= this.handSign;

    this.swayX *= 1 - Math.min(1, step * 6);
    this.swayY *= 1 - Math.min(1, step * 6);
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach((material) => {
          materials.add(material);
          const withMap = material as THREE.MeshLambertMaterial;
          if (withMap.map) textures.add(withMap.map);
        });
      }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    this.root.removeFromParent();
  }
}
