import * as THREE from 'three';

export type QuickHandheldKind =
  | 'knife'
  | 'bandage'
  | 'morphine'
  | 'battery'
  | 'flare';

/**
 * Textura pixel-art 32x32 (NearestFilter) de alumínio anodizado usinado com recartilhado tático.
 */
function createFlashlightBodyTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const angleShade = Math.sin((x / size) * Math.PI * 2) * 11;
      const diamondKnurl =
        y >= 7 && y <= 25 ? (((x + y) % 2 === 0 ? -11 : 5) + (y % 4 === 0 ? -6 : 0)) : 0;
      const seam = y === 5 || y === 26 ? -18 : y === 6 || y === 27 ? 10 : 0;
      const wear = (x * 13 + y * 7) % 23 === 0 ? 18 : 0;
      const base = Math.max(
        22,
        Math.min(136, Math.round(64 + angleShade + diamondKnurl + seam + wear))
      );

      data[idx] = base;
      data[idx + 1] = Math.round(base * 1.03);
      data[idx + 2] = Math.round(base * 1.09);
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

/**
 * Textura pixel-art 32x32 de couro escuro desgastado e costura para a luva tática em 1ª pessoa.
 */
function createGloveLeatherTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const grain = ((x * 7 + y * 11) % 9) - 4;
      const stitch = x === 15 && y % 3 === 0 ? 18 : 0;
      const crease = y === 10 || y === 21 ? -10 : 0;
      const v = Math.max(18, Math.min(96, 42 + grain * 2 + stitch + crease));
      data[idx] = Math.round(v * 1.06);
      data[idx + 1] = Math.round(v * 0.96);
      data[idx + 2] = Math.round(v * 0.86);
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

/**
 * Textura pixel-art 32x32 de aço oxidado com fio polido para a lâmina do canivete em 1ª pessoa.
 */
function createKnifeBladeViewTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const edgePolished = y >= 23;
      const rust = !edgePolished && (x * 17 + y * 19) % 15 === 0;
      const grit = ((x * 5 + y * 13) % 9) - 4;
      if (rust) {
        data[idx] = 116 + grit * 2;
        data[idx + 1] = 58 + grit;
        data[idx + 2] = 38 + grit;
      } else {
        const v = (edgePolished ? 214 : 158) + grit * 3;
        data[idx] = Math.min(248, v);
        data[idx + 1] = Math.min(250, Math.round(v * 1.03));
        data[idx + 2] = Math.min(255, Math.round(v * 1.08));
      }
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sistema de Viewmodel 3D em Primeira Pessoa (renderizado na mesma resolução retrô 250p + PLAYPAL):
 * 1. Mão direita com luva/manopla tática segurando a Lanterna Industrial esculpida (Tecla F)
 *    — sem nenhum cone translúcido flutuante externo!
 * 2. Mão esquerda de saque rápido (`triggerQuickItemAction`) que empunha e anima em 3D
 *    o Canivete Oxidado (golpe diagonal para cortar teia), Gaze, Láudano, Bateria ou Magnésio
 *    quando o jogador aciona os atalhos rápidos [1], [2] ou [3]!
 */
export class DoomFlashlight {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;

  private readonly rootGroup = new THREE.Group();
  private readonly animGroup = new THREE.Group();
  private readonly switchMesh: THREE.Mesh;
  private readonly thumbTipMesh: THREE.Mesh;
  private readonly lensMaterial: THREE.MeshBasicMaterial;
  private readonly reflectorMaterial: THREE.MeshLambertMaterial;
  private readonly bulbMaterial: THREE.MeshBasicMaterial;

  // Grupo de ação rápida em 1ª pessoa (atalhos [1], [2], [3])
  private readonly quickRootGroup = new THREE.Group();
  private readonly quickAnimGroup = new THREE.Group();
  private readonly quickPropMeshes: Record<QuickHandheldKind, THREE.Object3D>;
  private readonly flareSparkMesh: THREE.Mesh;
  private activeQuickKind: QuickHandheldKind | null = null;
  private quickTimer = 0;
  private quickDuration = 0.5;

  private equipped = false;
  private lightActive = false;
  /** 0 = guardada fora da tela, 1 = totalmente empunhada */
  private equipProgress = 0;
  private switchProgress = 0;
  private flickerWarmup = 0;

  // Inércia suave ao virar a câmera
  private swayX = 0;
  private swayY = 0;

  constructor(aspect: number) {
    this.viewCamera = new THREE.PerspectiveCamera(62, aspect, 0.04, 5.0);

    // Iluminação direcional contrastada para destacar chanfros, rebites e facetas low-poly
    const ambient = new THREE.AmbientLight(0x888b94, 0.88);
    const keyLight = new THREE.DirectionalLight(0xfff3de, 1.42);
    keyLight.position.set(-0.65, 1.25, 0.95);
    const rimLight = new THREE.DirectionalLight(0x768296, 0.62);
    rimLight.position.set(0.85, -0.35, 0.35);
    this.viewScene.add(ambient, keyLight, rimLight);

    const bodyTex = createFlashlightBodyTexture();
    const leatherTex = createGloveLeatherTexture();
    const bladeTex = createKnifeBladeViewTexture();

    const bodyMat = new THREE.MeshLambertMaterial({
      map: bodyTex,
      color: 0xa2a8b4,
      flatShading: true,
    });
    const darkRingMat = new THREE.MeshLambertMaterial({
      color: 0x22252b,
      flatShading: true,
    });
    const bezelMat = new THREE.MeshLambertMaterial({
      color: 0x555b66,
      flatShading: true,
    });
    const brassMat = new THREE.MeshLambertMaterial({
      color: 0xc29e59,
      flatShading: true,
    });
    const switchMat = new THREE.MeshLambertMaterial({
      color: 0x9e2a2b,
      flatShading: true,
    });
    const gloveLeatherMat = new THREE.MeshLambertMaterial({
      map: leatherTex,
      color: 0x8f887d,
      flatShading: true,
    });
    const gauntletPlateMat = new THREE.MeshLambertMaterial({
      color: 0x454952,
      flatShading: true,
    });

    this.reflectorMaterial = new THREE.MeshLambertMaterial({
      color: 0x4b5059,
      side: THREE.BackSide,
      flatShading: true,
    });
    this.bulbMaterial = new THREE.MeshBasicMaterial({
      color: 0x3a362e,
    });
    this.lensMaterial = new THREE.MeshBasicMaterial({
      color: 0x191d23,
      transparent: true,
      opacity: 0.72,
    });

    // ========================================================================
    // 1. LANTERNA INDUSTRIAL ESCULPIDA + MÃO ENLUVADA EM 1ª PESSOA (EIXO -Z)
    // ========================================================================
    const model = new THREE.Group();

    // A) Tampa traseira usinada + coroa traseira + olhal metálico de fiel
    const tailCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.037, 0.034, 0.042, 10),
      darkRingMat
    );
    tailCap.rotation.x = Math.PI * 0.5;
    tailCap.position.z = 0.145;
    model.add(tailCap);

    const tailEndBoss = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.012, 8),
      bezelMat
    );
    tailEndBoss.rotation.x = Math.PI * 0.5;
    tailEndBoss.position.z = 0.168;
    model.add(tailEndBoss);

    const lanyardLoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.013, 0.0032, 6, 8),
      brassMat
    );
    lanyardLoop.position.set(0, -0.024, 0.172);
    model.add(lanyardLoop);

    // B) Corpo cilíndrico recartilhado (12 facetas) + trilhos laterais anti-rolagem + 4 anéis
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.245, 12),
      bodyMat
    );
    handle.rotation.x = Math.PI * 0.5;
    model.add(handle);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.007, 0.014, 0.19),
        bezelMat
      );
      rail.position.set(side * 0.035, 0.004, 0.01);
      model.add(rail);
    }

    for (const zOff of [0.088, 0.042, -0.004, -0.048]) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.011, 12),
        darkRingMat
      );
      ring.rotation.x = Math.PI * 0.5;
      ring.position.z = zOff;
      model.add(ring);
    }

    // C) Berço blindado do interruptor + parafusos de latão + chave deslizante texturizada
    const switchSaddle = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.014, 0.064),
      darkRingMat
    );
    switchSaddle.position.set(0, 0.036, -0.076);
    model.add(switchSaddle);

    for (const sz of [-0.101, -0.051]) {
      const screw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0035, 0.0035, 0.006, 6),
        brassMat
      );
      screw.position.set(0, 0.043, sz);
      model.add(screw);
    }

    this.switchMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.017, 0.013, 0.025),
      switchMat
    );
    this.switchMesh.position.set(0, 0.044, -0.068);
    model.add(this.switchMesh);

    // D) Pescoço cônico + 3 aletas octogonais de dissipação térmica
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.037, 0.058, 10),
      bezelMat
    );
    neck.rotation.x = Math.PI * 0.5;
    neck.position.z = -0.146;
    model.add(neck);

    for (let f = 0; f < 3; f++) {
      const rFin = 0.043 + f * 0.0045;
      const fin = new THREE.Mesh(
        new THREE.CylinderGeometry(rFin, rFin, 0.008, 8),
        darkRingMat
      );
      fin.rotation.x = Math.PI * 0.5;
      fin.position.z = -0.128 - f * 0.016;
      model.add(fin);
    }

    // E) Cabeça octogonal refletora + aro frontal dentado (strike bezel) + refletor côncavo interno + bulbo halógeno
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.053, 0.068, 8),
      bezelMat
    );
    head.rotation.x = Math.PI * 0.5;
    head.position.z = -0.206;
    model.add(head);

    const collarBrass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0565, 0.0565, 0.009, 8),
      brassMat
    );
    collarBrass.rotation.x = Math.PI * 0.5;
    collarBrass.position.z = -0.182;
    model.add(collarBrass);

    const frontRim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.059, 0.016, 8),
      darkRingMat
    );
    frontRim.rotation.x = Math.PI * 0.5;
    frontRim.position.z = -0.238;
    model.add(frontRim);

    // 8 dentes frontais discretos na coroa de impacto do bocal
    for (let t = 0; t < 8; t++) {
      const ang = (t / 8) * Math.PI * 2 + Math.PI / 8;
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.008, 0.012),
        darkRingMat
      );
      tooth.position.set(
        Math.cos(ang) * 0.054,
        Math.sin(ang) * 0.054,
        -0.249
      );
      tooth.rotation.z = ang;
      model.add(tooth);
    }

    // Cone parabólico refletor INTERNO (sem qualquer geometria externa flutuante!)
    const reflectorCone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.014, 0.044, 10, 1, true),
      this.reflectorMaterial
    );
    reflectorCone.rotation.x = Math.PI * 0.5;
    reflectorCone.position.z = -0.222;
    model.add(reflectorCone);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 8, 6),
      this.bulbMaterial
    );
    bulb.scale.set(0.85, 0.85, 1.45);
    bulb.position.z = -0.208;
    model.add(bulb);

    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 10),
      this.lensMaterial
    );
    lens.position.z = -0.244;
    lens.rotation.y = Math.PI;
    model.add(lens);

    // F) MÃO DIREITA TÁTICA / MANOPLA RETRÔ SEGURANDO A LANTERNA
    const handGroup = new THREE.Group();

    // Punho/antebraço com braçadeira blindada e rebites
    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.064, 0.24, 8),
      gloveLeatherMat
    );
    forearm.rotation.set(0.62, -0.24, -0.22);
    forearm.position.set(0.048, -0.105, 0.185);
    handGroup.add(forearm);

    const dorsalPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.022, 0.13),
      gauntletPlateMat
    );
    dorsalPlate.rotation.set(0.56, -0.22, -0.18);
    dorsalPlate.position.set(0.056, -0.055, 0.125);
    handGroup.add(dorsalPlate);

    // Palma envolvendo a lateral direita do corpo da lanterna
    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.066, 0.108),
      gloveLeatherMat
    );
    palm.position.set(0.036, -0.018, 0.022);
    palm.rotation.z = 0.22;
    handGroup.add(palm);

    // Placa protetora dos nós dos dedos
    const knuckleGuard = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.026, 0.096),
      gauntletPlateMat
    );
    knuckleGuard.position.set(0.054, 0.008, 0.018);
    handGroup.add(knuckleGuard);

    // 4 dedos curvados abraçando a parte inferior do tubo
    for (let f = 0; f < 4; f++) {
      const fz = -0.022 + f * 0.027;
      const prox = new THREE.Mesh(
        new THREE.BoxGeometry(0.052, 0.021, 0.022),
        gloveLeatherMat
      );
      prox.position.set(0.008, -0.045, fz);
      prox.rotation.z = -0.18;

      const dist = new THREE.Mesh(
        new THREE.BoxGeometry(0.038, 0.02, 0.02),
        gloveLeatherMat
      );
      dist.position.set(-0.026, -0.028, fz);
      dist.rotation.z = 0.72;

      handGroup.add(prox, dist);
    }

    // Polegar articulado posicionado junto à chave superior da lanterna
    const thumbBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.024, 0.046),
      gloveLeatherMat
    );
    thumbBase.position.set(0.024, 0.036, -0.024);
    thumbBase.rotation.set(-0.22, 0.34, 0.28);
    handGroup.add(thumbBase);

    this.thumbTipMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.02, 0.036),
      gloveLeatherMat
    );
    this.thumbTipMesh.position.set(0.006, 0.048, -0.054);
    this.thumbTipMesh.rotation.set(-0.12, 0.18, 0.1);
    handGroup.add(this.thumbTipMesh);

    model.add(handGroup);

    this.animGroup.add(model);
    this.rootGroup.add(this.animGroup);
    this.rootGroup.visible = false;
    this.viewScene.add(this.rootGroup);

    // ========================================================================
    // 2. MÃO ESQUERDA DE SAQUE RÁPIDO EM 1ª PESSOA (ATALHOS [1], [2], [3])
    // ========================================================================
    const woodMat = new THREE.MeshLambertMaterial({
      color: 0x6b472f,
      flatShading: true,
    });
    const bladeMat = new THREE.MeshLambertMaterial({
      map: bladeTex,
      color: 0xd8e0ea,
      flatShading: true,
    });
    const rustMat = new THREE.MeshLambertMaterial({
      color: 0x613224,
      flatShading: true,
    });
    const gauzeMat = new THREE.MeshLambertMaterial({
      color: 0xd8cfc0,
      flatShading: true,
    });
    const crimsonMat = new THREE.MeshLambertMaterial({
      color: 0x992624,
      flatShading: true,
    });
    const amberMat = new THREE.MeshLambertMaterial({
      color: 0x9e5424,
      flatShading: true,
    });
    const flareRedMat = new THREE.MeshLambertMaterial({
      color: 0xb82e2a,
      flatShading: true,
    });
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe89c });

    // Mão/punho esquerdo tático compacto comum a todos os itens rápidos (alinhado ao punho sem invadir a câmera)
    const leftArm = new THREE.Group();
    const lSleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.042, 0.17, 8),
      gloveLeatherMat
    );
    lSleeve.rotation.set(0.26, 0.1, 0.12);
    lSleeve.position.set(-0.014, -0.115, 0.038);
    const lPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.016, 0.088),
      gauntletPlateMat
    );
    lPlate.rotation.set(0.26, 0.1, 0.12);
    lPlate.position.set(-0.016, -0.075, 0.022);
    const lFist = new THREE.Mesh(
      new THREE.BoxGeometry(0.062, 0.058, 0.074),
      gloveLeatherMat
    );
    lFist.position.set(0, -0.012, 0);
    leftArm.add(lSleeve, lPlate, lFist);
    this.quickAnimGroup.add(leftArm);

    // 2A) Canivete Oxidado em 1ª pessoa (lâmina chanfrada apontada para cortar teias!)
    const knifeProp = new THREE.Group();
    const kGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.145, 0.046),
      woodMat
    );
    kGrip.position.set(0, -0.01, 0);
    const kPommel = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.026, 0.05),
      darkRingMat
    );
    kPommel.position.set(0, -0.088, 0);
    const kGuard = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.022, 0.076),
      brassMat
    );
    kGuard.position.set(0, 0.068, 0);
    for (const ry of [-0.05, -0.01, 0.03]) {
      const rvt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.042, 6),
        brassMat
      );
      rvt.rotation.z = Math.PI * 0.5;
      rvt.position.set(0, ry, 0);
      knifeProp.add(rvt);
    }
    const kBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.011, 0.185, 0.042),
      bladeMat
    );
    kBlade.position.set(0, 0.17, 0.002);
    const kSpine = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.18, 0.011),
      darkRingMat
    );
    kSpine.position.set(0, 0.168, -0.016);
    const kFuller = new THREE.Mesh(
      new THREE.BoxGeometry(0.013, 0.135, 0.009),
      rustMat
    );
    kFuller.position.set(0, 0.155, -0.004);
    const kTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.023, 0.078, 4),
      bladeMat
    );
    kTip.scale.set(0.32, 1, 1);
    kTip.position.set(0, 0.298, 0.003);
    knifeProp.add(kGrip, kPommel, kGuard, kBlade, kSpine, kFuller, kTip);

    // 2B) Rolo de Gaze Estéril (miolo oco real + cinta médica + ponta caída natural)
    const bandageProp = new THREE.Group();
    const bRollOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.054, 0.054, 0.098, 14, 1, true),
      gauzeMat
    );
    bRollOuter.rotation.z = Math.PI * 0.5;
    bRollOuter.position.set(0.018, 0.048, -0.016);
    const bRollInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.019, 0.098, 10, 1, true),
      darkRingMat
    );
    bRollInner.rotation.z = Math.PI * 0.5;
    bRollInner.position.copy(bRollOuter.position);
    for (const side of [-1, 1]) {
      const bCap = new THREE.Mesh(
        new THREE.RingGeometry(0.019, 0.054, 14),
        gauzeMat
      );
      bCap.rotation.y = side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      bCap.position.set(0.018 + side * 0.049, 0.048, -0.016);
      bandageProp.add(bCap);
    }
    const bWrapper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0555, 0.0555, 0.036, 14, 1, true),
      crimsonMat
    );
    bWrapper.rotation.z = Math.PI * 0.5;
    bWrapper.position.copy(bRollOuter.position);
    const bStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.068, 0.005, 0.058),
      gauzeMat
    );
    bStrip.position.set(0.062, 0.012, 0.012);
    bStrip.rotation.set(0.28, 0.1, -0.62);
    bandageProp.add(bRollOuter, bRollInner, bWrapper, bStrip);

    // 2C) Frasco Apotecário de Láudano (rótulo cilíndrico curvo CONFORME sem aba solta!)
    const morphineProp = new THREE.Group();
    const mBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.044, 0.046, 0.102, 12),
      amberMat
    );
    mBody.position.set(0.01, 0.052, -0.015);
    const mShoulder = new THREE.Mesh(
      new THREE.CylinderGeometry(0.019, 0.044, 0.03, 12),
      amberMat
    );
    mShoulder.position.set(0.01, 0.118, -0.015);
    const mNeck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.018, 0.022, 10),
      amberMat
    );
    mNeck.position.set(0.01, 0.142, -0.015);
    const mLip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.02, 0.008, 10),
      amberMat
    );
    mLip.position.set(0.01, 0.155, -0.015);
    const mCork = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.013, 0.024, 8),
       woodMat
    );
    mCork.position.set(0.01, 0.169, -0.015);
    const mLabel = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.0462,
        0.0475,
        0.052,
        10,
        1,
        true,
        -0.65,
        1.3
      ),
      gauzeMat
    );
    mLabel.position.set(0.01, 0.052, -0.015);
    const mBanner = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.0468,
        0.0472,
        0.011,
        10,
        1,
        true,
        -0.5,
        1.0
      ),
      crimsonMat
    );
    mBanner.position.set(0.01, 0.066, -0.015);
    morphineProp.add(mBody, mShoulder, mNeck, mLip, mCork, mLabel, mBanner);

    // 2D) Bateria Industrial 9V (faixa superior de cobre rente + placa isolante + polos + / - distintos)
    const batteryProp = new THREE.Group();
    const batLower = new THREE.Mesh(
      new THREE.BoxGeometry(0.084, 0.082, 0.056),
      darkRingMat
    );
    batLower.position.set(0.01, 0.042, -0.01);
    const batCopperBand = new THREE.Mesh(
      new THREE.BoxGeometry(0.084, 0.032, 0.056),
      brassMat
    );
    batCopperBand.position.set(0.01, 0.099, -0.01);
    const batInsulator = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.006, 0.044),
      darkRingMat
    );
    batInsulator.position.set(0.01, 0.118, -0.01);
    const batPosStud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0075, 0.007, 0.014, 8),
      brassMat
    );
    batPosStud.position.set(-0.011, 0.127, -0.01);
    const batNegCrown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0125, 0.0105, 0.015, 6),
      brassMat
    );
    batNegCrown.position.set(0.031, 0.127, -0.01);
    batteryProp.add(
      batLower,
      batCopperBand,
      batInsulator,
      batPosStud,
      batNegCrown
    );

    // 2E) Bastão de Magnésio com base sextavada, punho escuro, virola e faísca viva
    const flareProp = new THREE.Group();
    const flHexBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.029, 0.028, 0.02, 8),
      darkRingMat
    );
    flHexBase.position.set(0, -0.022, -0.01);
    const flGrip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.045, 10),
      darkRingMat
    );
    flGrip.position.set(0, 0.008, -0.01);
    const flTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.023, 0.023, 0.175, 10),
      flareRedMat
    );
    flTube.position.set(0, 0.095, -0.01);
    const flCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0255, 0.0255, 0.018, 10),
      brassMat
    );
    flCollar.position.set(0, 0.184, -0.01);
    this.flareSparkMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.028, 0),
      sparkMat
    );
    this.flareSparkMesh.position.set(0, 0.212, -0.01);
    flareProp.add(flHexBase, flGrip, flTube, flCollar, this.flareSparkMesh);

    this.quickPropMeshes = {
      knife: knifeProp,
      bandage: bandageProp,
      morphine: morphineProp,
      battery: batteryProp,
      flare: flareProp,
    };

    for (const k of Object.keys(this.quickPropMeshes) as QuickHandheldKind[]) {
      const m = this.quickPropMeshes[k];
      m.visible = false;
      this.quickAnimGroup.add(m);
    }

    this.quickRootGroup.add(this.quickAnimGroup);
    this.quickRootGroup.visible = false;
    this.viewScene.add(this.quickRootGroup);
  }

  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  get isEquipped(): boolean {
    return this.equipped;
  }

  /**
   * Dispara animação 3D imediata em primeira pessoa ao usar um atalho rápido [1], [2] ou [3]!
   */
  triggerQuickItemAction(kind: QuickHandheldKind): void {
    this.activeQuickKind = kind;
    this.quickTimer = 0;
    this.quickDuration =
      kind === 'knife'
        ? 0.46
        : kind === 'flare'
          ? 0.52
          : kind === 'battery'
            ? 0.54
            : 0.62;

    for (const k of Object.keys(this.quickPropMeshes) as QuickHandheldKind[]) {
      this.quickPropMeshes[k].visible = k === kind;
    }
    this.quickRootGroup.visible = true;
  }

  /**
   * Alterna a lanterna ao pressionar F:
   * - Se guardada: inicia animação de saque + liga o foco.
   * - Se empunhada: desliga o foco + inicia animação de guardar.
   */
  toggle(): boolean {
    this.equipped = !this.equipped;
    if (!this.equipped) {
      this.lightActive = false;
      this.flickerWarmup = 0;
    }
    return this.equipped;
  }

  addLookImpulse(deltaYaw: number, deltaPitch: number): void {
    this.swayX = Math.max(
      -0.045,
      Math.min(0.045, this.swayX + deltaYaw * 0.14)
    );
    this.swayY = Math.max(
      -0.035,
      Math.min(0.035, this.swayY + deltaPitch * 0.14)
    );
  }

  private updateQuickActionAnimation(dt: number): void {
    if (!this.activeQuickKind) {
      this.quickRootGroup.visible = false;
      return;
    }

    this.quickTimer += dt;
    const u = this.quickTimer / this.quickDuration;
    if (u >= 1) {
      this.activeQuickKind = null;
      this.quickRootGroup.visible = false;
      return;
    }

    const kind = this.activeQuickKind;

    if (kind === 'knife') {
      // Saque relâmpago (0..0.24) -> Golpe diagonal cortando fios de teia (0.24..0.68) -> Recuo (0.68..1)
      if (u < 0.24) {
        const p = u / 0.24;
        const e = 1 - Math.pow(1 - p, 3);
        this.quickRootGroup.position.set(
          -0.28 + 0.06 * e,
          -0.46 + 0.36 * e,
          -0.36 - 0.06 * e
        );
        this.quickAnimGroup.rotation.set(
          -0.35 + 0.25 * e,
          -0.35,
          -0.58 + 0.18 * e
        );
      } else if (u < 0.68) {
        const p = (u - 0.24) / 0.44;
        const slash = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        this.quickRootGroup.position.set(
          -0.22 + slash * 0.44,
          -0.1 - slash * 0.15,
          -0.42 - Math.sin(slash * Math.PI) * 0.09
        );
        this.quickAnimGroup.rotation.set(
          -0.1 - slash * 0.65,
          -0.35 + slash * 0.85,
          -0.4 - slash * 1.15
        );
      } else {
        const p = (u - 0.68) / 0.32;
        this.quickRootGroup.position.set(
          0.22 - p * 0.36,
          -0.25 - p * 0.32,
          -0.42 + p * 0.1
        );
        this.quickAnimGroup.rotation.set(
          -0.75 - p * 0.3,
          0.5 - p * 0.5,
          -1.55 + p * 0.5
        );
      }
      return;
    }

    // Curva geral de subida -> uso -> descida para consumíveis rápidos
    const arc = Math.sin(u * Math.PI);
    if (kind === 'flare') {
      const toss = u > 0.55 ? (u - 0.55) / 0.45 : 0;
      this.quickRootGroup.position.set(
        -0.2 + u * 0.12,
        -0.42 + arc * 0.28 - toss * 0.12,
        -0.38 - toss * 0.18
      );
      this.quickAnimGroup.rotation.set(
        -0.25 - toss * 0.95,
        0.22,
        -0.28 + Math.sin(u * 24) * 0.08 * (1 - toss)
      );
      this.flareSparkMesh.scale.setScalar(
        u > 0.22 ? 0.75 + Math.sin(u * 55) * 0.35 : 0.01
      );
    } else if (kind === 'bandage') {
      const wrapOsc = Math.sin(u * Math.PI * 3) * 0.055;
      this.quickRootGroup.position.set(
        -0.16 + wrapOsc,
        -0.44 + arc * 0.26,
        -0.38
      );
      this.quickAnimGroup.rotation.set(
        0.25,
        0.35 + wrapOsc * 2.5,
        -0.35 + wrapOsc * 1.8
      );
    } else if (kind === 'morphine') {
      const tilt = u > 0.3 && u < 0.78 ? Math.sin(((u - 0.3) / 0.48) * Math.PI) : 0;
      this.quickRootGroup.position.set(
        -0.13 + tilt * 0.06,
        -0.44 + arc * 0.3,
        -0.36 + tilt * 0.05
      );
      this.quickAnimGroup.rotation.set(
        0.22 + tilt * 0.85,
        0.25,
        -0.22 - tilt * 0.25
      );
    } else {
      // Bateria 9V aproximando-se da lanterna para recarga
      this.quickRootGroup.position.set(
        -0.22 + arc * 0.26,
        -0.45 + arc * 0.25,
        -0.38
      );
      this.quickAnimGroup.rotation.set(0.18, -0.25, -0.35 + arc * 0.32);
    }
  }

  /**
   * Atualiza a animação de saque/guarda da lanterna, o clique físico do botão + polegar,
   * qualquer ação rápida 3D de atalho [1–3] e retorna a intensidade atual do feixe [0..1].
   */
  update(
    dt: number,
    bobPhase: number,
    planarSpeed: number,
    onSwitchClickOn: () => void,
    crouchAmount = 0,
    batteryPercent = 100
  ): {
    beamIntensity: number;
    aimYawOffset: number;
    aimPitchOffset: number;
  } {
    this.updateQuickActionAnimation(dt);

    // 1. Progresso de equipar / guardar lanterna
    const speed = this.equipped ? 3.2 : 3.7;
    if (this.equipped && this.equipProgress < 1) {
      const prev = this.equipProgress;
      this.equipProgress = Math.min(1, this.equipProgress + dt * speed);
      if (prev < 0.58 && this.equipProgress >= 0.58 && !this.lightActive) {
        this.lightActive = true;
        this.flickerWarmup = 0.01;
        onSwitchClickOn();
      }
    } else if (!this.equipped && this.equipProgress > 0) {
      this.equipProgress = Math.max(0, this.equipProgress - dt * speed);
    }

    this.rootGroup.visible = this.equipProgress > 0.005;

    // 2. Animação do botão físico + polegar na parte superior da lanterna
    const targetSwitch = this.lightActive ? 1 : 0;
    this.switchProgress +=
      (targetSwitch - this.switchProgress) * (1 - Math.exp(-22 * dt));
    this.switchMesh.position.z = -0.068 - this.switchProgress * 0.014;
    this.switchMesh.position.y = 0.044 - this.switchProgress * 0.0025;
    this.thumbTipMesh.position.z = -0.054 - this.switchProgress * 0.012;
    this.thumbTipMesh.position.y = 0.048 - this.switchProgress * 0.003;

    // 3. Aquecimento rápido de filamento halógeno ao ligar (~65ms) + carga da bateria
    let beamIntensity = 0;
    if (this.lightActive && batteryPercent > 0.2) {
      this.flickerWarmup = Math.min(1, this.flickerWarmup + dt * 15);
      const baseBeam =
        this.flickerWarmup < 0.45 ? 0.55 : this.flickerWarmup;
      if (batteryPercent < 15) {
        const lowScale = 0.35 + (batteryPercent / 15) * 0.65;
        const sputter = Math.random() < 0.08 ? 0.35 : 1.0;
        beamIntensity = baseBeam * lowScale * sputter;
      } else {
        beamIntensity = baseBeam;
      }
    }

    // Atualiza brilho interno da cápsula halógena, refletor e lente (sem cone externo!)
    if (beamIntensity > 0.05) {
      this.bulbMaterial.color.setHex(0xfff9de);
      this.reflectorMaterial.color.setHex(0xd8c394);
      this.lensMaterial.color.setHex(0xfff0be);
    } else {
      this.bulbMaterial.color.setHex(0x3a362e);
      this.reflectorMaterial.color.setHex(0x4b5059);
      this.lensMaterial.color.setHex(0x191d23);
    }

    // 4. Curva de pose da animação de saque (easeOutBack sutil para peso mecânico)
    const t = this.equipProgress;
    const c1 = 1.45;
    const c3 = c1 + 1;
    const eased =
      t <= 0
        ? 0
        : t >= 1
          ? 1
          : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

    // Relaxa inércia de olhar
    const relax = 1 - Math.exp(-10 * dt);
    this.swayX += (0 - this.swayX) * relax;
    this.swayY += (0 - this.swayY) * relax;

    // Balanço de caminhada em 8 (mais contido e firme ao andar agachado)
    const moveFactor = Math.min(1, planarSpeed / 6.0);
    const bobScale = 1 - crouchAmount * 0.35;
    const walkX = Math.cos(bobPhase * 0.5) * 0.014 * moveFactor * bobScale;
    const walkY =
      Math.abs(Math.sin(bobPhase * 0.5)) * -0.016 * moveFactor * bobScale;

    const stowedX = 0.34;
    const stowedY = -0.52;
    const stowedZ = -0.26;

    const heldX = 0.235 - crouchAmount * 0.018;
    const heldY = -0.195 + crouchAmount * 0.014;
    const heldZ = -0.41 + crouchAmount * 0.018;

    this.rootGroup.position.set(
      stowedX + (heldX - stowedX) * eased + walkX + this.swayX,
      stowedY + (heldY - stowedY) * eased + walkY + this.swayY,
      stowedZ + (heldZ - stowedZ) * eased
    );

    const stowedPitch = -0.78;
    const heldPitch = 0.045;
    const stowedYaw = -0.28;
    const heldYaw = 0.11;
    const stowedRoll = 0.42;
    const heldRoll = -0.06;

    this.animGroup.rotation.set(
      stowedPitch + (heldPitch - stowedPitch) * eased + this.swayY * 1.4,
      stowedYaw + (heldYaw - stowedYaw) * eased + this.swayX * 1.5,
      stowedRoll + (heldRoll - stowedRoll) * eased
    );

    return {
      beamIntensity,
      aimYawOffset: this.swayX * 1.6 + walkX * 0.9,
      aimPitchOffset: this.swayY * 1.6 + walkY * 0.7,
    };
  }
}
