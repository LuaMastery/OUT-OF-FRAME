import * as THREE from 'three';

/**
 * Gera uma textura pixel-art simples (32x32, NearestFilter) para o corpo metálico
 * fosco da lanterna com ranhuras de empunhadura.
 */
function createFlashlightBodyTexture(): THREE.DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Leve variação ao redor do cilindro + ranhuras horizontais simples
      const angleShade = Math.sin((x / size) * Math.PI * 2) * 10;
      const knurl = y >= 8 && y <= 24 && (x + y) % 2 === 0 ? -9 : 0;
      const seam = y === 6 || y === 26 ? -14 : 0;
      const base = Math.max(
        24,
        Math.min(115, Math.round(62 + angleShade + knurl + seam))
      );

      data[idx] = base;
      data[idx + 1] = Math.round(base * 1.03);
      data[idx + 2] = Math.round(base * 1.08);
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
 * Modelagem 3D simples e limpa de uma lanterna de mão em primeira pessoa
 * (corpo cilíndrico, anéis de pega, botão deslizante superior, bocal alargado e lente),
 * renderizada na mesma câmera/resolução retrô do labirinto DOOM.
 */
export class DoomFlashlight {
  readonly viewScene = new THREE.Scene();
  readonly viewCamera: THREE.PerspectiveCamera;

  private readonly rootGroup = new THREE.Group();
  private readonly animGroup = new THREE.Group();
  private readonly switchMesh: THREE.Mesh;
  private readonly lensMaterial: THREE.MeshBasicMaterial;
  private readonly innerGlowMaterial: THREE.MeshBasicMaterial;

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

    // Iluminação direcional simples para destacar as facetas low-poly da lanterna
    const ambient = new THREE.AmbientLight(0x8c8e96, 0.9);
    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.35);
    keyLight.position.set(-0.6, 1.2, 0.9);
    const rimLight = new THREE.DirectionalLight(0x7d8799, 0.55);
    rimLight.position.set(0.8, -0.4, 0.3);
    this.viewScene.add(ambient, keyLight, rimLight);

    const bodyTex = createFlashlightBodyTexture();

    const bodyMat = new THREE.MeshLambertMaterial({
      map: bodyTex,
      color: 0x9aa0aa,
      flatShading: true,
    });

    const darkRingMat = new THREE.MeshLambertMaterial({
      color: 0x26292f,
      flatShading: true,
    });

    const bezelMat = new THREE.MeshLambertMaterial({
      color: 0x565b65,
      flatShading: true,
    });

    const switchMat = new THREE.MeshLambertMaterial({
      color: 0x9e2a2b, // botão tático discreto escuro
      flatShading: true,
    });

    this.lensMaterial = new THREE.MeshBasicMaterial({
      color: 0x1b2026,
    });

    this.innerGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff3c4,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // ------------------------------------------------------------------------
    // MODELAGEM SIMPLES DA LANTERNA (orientada ao longo do eixo -Z)
    // ------------------------------------------------------------------------
    const model = new THREE.Group();

    // 1. Tampa traseira (tailcap)
    const tailCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.033, 0.04, 8),
      darkRingMat
    );
    tailCap.rotation.x = Math.PI * 0.5;
    tailCap.position.z = 0.14;
    model.add(tailCap);

    // 2. Corpo cilíndrico principal (empunhadura low-poly de 8 faces)
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8),
      bodyMat
    );
    handle.rotation.x = Math.PI * 0.5;
    handle.position.z = 0.0;
    model.add(handle);

    // 3. Três anéis simples de aderência no cabo
    for (const zOff of [0.07, 0.015, -0.04]) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0375, 0.0375, 0.014, 8),
        darkRingMat
      );
      ring.rotation.x = Math.PI * 0.5;
      ring.position.z = zOff;
      model.add(ring);
    }

    // 4. Base e botão superior de acionamento
    const switchBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.01, 0.052),
      darkRingMat
    );
    switchBase.position.set(0, 0.036, -0.075);
    model.add(switchBase);

    this.switchMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.012, 0.024),
      switchMat
    );
    this.switchMesh.position.set(0, 0.043, -0.068);
    model.add(this.switchMesh);

    // 5. Pescoço cônico ligando o cabo à cabeça da lanterna
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.036, 0.055, 8),
      bezelMat
    );
    neck.rotation.x = Math.PI * 0.5;
    neck.position.z = -0.145;
    model.add(neck);

    // 6. Cabeça octogonal frontal (bocal simples)
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.053, 0.068, 8),
      bezelMat
    );
    head.rotation.x = Math.PI * 0.5;
    head.position.z = -0.205;
    model.add(head);

    // Aro frontal escuro na borda do bocal
    const frontRim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.058, 0.014, 8),
      darkRingMat
    );
    frontRim.rotation.x = Math.PI * 0.5;
    frontRim.position.z = -0.236;
    model.add(frontRim);

    // 7. Lente frontal e cone curto sutil de feixe saindo do bocal quando acesa
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.048, 8),
      this.lensMaterial
    );
    lens.position.z = -0.244;
    lens.material.side = THREE.DoubleSide;
    model.add(lens);

    const beamConeGeo = new THREE.ConeGeometry(0.13, 0.42, 8, 1, true);
    // ConeGeometry aponta para +Y por padrão; giramos para abrir de z=-0.24 até z=-0.66
    beamConeGeo.translate(0, -0.21, 0);
    beamConeGeo.rotateX(Math.PI * 0.5);
    const beamCone = new THREE.Mesh(beamConeGeo, this.innerGlowMaterial);
    beamCone.position.z = -0.24;
    model.add(beamCone);

    this.animGroup.add(model);
    this.rootGroup.add(this.animGroup);
    this.rootGroup.visible = false;
    this.viewScene.add(this.rootGroup);
  }

  setAspect(aspect: number): void {
    this.viewCamera.aspect = aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  /**
   * Alterna a lanterna ao pressionar F:
   * - Se guardada: inicia animação de saque + liga o foco.
   * - Se empunhada: desliga o foco + inicia animação de guardar.
   * Retorna o novo estado desejado (`true` = ligando/sacando, `false` = desligando/guardando).
   */
  toggle(): boolean {
    this.equipped = !this.equipped;
    if (!this.equipped) {
      // Ao desligar, o clique apaga a luz imediatamente enquanto a mão abaixa a lanterna
      this.lightActive = false;
      this.flickerWarmup = 0;
    }
    return this.equipped;
  }

  addLookImpulse(deltaYaw: number, deltaPitch: number): void {
    this.swayX = Math.max(-0.045, Math.min(0.045, this.swayX + deltaYaw * 0.14));
    this.swayY = Math.max(
      -0.035,
      Math.min(0.035, this.swayY + deltaPitch * 0.14)
    );
  }

  /**
   * Atualiza a animação de saque/guarda, o clique físico do botão,
   * o balanço dos passos e retorna a intensidade atual do feixe de luz [0..1]
   * além do desvio angular sutil do foco acompanhando a mão.
   */
  update(
    dt: number,
    bobPhase: number,
    planarSpeed: number,
    onSwitchClickOn: () => void
  ): {
    beamIntensity: number;
    aimYawOffset: number;
    aimPitchOffset: number;
  } {
    // 1. Progresso de equipar / guardar
    const speed = this.equipped ? 3.2 : 3.7;
    if (this.equipped && this.equipProgress < 1) {
      const prev = this.equipProgress;
      this.equipProgress = Math.min(1, this.equipProgress + dt * speed);
      // No meio da subida (~58%), o polegar aciona o botão e acende o feixe!
      if (prev < 0.58 && this.equipProgress >= 0.58 && !this.lightActive) {
        this.lightActive = true;
        this.flickerWarmup = 0.01;
        onSwitchClickOn();
      }
    } else if (!this.equipped && this.equipProgress > 0) {
      this.equipProgress = Math.max(0, this.equipProgress - dt * speed);
    }

    this.rootGroup.visible = this.equipProgress > 0.005;

    // 2. Animação do botão físico na parte superior da lanterna
    const targetSwitch = this.lightActive ? 1 : 0;
    this.switchProgress +=
      (targetSwitch - this.switchProgress) * (1 - Math.exp(-22 * dt));
    this.switchMesh.position.z = -0.068 - this.switchProgress * 0.014;
    this.switchMesh.position.y = 0.043 - this.switchProgress * 0.0025;

    // 3. Aquecimento rápido de filamento halógeno ao ligar (~65ms)
    let beamIntensity = 0;
    if (this.lightActive) {
      this.flickerWarmup = Math.min(1, this.flickerWarmup + dt * 15);
      beamIntensity =
        this.flickerWarmup < 0.45 ? 0.55 : this.flickerWarmup;
    }

    // Atualiza cor da lente e cone curto de saída
    if (beamIntensity > 0.05) {
      this.lensMaterial.color.setHex(0xfff2c2);
      this.innerGlowMaterial.opacity = 0.11 * beamIntensity;
    } else {
      this.lensMaterial.color.setHex(0x1b2026);
      this.innerGlowMaterial.opacity = 0;
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

    // Balanço de caminhada em 8 (Lissajous clássico de FPS)
    const moveFactor = Math.min(1, planarSpeed / 6.0);
    const walkX = Math.cos(bobPhase * 0.5) * 0.014 * moveFactor;
    const walkY = Math.abs(Math.sin(bobPhase * 0.5)) * -0.016 * moveFactor;

    // Posição na mão direita: sobe de baixo/direita até a posição de empunhadura
    const stowedX = 0.34;
    const stowedY = -0.52;
    const stowedZ = -0.26;

    const heldX = 0.235;
    const heldY = -0.195;
    const heldZ = -0.41;

    this.rootGroup.position.set(
      stowedX + (heldX - stowedX) * eased + walkX + this.swayX,
      stowedY + (heldY - stowedY) * eased + walkY + this.swayY,
      stowedZ + (heldZ - stowedZ) * eased
    );

    // Rotação: levanta o bocal da lanterna e aponta levemente para o centro da tela
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
