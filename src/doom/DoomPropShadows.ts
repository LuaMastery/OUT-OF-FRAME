import * as THREE from 'three';

/**
 * Sombras projetadas de objetos (caixotes, peças soltas) sobre a superfície em
 * que estão apoiados.
 *
 * O mundo DOOM é desenhado inteiro por shaders próprios (`DoomShader.ts`), sem
 * nenhuma luz do three.js — então um shadow map tradicional não escurece o
 * piso. Em vez disso, cada objeto recebe um "decalque" de sombra: uma elipse
 * escura e suave deitada sobre a superfície, que
 *
 *   1. sempre existe um pouco (oclusão de contato: o objeto tampa a luz
 *      ambiente que chegaria ao chão logo abaixo dele);
 *   2. escurece e se alonga conforme a luz dominante da arena, apontando para
 *      o lado OPOSTO a essa luz — exatamente como uma sombra real.
 *
 * O resultado conversa com o sombreamento difuso dos materiais de prop, então
 * o objeto fica claro do lado da lâmpada e na sombra do outro.
 */

/** Amostra de luz usada para posicionar/clarear a sombra. */
export interface PropLightSample {
  readonly position: THREE.Vector3;
  readonly intensity: number;
}

/**
 * Textura radial usada pelos decalques de sombra: preto no centro sumindo
 * suavemente nas bordas (a transparência é a própria intensidade da sombra).
 */
export function createDoomShadowDecalTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - half) / half;
      const v = (y - half) / half;
      const r = Math.min(1, Math.hypot(u, v));
      const falloff = Math.pow(1 - r, 1.7);
      const idx = (y * size + x) * 4;
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = Math.max(0, Math.min(255, Math.round(falloff * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Calcula, para um ponto do mundo, quanta luz está chegando e de onde ela vem.
 *
 * Usa exatamente o mesmo modelo de atenuação do shader dos props
 * (`atten = clamp(1 - d / 9.2)^2`), então a sombra acompanha o brilho que a
 * superfície de fato recebe.
 */
export class PropLightingProbe {
  /** Soma das contribuições das luzes sobre o ponto (0 = breu total). */
  level = 0;
  /** Direção horizontal normalizada para onde a sombra deve apontar. */
  dirX = 0;
  dirZ = 0;
  /** Altura (m) da luz dominante. */
  lightY = 0;
  /** Distância horizontal (m) até a luz dominante. */
  distance = 0;

  /**
   * Amostra as luzes em relação a `target`.
   *
   * @param extraLight fonte opcional (a lanterna do jogador, por exemplo) que
   * entra na conta mesmo não sendo uma luz estática da arena.
   */
  sample(
    target: THREE.Vector3,
    lights: readonly PropLightSample[],
    extraLight?: {
      position: THREE.Vector3;
      intensity: number;
      /** Direção para onde o feixe aponta; fora do cone a luz não conta. */
      direction?: THREE.Vector3;
      /** Cosseno mínimo para o ponto ser considerado dentro do cone. */
      coneCos?: number;
    } | null
  ): void {
    this.level = 0;
    this.dirX = 0;
    this.dirZ = 1;
    this.lightY = 0;
    this.distance = 0;

    let bestContribution = 0;

    for (let i = 0; i < lights.length; i++) {
      const src = lights[i];
      if (src.intensity <= 0.001) continue;
      const dx = target.x - src.position.x;
      const dy = target.y - src.position.y;
      const dz = target.z - src.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const atten = Math.max(0, Math.min(1, 1 - d / 9.2));
      const contribution = atten * atten * src.intensity;
      if (contribution <= 0.0005) continue;
      this.level += contribution;
      if (contribution > bestContribution) {
        bestContribution = contribution;
        const horiz = Math.hypot(dx, dz) || 0.0001;
        this.dirX = dx / horiz;
        this.dirZ = dz / horiz;
        this.lightY = src.position.y;
        this.distance = horiz;
      }
    }

    if (extraLight && extraLight.intensity > 0.01) {
      const dx = target.x - extraLight.position.x;
      const dy = target.y - extraLight.position.y;
      const dz = target.z - extraLight.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let coneFactor = 1;
      if (extraLight.direction) {
        const dir = extraLight.direction;
        const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
        const cos =
          (dx * dir.x + dy * dir.y + dz * dir.z) / (Math.max(d, 0.0001) * len);
        const minCos = extraLight.coneCos ?? 0.75;
        coneFactor = Math.max(
          0,
          Math.min(1, (cos - minCos) / Math.max(0.0001, 1 - minCos))
        );
      }
      const atten = Math.max(0, Math.min(1, 1 - d / 23));
      const contribution = atten * coneFactor * extraLight.intensity;
      if (contribution > 0.0005) {
        this.level += contribution;
        if (contribution > bestContribution) {
          const horiz = Math.hypot(dx, dz) || 0.0001;
          this.dirX = dx / horiz;
          this.dirZ = dz / horiz;
          this.lightY = extraLight.position.y;
          this.distance = horiz;
        }
      }
    }
  }
}

export interface PropContactShadowOptions {
  /** Metade da largura (m) do objeto no eixo local X. */
  halfX: number;
  /** Metade da profundidade (m) do objeto no eixo local Z. */
  halfZ: number;
  /** Altura (m) do objeto — quanto mais alto, mais longa a sombra. */
  height: number;
  /** Rotação (rad) do objeto em volta de Y. */
  yaw?: number;
  /** Opacidade mínima, com o objeto no breu (resíduo de oclusão de contato). */
  ambientOpacity?: number;
  /** Opacidade com luz média/forte. */
  litOpacity?: number;
  /** Alongamento máximo (m) da sombra projetada. */
  maxLength?: number;
  /** Distância (m) entre o decalque e a superfície, para evitar z-fighting. */
  surfaceLift?: number;
}

/**
 * Mancha de sombra de um objeto apoiado numa superfície.
 *
 * O grupo devolvido em `object` deve ser adicionado ao mesmo pai do objeto
 * (sem rotação própria) e posicionado na base dele; a elipse acompanha
 * automaticamente o formato do objeto através de `yaw`.
 */
export class PropContactShadow {
  readonly object: THREE.Group;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly halfX: number;
  private readonly halfZ: number;
  private readonly height: number;
  private readonly maxLength: number;
  private readonly ambientOpacity: number;
  private readonly litOpacity: number;
  private readonly lift: number;

  private opacity: number;
  private length = 0;

  constructor(
    texture: THREE.Texture,
    options: PropContactShadowOptions
  ) {
    this.halfX = Math.max(0.01, options.halfX);
    this.halfZ = Math.max(0.01, options.halfZ);
    this.height = Math.max(0.01, options.height);
    this.maxLength = Math.max(0, options.maxLength ?? 0.12);
    this.ambientOpacity = Math.max(0, options.ambientOpacity ?? 0.3);
    this.litOpacity = Math.max(this.ambientOpacity, options.litOpacity ?? 0.72);
    this.lift = options.surfaceLift ?? 0.006;
    this.opacity = this.ambientOpacity;

    this.material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0x000000,
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.material
    );
    this.mesh.name = 'PropShadowDecal';
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = this.lift;
    this.mesh.renderOrder = 2;
    this.mesh.matrixAutoUpdate = true;

    this.object = new THREE.Group();
    this.object.name = 'PropContactShadow';
    this.object.rotation.y = options.yaw ?? 0;
    this.object.add(this.mesh);

    // Estado inicial: sombra de contato neutra, sem direção.
    this.applyDirection(0, 1, 0);
  }

  /**
   * @param level intensidade acumulada das luzes sobre o objeto (0 = breu).
   * @param dirX direção horizontal da sombra (para onde ela aponta).
   * @param dirZ direção horizontal da sombra (para onde ela aponta).
   * @param lightY altura da luz dominante (0 = luz baixa/rasante).
   * @param lightDistance distância horizontal até a luz dominante.
   * @param blend 0..1 — quanto da atualização aplicar neste frame (suavização).
   */
  update(
    level: number,
    dirX: number,
    dirZ: number,
    lightY: number,
    lightDistance: number,
    blend = 1
  ): void {
    const lit = Math.max(0, Math.min(1, level / 1.15));
    const targetOpacity =
      this.ambientOpacity + (this.litOpacity - this.ambientOpacity) * lit;

    // Projeção da sombra: quanto mais alta a luz, mais curta; quanto mais
    // baixa/rasante, mais longa (limitada para não sair da superfície).
    const dropHeight = Math.max(0.35, lightY - this.height * 0.5);
    const projected =
      level > 0.001
        ? (this.height * lightDistance) / dropHeight
        : 0;
    const length = Math.max(0, Math.min(this.maxLength, projected));

    const alpha = Math.max(0, Math.min(1, blend));
    this.opacity += (targetOpacity - this.opacity) * alpha;
    this.material.opacity = this.opacity;

    const horiz = Math.hypot(dirX, dirZ) || 1;
    const worldDirX = dirX / horiz;
    const worldDirZ = dirZ / horiz;

    // Direção da sombra no referencial do objeto (o grupo já carrega o yaw).
    const yaw = this.object.rotation.y;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const localX = worldDirX * cosY - worldDirZ * sinY;
    const localZ = worldDirX * sinY + worldDirZ * cosY;

    const blendLength = this.length + (length - this.length) * alpha;
    this.length = blendLength;
    this.applyDirection(localX, localZ, blendLength);
  }

  private applyDirection(
    localX: number,
    localZ: number,
    length: number
  ): void {
    const horiz = Math.hypot(localX, localZ) || 1;
    const dx = localX / horiz;
    const dz = localZ / horiz;

    // Suporte da elipse inscrita no retângulo do objeto ao longo da direção da
    // sombra e no eixo perpendicular.
    const along = Math.hypot(this.halfX * dx, this.halfZ * dz);
    const perp = Math.hypot(this.halfX * -dz, this.halfZ * dx);

    this.mesh.scale.set(
      Math.max(0.02, along * 2 + length),
      Math.max(0.02, perp * 2 * (1 + length * 0.35)),
      1
    );
    // A sombra cresce para a frente sem soltar a base do objeto.
    this.mesh.position.x = dx * length * 0.5;
    this.mesh.position.z = dz * length * 0.5;

    // Com o plano deitado (rotação X de -90°), girar em Z alinha o eixo local X
    // com a direção da sombra no chão: X local -> (cos, 0, -sin).
    this.mesh.rotation.z = Math.atan2(-dz, dx);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
