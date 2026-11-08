import * as THREE from 'three';
import {
  AstronautArmRig,
  createAstronautArmRig,
  createAstronautMaterials,
} from './DoomAstronaut';

export type QuickHandheldKind =
  | 'knife'
  | 'bandage'
  | 'morphine'
  | 'battery'
  | 'flare'
  | 'key';

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
        y >= 7 && y <= 25
          ? ((x + y) % 2 === 0 ? -11 : 5) + (y % 4 === 0 ? -6 : 0)
          : 0;
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
 * Sistema de Viewmodel 3D em Primeira Pessoa usando os BRAÇOS ORIGINAIS MARCADOS DO ASTRONAUTA:
 * 1. `rightAstronautArm` (`AstronautRightArm`): braço espacial EVA direito com manga Beta-Cloth acolchoada,
 *    faixa laranja de missão, anel rotativo anodizado carmim e luva pressurizada de 5 dedos segurando a Lanterna (Tecla F).
 * 2. `leftAstronautArm` (`AstronautLeftArm`): braço espacial EVA esquerdo com manômetro analógico O2/Pressão no pulso,
 *    anel rotativo azul-cobalto e luva EVA de 5 dedos empunhando Canivete, Gaze, Láudano, Bateria, Magnésio e Chave!
 */
export class DoomFlashlight {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;

  /** Braço direito original do Astronauta marcado como braço ativo da lanterna */
  readonly rightAstronautArm: AstronautArmRig;
  /** Braço esquerdo original do Astronauta marcado como braço ativo de faca e objetos */
  readonly leftAstronautArm: AstronautArmRig;

  private readonly rootGroup = new THREE.Group();
  private readonly animGroup = new THREE.Group();
  private readonly switchMesh: THREE.Mesh;
  private readonly lensMaterial: THREE.MeshBasicMaterial;
  private readonly reflectorMaterial: THREE.MeshLambertMaterial;
  private readonly bulbMaterial: THREE.MeshBasicMaterial;

  // Grupo de ação rápida em 1ª pessoa (atalhos [1], [2], [3] e uso de objetos)
  private readonly quickRootGroup = new THREE.Group();
  private readonly quickAnimGroup = new THREE.Group();
  private readonly knifeBladePivot = new THREE.Group();
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

  // Estado de queda/desarme da lanterna quando o jogador sofre o bote e desmaia
  private knockoutDropActive = false;
  private knockoutDropTimer = 0;
  private knockoutDropStartProgress = 0;
  private knockoutWasLit = false;

  // Inércia suave ao virar a câmera
  private swayX = 0;
  private swayY = 0;

  constructor(aspect: number) {
    this.viewCamera = new THREE.PerspectiveCamera(62, aspect, 0.04, 5.0);

    // Iluminação direcional calibrada sem estourar o albedo (>1.0) para preservar 100% da Camuflagem Astronáutica no COLORMAP!
    const ambient = new THREE.AmbientLight(0x88909e, 0.48);
    const keyLight = new THREE.DirectionalLight(0xfff1d6, 0.88);
    keyLight.position.set(-0.65, 1.25, 0.95);
    const rimLight = new THREE.DirectionalLight(0x6e7d94, 0.38);
    rimLight.position.set(0.85, -0.35, 0.35);
    this.viewScene.add(ambient, keyLight, rimLight);

    const astroMats = createAstronautMaterials();
    const bodyTex = createFlashlightBodyTexture();
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

    this.lensMaterial = new THREE.MeshBasicMaterial({ color: 0x1e2126 });
    this.reflectorMaterial = new THREE.MeshLambertMaterial({
      color: 0x626873,
      side: THREE.BackSide,
      flatShading: true,
    });
    this.bulbMaterial = new THREE.MeshBasicMaterial({ color: 0x3a362e });

    // ========================================================================
    // 1. LANTERNA INDUSTRIAL + BRAÇO DIREITO ORIGINAL DO ASTRONAUTA (`AstronautRightArm`)
    // ========================================================================
    const model = new THREE.Group();

    // A) Tampa traseira sextavada com argola metálica de fiel (lanyard)
    const tailCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.033, 0.044, 8),
      bezelMat
    );
    tailCap.rotation.x = Math.PI * 0.5;
    tailCap.position.z = 0.114;
    model.add(tailCap);

    const tailGroove = new THREE.Mesh(
      new THREE.CylinderGeometry(0.037, 0.037, 0.008, 8),
      darkRingMat
    );
    tailGroove.rotation.x = Math.PI * 0.5;
    tailGroove.position.z = 0.098;
    model.add(tailGroove);

    const lanyardLug = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.018, 0.016),
      brassMat
    );
    lanyardLug.position.set(0, -0.022, 0.138);
    const lanyardRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.012, 0.003, 6, 10),
      brassMat
    );
    lanyardRing.position.set(0, -0.028, 0.148);
    lanyardRing.rotation.x = 0.45;
    model.add(lanyardLug, lanyardRing);

    // B) Tubo central recartilhado
    const barrelRear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0345, 0.0345, 0.06, 10),
      bodyMat
    );
    barrelRear.rotation.x = Math.PI * 0.5;
    barrelRear.position.z = 0.062;
    model.add(barrelRear);

    const gripKnurl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0365, 0.0365, 0.125, 10),
      bodyMat
    );
    gripKnurl.rotation.x = Math.PI * 0.5;
    gripKnurl.position.z = -0.028;
    model.add(gripKnurl);

    for (const gz of [0.032, -0.005, -0.042, -0.082]) {
      const oRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.007, 10),
        darkRingMat
      );
      oRing.rotation.x = Math.PI * 0.5;
      oRing.position.z = gz;
      model.add(oRing);
    }

    // C) Aletas de dissipação térmica + colar de latão
    const brassCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0395, 0.038, 0.018, 10),
      brassMat
    );
    brassCollar.rotation.x = Math.PI * 0.5;
    brassCollar.position.z = -0.102;
    model.add(brassCollar);

    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.043 + i * 0.0025,
          0.042 + i * 0.0025,
          0.01,
          10
        ),
        darkRingMat
      );
      fin.rotation.x = Math.PI * 0.5;
      fin.position.z = -0.118 - i * 0.015;
      model.add(fin);
    }

    // D) Trilho superior blindado + botão deslizante mecânico
    const switchRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.014, 0.064),
      darkRingMat
    );
    switchRail.position.set(0, 0.037, -0.068);
    model.add(switchRail);

    this.switchMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.019, 0.013, 0.026),
      switchMat
    );
    this.switchMesh.position.set(0, 0.044, -0.068);
    model.add(this.switchMesh);

    // E) Cabeçal octogonal alargado + coroa crenelada + refletor parabólico interno
    const headTransition = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.044, 0.042, 10),
      bezelMat
    );
    headTransition.rotation.x = Math.PI * 0.5;
    headTransition.position.z = -0.172;
    model.add(headTransition);

    const headBell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.056, 0.054, 10),
      bodyMat
    );
    headBell.rotation.x = Math.PI * 0.5;
    headBell.position.z = -0.218;
    model.add(headBell);

    const bezelLip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.014, 10),
      darkRingMat
    );
    bezelLip.rotation.x = Math.PI * 0.5;
    bezelLip.position.z = -0.246;
    model.add(bezelLip);

    for (let c = 0; c < 6; c++) {
      const ang = (c / 6) * Math.PI * 2;
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.01, 0.014),
        bezelMat
      );
      tooth.position.set(
        Math.cos(ang) * 0.054,
        Math.sin(ang) * 0.054,
        -0.249
      );
      tooth.rotation.z = ang;
      model.add(tooth);
    }

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

    // F) BRAÇO DIREITO ORIGINAL DO ASTRONAUTA (`AstronautRightArm`) COM CAMUFLAGEM ASTRONÁUTICA SEGURANDO A LANTERNA!
    this.rightAstronautArm = createAstronautArmRig('right', astroMats, {
      includeUpperArm: true,
    });
    this.rightAstronautArm.setGripPose('flashlight');
    // Ombro direito projetado da borda inferior-direita -> antebraço camuflado sobe na diagonal até envolver a lanterna!
    this.rightAstronautArm.shoulderPivot.rotation.order = 'YXZ';
    this.rightAstronautArm.shoulderPivot.rotation.set(0.84, -0.18, -0.14);
    this.rightAstronautArm.elbowPivot.rotation.order = 'YXZ';
    this.rightAstronautArm.elbowPivot.rotation.set(1.12, 0.48, -0.04);
    this.rightAstronautArm.wristPivot.rotation.order = 'YXZ';
    this.rightAstronautArm.wristPivot.rotation.set(-1.92, -0.28, 0.26);
    this.rightAstronautArm.root.position.set(0, 0, 0);
    this.rightAstronautArm.root.updateMatrixWorld(true);
    const rightSocketOffset = new THREE.Vector3();
    this.rightAstronautArm.gripSocket.getWorldPosition(rightSocketOffset);
    // Alinha o centro exato da palma/dedos (`gripSocket`) ao tubo da lanterna (0.004, -0.004, -0.016)
    this.rightAstronautArm.root.position.set(
      0.004 - rightSocketOffset.x,
      -0.004 - rightSocketOffset.y,
      -0.016 - rightSocketOffset.z
    );
    model.add(this.rightAstronautArm.root);

    this.animGroup.add(model);
    this.rootGroup.add(this.animGroup);
    this.rootGroup.visible = false;
    this.viewScene.add(this.rootGroup);

    // ========================================================================
    // 2. BRAÇO ESQUERDO ORIGINAL DO ASTRONAUTA (`AstronautLeftArm`) + FACA E ITENS!
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

    // Braço Esquerdo Original Completo do Astronauta ancorado anatomicamente no OMBRO ESQUERDO!
    // Os objetos e o Canivete Oxidado são filhos diretos do `gripSocket` dentro da luva EVA de 5 dedos,
    // de modo que toda animação é conduzida pelas juntas reais (`shoulderPivot`, `elbowPivot`, `wristPivot`)!
    this.leftAstronautArm = createAstronautArmRig('left', astroMats, {
      includeUpperArm: true,
    });
    this.leftAstronautArm.setGripPose('knife');
    this.leftAstronautArm.shoulderPivot.rotation.order = 'YXZ';
    this.leftAstronautArm.elbowPivot.rotation.order = 'YXZ';
    this.leftAstronautArm.wristPivot.rotation.order = 'YXZ';
    this.leftAstronautArm.root.position.set(0, 0, 0);
    this.quickAnimGroup.add(this.leftAstronautArm.root);

    // Adaptador canônico dentro do `gripSocket` da luva esquerda:
    // +Y aponta para fora do topo do punho fechado (lado do polegar/indicador) e -Z aponta à frente pelos nós dos dedos!
    const itemSocketAdapter = new THREE.Group();
    itemSocketAdapter.name = 'AstronautLeftGripAdapter';
    itemSocketAdapter.rotation.set(-Math.PI * 0.5, 0, 0);
    this.leftAstronautArm.gripSocket.add(itemSocketAdapter);

    const honedEdgeMat = new THREE.MeshLambertMaterial({
      color: 0xeef4fc,
      flatShading: true,
    });

    // 2A) Canivete Oxidado Dobrável (`Canivete oxidado`) projetado para a luva EVA do Astronauta:
    // Cabo com virolas de latão + pino de abertura para polegar pressurizado + lâmina articulada com fio polido à frente (-Z)!
    const knifeProp = new THREE.Group();
    knifeProp.position.set(0.004, 0.006, -0.004);
    const kGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.118, 0.036),
      woodMat
    );
    const kBackSpring = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.122, 0.008),
      darkRingMat
    );
    kBackSpring.position.set(0, 0, 0.016);
    const kBladeSlot = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.112, 0.008),
      darkRingMat
    );
    kBladeSlot.position.set(0, 0.002, -0.015);
    const kBolsterFront = new THREE.Mesh(
      new THREE.BoxGeometry(0.033, 0.026, 0.042),
      brassMat
    );
    kBolsterFront.position.set(0, 0.056, 0);
    const kBolsterRear = new THREE.Mesh(
      new THREE.BoxGeometry(0.031, 0.022, 0.039),
      brassMat
    );
    kBolsterRear.position.set(0, -0.056, 0);
    const kBail = new THREE.Mesh(
      new THREE.TorusGeometry(0.012, 0.0028, 6, 10),
      brassMat
    );
    kBail.position.set(0, -0.072, 0.006);
    kBail.rotation.y = Math.PI * 0.5;
    for (const ry of [-0.03, 0, 0.028]) {
      const rvt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0042, 0.0042, 0.032, 6),
        brassMat
      );
      rvt.rotation.z = Math.PI * 0.5;
      rvt.position.set(0, ry, 0.002);
      knifeProp.add(rvt);
    }

    this.knifeBladePivot.name = 'AstronautPocketKnifeBladePivot';
    this.knifeBladePivot.position.set(0, 0.062, -0.002);

    const kRicasso = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.028, 0.033),
      darkRingMat
    );
    kRicasso.position.set(0, 0.014, 0.002);
    const kThumbStud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0058, 0.0058, 0.024, 8),
      brassMat
    );
    kThumbStud.rotation.z = Math.PI * 0.5;
    kThumbStud.position.set(0, 0.034, 0.008);
    const kBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.156, 0.032),
      bladeMat
    );
    kBlade.position.set(0, 0.102, 0.001);
    // Chanfro duplo (hollow grind) + fio polido para refletir a luz claramente em qualquer ângulo do golpe!
    const kBevelSlope = new THREE.Mesh(
      new THREE.BoxGeometry(0.0115, 0.156, 0.015),
      honedEdgeMat
    );
    kBevelSlope.position.set(0, 0.102, -0.009);
    const kEdgeBevel = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.158, 0.011),
      honedEdgeMat
    );
    // Fio cortante afiado voltado para -Z (direção dos nós dos dedos / trajetória de corte!)
    kEdgeBevel.position.set(0, 0.103, -0.016);
    const kSpine = new THREE.Mesh(
      new THREE.BoxGeometry(0.0135, 0.148, 0.009),
      darkRingMat
    );
    kSpine.position.set(0, 0.098, 0.015);
    const kFuller = new THREE.Mesh(
      new THREE.BoxGeometry(0.0125, 0.112, 0.007),
      rustMat
    );
    kFuller.position.set(0, 0.098, 0.005);
    const kTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.021, 0.068, 4),
      honedEdgeMat
    );
    kTip.scale.set(0.32, 1, 1);
    kTip.position.set(0, 0.208, -0.002);
    this.knifeBladePivot.add(
      kRicasso,
      kThumbStud,
      kBlade,
      kBevelSlope,
      kEdgeBevel,
      kSpine,
      kFuller,
      kTip
    );

    knifeProp.add(
      kGrip,
      kBackSpring,
      kBladeSlot,
      kBolsterFront,
      kBolsterRear,
      kBail,
      this.knifeBladePivot
    );

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

    // 2C) Frasco Apotecário de Láudano
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

    // 2D) Bateria Industrial 9V
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

    // 2E) Bastão de Magnésio
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

    // 2F) Chave Maciça de Latão — Ala B segurada pela luva EVA do Astronauta
    const keyProp = new THREE.Group();
    const keyBow = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.0075, 8, 14),
      brassMat
    );
    keyBow.position.set(0.01, 0.018, -0.008);
    const keyCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.016, 8),
      brassMat
    );
    keyCollar.position.set(0.01, 0.052, -0.008);
    const keyStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.0065, 0.128, 8),
      brassMat
    );
    keyStem.position.set(0.01, 0.118, -0.008);
    const keyBitA = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.018, 0.007),
      brassMat
    );
    keyBitA.position.set(0.024, 0.15, -0.008);
    const keyBitB = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.012, 0.007),
      brassMat
    );
    keyBitB.position.set(0.021, 0.172, -0.008);
    const keyTag = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.044, 0.006),
      bezelMat
    );
    keyTag.position.set(-0.016, -0.018, 0.008);
    keyTag.rotation.z = -0.35;
    keyProp.add(keyBow, keyCollar, keyStem, keyBitA, keyBitB, keyTag);

    this.quickPropMeshes = {
      knife: knifeProp,
      bandage: bandageProp,
      morphine: morphineProp,
      battery: batteryProp,
      flare: flareProp,
      key: keyProp,
    };

    for (const k of Object.keys(this.quickPropMeshes) as QuickHandheldKind[]) {
      const m = this.quickPropMeshes[k];
      m.visible = false;
      itemSocketAdapter.add(m);
    }

    // Ancora `quickRootGroup` diretamente na posição anatômica do ombro esquerdo do Astronauta na viewCamera!
    this.quickRootGroup.position.set(-0.29, -0.23, 0.04);
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
   * Verdadeiro se qualquer modelo 3D em 1ª pessoa (lanterna ou braço esquerdo de item rápido) estiver visível.
   */
  get isVisibleInView(): boolean {
    return this.rootGroup.visible || this.quickRootGroup.visible;
  }

  /**
   * Verdadeiro enquanto o braço esquerdo do astronauta estiver animando o uso de faca ou objeto.
   */
  get isLeftArmAnimating(): boolean {
    return this.quickRootGroup.visible && this.activeQuickKind !== null;
  }

  /**
   * Guarda e oculta imediatamente qualquer objeto segurado nas mãos (usado durante desmaio, arrasto e despertar).
   */
  forceStowImmediate(): void {
    this.equipped = false;
    this.lightActive = false;
    this.equipProgress = 0;
    this.switchProgress = 0;
    this.flickerWarmup = 0;
    this.knockoutDropActive = false;
    this.knockoutDropTimer = 0;
    this.knockoutDropStartProgress = 0;
    this.knockoutWasLit = false;
    this.activeQuickKind = null;
    this.quickTimer = 0;
    this.swayX = 0;
    this.swayY = 0;

    this.rootGroup.visible = false;
    this.quickRootGroup.visible = false;
    this.rightAstronautArm.setInUse(false);
    this.leftAstronautArm.setInUse(false);

    for (const k of Object.keys(this.quickPropMeshes) as QuickHandheldKind[]) {
      this.quickPropMeshes[k].visible = false;
    }

    this.bulbMaterial.color.setHex(0x3a362e);
    this.reflectorMaterial.color.setHex(0x4b5059);
    this.lensMaterial.color.setHex(0x191d23);
  }

  /**
   * Acionado no exato instante em que a Aranha Gigante ataca/sequestra o jogador:
   * - Cancela imediatamente qualquer animação do braço esquerdo;
   * - Se a lanterna estava empunhada, inicia uma queda violenta do braço do astronauta (~0.40s)
   *   enquanto a lâmpada falha e apaga no impacto, nunca ficando na mão durante o desmaio/arrasto!
   */
  beginKnockoutDrop(): void {
    this.activeQuickKind = null;
    this.quickTimer = 0;
    this.quickRootGroup.visible = false;
    this.leftAstronautArm.setInUse(false);
    for (const k of Object.keys(this.quickPropMeshes) as QuickHandheldKind[]) {
      this.quickPropMeshes[k].visible = false;
    }

    const wasShowing = this.equipProgress > 0.015 || this.rootGroup.visible;
    const wasLit = this.lightActive;
    this.equipped = false;
    this.lightActive = false;
    this.flickerWarmup = 0;

    if (!wasShowing) {
      this.forceStowImmediate();
      return;
    }

    this.knockoutDropActive = true;
    this.knockoutDropTimer = 0;
    this.knockoutDropStartProgress = Math.max(0.25, this.equipProgress);
    this.knockoutWasLit = wasLit;
  }

  /**
   * Atualiza a queda da lanterna durante o impacto inicial do bote e oculta totalmente antes do desmaio/arrasto.
   */
  updateKnockoutDrop(
    dt: number,
    batteryPercent = 100
  ): {
    beamIntensity: number;
    aimYawOffset: number;
    aimPitchOffset: number;
  } {
    this.quickRootGroup.visible = false;
    this.activeQuickKind = null;
    this.leftAstronautArm.setInUse(false);

    if (!this.knockoutDropActive) {
      this.rootGroup.visible = false;
      this.rightAstronautArm.setInUse(false);
      this.equipProgress = 0;
      return { beamIntensity: 0, aimYawOffset: 0, aimPitchOffset: 0 };
    }

    this.knockoutDropTimer += Math.max(0, dt);
    const dropDuration = 0.4;
    const u = Math.min(1, this.knockoutDropTimer / dropDuration);

    if (u >= 1) {
      this.forceStowImmediate();
      return { beamIntensity: 0, aimYawOffset: 0, aimPitchOffset: 0 };
    }

    const fall = u * u * (1.35 - 0.35 * u);
    this.equipProgress = this.knockoutDropStartProgress * (1 - u);
    this.rootGroup.visible = true;
    this.rightAstronautArm.setInUse(true);

    const startX = 0.235;
    const startY = -0.195;
    const startZ = -0.41;

    this.rootGroup.position.set(
      startX + fall * 0.24,
      startY - fall * 0.56,
      startZ + fall * 0.14
    );

    this.animGroup.rotation.set(
      0.045 - fall * 1.42,
      0.11 - fall * 0.52,
      -0.06 + fall * 1.05
    );

    let beamIntensity = 0;
    if (this.knockoutWasLit && batteryPercent > 0.2 && u < 0.6) {
      const pulse =
        u < 0.14 || (u >= 0.24 && u < 0.38)
          ? 0.85 * (1 - u / 0.6)
          : 0.08 * (1 - u / 0.6);
      beamIntensity = Math.max(0, pulse);
    }

    if (beamIntensity > 0.05) {
      this.bulbMaterial.color.setHex(0xfff9de);
      this.reflectorMaterial.color.setHex(0xd8c394);
      this.lensMaterial.color.setHex(0xfff0be);
    } else {
      this.bulbMaterial.color.setHex(0x3a362e);
      this.reflectorMaterial.color.setHex(0x4b5059);
      this.lensMaterial.color.setHex(0x191d23);
    }

    return {
      beamIntensity,
      aimYawOffset: -fall * 0.45,
      aimPitchOffset: -fall * 1.15,
    };
  }

  /**
   * Dispara animação 3D imediata com o Braço Esquerdo Original do Astronauta (`AstronautLeftArm`)!
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
            : kind === 'key'
              ? 0.58
              : 0.62;

    if (kind === 'knife' || kind === 'flare') {
      this.leftAstronautArm.setGripPose('knife');
    } else if (kind === 'battery') {
      this.leftAstronautArm.setGripPose('box');
    } else if (kind === 'key') {
      this.leftAstronautArm.setGripPose('key');
    } else {
      this.leftAstronautArm.setGripPose('cylindrical');
    }

    for (const k of Object.keys(this.quickPropMeshes) as QuickHandheldKind[]) {
      this.quickPropMeshes[k].visible = k === kind;
    }
    this.leftAstronautArm.setInUse(true);
    this.quickRootGroup.visible = true;
  }

  /**
   * Alterna a lanterna ao pressionar F.
   */
  toggle(): boolean {
    this.knockoutDropActive = false;
    this.knockoutDropTimer = 0;
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
      this.leftAstronautArm.setInUse(false);
      return;
    }

    this.quickTimer += dt;
    const u = this.quickTimer / this.quickDuration;
    if (u >= 1) {
      this.activeQuickKind = null;
      this.quickRootGroup.visible = false;
      this.leftAstronautArm.setInUse(false);
      return;
    }

    this.leftAstronautArm.setInUse(true);
    this.quickAnimGroup.rotation.set(0, 0, 0);
    const kind = this.activeQuickKind;

    if (kind === 'knife') {
      // Animação EVA Anatômica do Canivete Oxidado (`AstronautLeftArm` ancorado no ombro esquerdo):
      // Fase 1 (0..0.24): Saque rápido elevando antebraço camuflado + manômetro O2 + abertura mecânica da lâmina (`knifeBladePivot`);
      // Fase 2 (0.24..0.68): Golpe diagonal vigoroso cruzando a mira, conduzido pelo ombro + fole do cotovelo + giro axial do punho;
      // Fase 3 (0.68..1.0): Recuo tático amortecido de volta ao coldre esquerdo!
      if (u < 0.24) {
        const p = u / 0.24;
        const e = 1 - Math.pow(1 - p, 3);
        const flickOvershoot =
          p < 0.82
            ? -2.05 * (1 - Math.pow(p / 0.82, 2.2))
            : Math.sin(((p - 0.82) / 0.18) * Math.PI) * 0.09;
        this.knifeBladePivot.rotation.set(flickOvershoot, 0, 0);

        this.quickRootGroup.position.set(
          -0.31 + 0.04 * e,
          -0.26 + 0.09 * e,
          0.08 - 0.02 * e
        );
        this.leftAstronautArm.shoulderPivot.rotation.set(
          0.74 + 0.52 * e,
          -0.02 - 0.06 * e,
          0.04 + 0.08 * e
        );
        this.leftAstronautArm.elbowPivot.rotation.set(
          0.58 + 0.24 * e,
          -0.08 - 0.08 * e,
          0.16 + 0.16 * e
        );
        this.leftAstronautArm.wristPivot.rotation.set(
          -0.06 * e,
          0.18 * e,
          -0.12 * e
        );
      } else if (u < 0.68) {
        const p = (u - 0.24) / 0.44;
        const slash = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const lunge = Math.sin(slash * Math.PI);
        this.knifeBladePivot.rotation.set(0, 0, 0);

        // Mantém 100% da lâmina, da luva EVA, do anel azul e do manômetro O2 visíveis cruzando a mira em diagonal!
        this.quickRootGroup.position.set(
          -0.27 + slash * 0.06,
          -0.17 + slash * 0.015,
          0.06 + slash * 0.03 - lunge * 0.015
        );
        this.leftAstronautArm.shoulderPivot.rotation.set(
          1.26 + lunge * 0.05 - slash * 0.04,
          -0.08 - slash * 0.18,
          0.12 + slash * 0.13
        );
        this.leftAstronautArm.elbowPivot.rotation.set(
          0.82 - slash * 0.08 + lunge * 0.04,
          -0.16 - slash * 0.08,
          0.32 + slash * 0.08
        );
        // Pronação axial controlada (`ry: +0.18 -> -0.44`) do anel metálico EVA de desconexão de punho:
        // inclina a lâmina diagonalmente (~45°) para a direita através da mira conduzindo o golpe pelo fio polido!
        this.leftAstronautArm.wristPivot.rotation.set(
          -0.06 - slash * 0.34,
          0.18 - slash * 0.62,
          -0.12 - slash * 0.24
        );
      } else {
        const p = (u - 0.68) / 0.32;
        const e = p * p * (3 - 2 * p);
        this.knifeBladePivot.rotation.set(
          -0.95 * Math.max(0, (p - 0.35) / 0.65),
          0,
          0
        );

        this.quickRootGroup.position.set(
          -0.21 - e * 0.1,
          -0.155 - e * 0.13,
          0.09
        );
        this.leftAstronautArm.shoulderPivot.rotation.set(
          1.22 - e * 0.52,
          -0.26 + e * 0.22,
          0.25 - e * 0.2
        );
        this.leftAstronautArm.elbowPivot.rotation.set(
          0.74 - e * 0.18,
          -0.24 + e * 0.16,
          0.4 - e * 0.24
        );
        this.leftAstronautArm.wristPivot.rotation.set(
          -0.4 + e * 0.4,
          -0.44 + e * 0.44,
          -0.36 + e * 0.36
        );
      }
      return;
    }

    // Demais ações rápidas (`flare`, `bandage`, `morphine`, `key`, `battery`) articuladas pelas juntas EVA do ombro/cotovelo/punho!
    this.knifeBladePivot.rotation.set(0, 0, 0);
    const arc = Math.sin(u * Math.PI);
    const raise = 1 - Math.pow(1 - arc, 2);

    if (kind === 'flare') {
      const toss = u > 0.55 ? (u - 0.55) / 0.45 : 0;
      const strikeJitter = Math.sin(u * 28) * 0.06 * (1 - toss);
      this.quickRootGroup.position.set(
        -0.27 + toss * 0.05,
        -0.24 + raise * 0.11 - toss * 0.06,
        0.04 - toss * 0.06
      );
      this.leftAstronautArm.shoulderPivot.rotation.set(
        0.65 + raise * 0.62 + toss * 0.24,
        -0.14 - toss * 0.22,
        0.12 + raise * 0.16
      );
      this.leftAstronautArm.elbowPivot.rotation.set(
        0.58 + raise * 0.26 - toss * 0.42,
        -0.18,
        0.26 + strikeJitter
      );
      this.leftAstronautArm.wristPivot.rotation.set(
        -0.08 - toss * 0.26,
        0.18 + strikeJitter * 1.4,
        -0.1
      );
      this.flareSparkMesh.scale.setScalar(
        u > 0.22 ? 0.75 + Math.sin(u * 55) * 0.35 : 0.01
      );
    } else if (kind === 'bandage') {
      const wrapOsc = Math.sin(u * Math.PI * 3);
      this.quickRootGroup.position.set(-0.26, -0.24 + raise * 0.11, 0.04);
      this.leftAstronautArm.shoulderPivot.rotation.set(
        0.64 + raise * 0.62,
        -0.2 - wrapOsc * 0.12,
        0.16 + raise * 0.18
      );
      this.leftAstronautArm.elbowPivot.rotation.set(
        0.58 + raise * 0.3,
        -0.22 + wrapOsc * 0.16,
        0.3 + wrapOsc * 0.08
      );
      this.leftAstronautArm.wristPivot.rotation.set(
        0.12,
        0.28 + wrapOsc * 0.38,
        -0.14
      );
    } else if (kind === 'morphine') {
      const tilt =
        u > 0.3 && u < 0.78 ? Math.sin(((u - 0.3) / 0.48) * Math.PI) : 0;
      this.quickRootGroup.position.set(
        -0.26 + tilt * 0.03,
        -0.24 + raise * 0.12,
        0.04
      );
      this.leftAstronautArm.shoulderPivot.rotation.set(
        0.65 + raise * 0.64 + tilt * 0.12,
        -0.22 - tilt * 0.14,
        0.16 + raise * 0.2
      );
      this.leftAstronautArm.elbowPivot.rotation.set(
        0.58 + raise * 0.3 + tilt * 0.12,
        -0.24,
        0.3
      );
      this.leftAstronautArm.wristPivot.rotation.set(
        0.16 + tilt * 0.28,
        0.22,
        -0.18 - tilt * 0.22
      );
    } else if (kind === 'key') {
      const turn =
        u > 0.32 && u < 0.76 ? Math.sin(((u - 0.32) / 0.44) * Math.PI) : 0;
      this.quickRootGroup.position.set(
        -0.26 + raise * 0.03,
        -0.24 + raise * 0.11,
        0.03 - raise * 0.03
      );
      this.leftAstronautArm.shoulderPivot.rotation.set(
        0.66 + raise * 0.64,
        -0.18 - raise * 0.12,
        0.14 + raise * 0.16
      );
      this.leftAstronautArm.elbowPivot.rotation.set(
        0.56 + raise * 0.24,
        -0.2,
        0.26
      );
      this.leftAstronautArm.wristPivot.rotation.set(
        -0.18,
        0.18 + turn * 0.85,
        -0.12 + turn * 0.22
      );
    } else {
      this.quickRootGroup.position.set(
        -0.26 + raise * 0.06,
        -0.25 + raise * 0.11,
        0.04
      );
      this.leftAstronautArm.shoulderPivot.rotation.set(
        0.64 + raise * 0.58,
        -0.18 - raise * 0.34,
        0.16 + raise * 0.26
      );
      this.leftAstronautArm.elbowPivot.rotation.set(
        0.56 + raise * 0.26,
        -0.22,
        0.3
      );
      this.leftAstronautArm.wristPivot.rotation.set(0.14, -0.18, -0.16);
    }
  }

  /**
   * Atualiza a animação de saque/guarda da lanterna no Braço Direito do Astronauta,
   * o clique físico do botão + polegar EVA e qualquer animação do Braço Esquerdo do Astronauta.
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

    const rightVisible = this.equipProgress > 0.005;
    this.rootGroup.visible = rightVisible;
    this.rightAstronautArm.setInUse(rightVisible);

    // Animação do botão físico + polegar articulado da luva EVA direita na parte superior da lanterna
    const targetSwitch = this.lightActive ? 1 : 0;
    this.switchProgress +=
      (targetSwitch - this.switchProgress) * (1 - Math.exp(-22 * dt));
    this.switchMesh.position.z = -0.068 - this.switchProgress * 0.014;
    this.switchMesh.position.y = 0.044 - this.switchProgress * 0.0025;
    this.rightAstronautArm.thumbTipPivot.rotation.x =
      0.28 + this.switchProgress * 0.34;

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

    if (beamIntensity > 0.05) {
      this.bulbMaterial.color.setHex(0xfff9de);
      this.reflectorMaterial.color.setHex(0xd8c394);
      this.lensMaterial.color.setHex(0xfff0be);
    } else {
      this.bulbMaterial.color.setHex(0x3a362e);
      this.reflectorMaterial.color.setHex(0x4b5059);
      this.lensMaterial.color.setHex(0x191d23);
    }

    const t = this.equipProgress;
    const c1 = 1.45;
    const c3 = c1 + 1;
    const eased =
      t <= 0
        ? 0
        : t >= 1
          ? 1
          : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

    const relax = 1 - Math.exp(-10 * dt);
    this.swayX += (0 - this.swayX) * relax;
    this.swayY += (0 - this.swayY) * relax;

    const moveFactor = Math.min(1, planarSpeed / 6.0);
    const bobScale = 1 - crouchAmount * 0.35;
    const walkX = Math.cos(bobPhase * 0.5) * 0.014 * moveFactor * bobScale;
    const walkY =
      Math.abs(Math.sin(bobPhase * 0.5)) * -0.016 * moveFactor * bobScale;

    const stowedX = 0.34;
    const stowedY = -0.52;
    const stowedZ = -0.26;

    const heldX = 0.212 - crouchAmount * 0.018;
    const heldY = -0.162 + crouchAmount * 0.014;
    const heldZ = -0.43 + crouchAmount * 0.018;

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
