import * as THREE from 'three';

export const MAX_DOOM_LIGHTS = 16;

export interface DoomSharedUniforms {
  uLightPositions: { value: THREE.Vector3[] };
  uLightIntensities: { value: number[] };
  uLightCount: { value: number };
  uFlashlightPos: { value: THREE.Vector3 };
  uFlashlightDir: { value: THREE.Vector3 };
  uFlashlightIntensity: { value: number };
}

export function createDoomSharedUniforms(): DoomSharedUniforms {
  const positions: THREE.Vector3[] = [];
  const intensities: number[] = [];
  for (let i = 0; i < MAX_DOOM_LIGHTS; i++) {
    positions.push(new THREE.Vector3(0, 0, 0));
    intensities.push(0);
  }
  return {
    uLightPositions: { value: positions },
    uLightIntensities: { value: intensities },
    uLightCount: { value: 0 },
    uFlashlightPos: { value: new THREE.Vector3(0, 1.5, 0) },
    uFlashlightDir: { value: new THREE.Vector3(0, 0, -1) },
    uFlashlightIntensity: { value: 0 },
  };
}

/**
 * Material GLSL fiel ao id Tech 1 (DOOM Clássico, 1993):
 * - Coordenadas UV em espaço do mundo (ladrilhos nunca esticam, rodapés sempre alinhados)
 * - "Fake Contrast" original do DOOM (paredes Norte/Sul +claras, Leste/Oeste -escuras)
 * - Diminuição de luz por distância quantizada em bandas discretas estilo tabela COLORMAP
 * - Suporte a cone de Lanterna (F) quantizado nas mesmas bandas COLORMAP
 */
export function createDoomSurfaceMaterial(
  texture: THREE.Texture,
  shared: DoomSharedUniforms,
  options?: {
    tileScaleXZ?: number;
    wallHeight?: number;
    baseLight?: number;
    fullBright?: boolean;
  }
): THREE.ShaderMaterial {
  const tileXZ = options?.tileScaleXZ ?? 3.0;
  const wallH = options?.wallHeight ?? 3.2;
  const baseLight = options?.baseLight ?? 0.56;
  const fullBright = options?.fullBright ?? false;

  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uTileXZ: { value: tileXZ },
      uWallHeight: { value: wallH },
      uBaseLight: { value: baseLight },
      uFullBright: { value: fullBright ? 1.0 : 0.0 },
      uLightPositions: shared.uLightPositions,
      uLightIntensities: shared.uLightIntensities,
      uLightCount: shared.uLightCount,
      uFlashlightPos: shared.uFlashlightPos,
      uFlashlightDir: shared.uFlashlightDir,
      uFlashlightIntensity: shared.uFlashlightIntensity,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vViewDist;

      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);

        vec4 viewPos = viewMatrix * worldPos;
        vViewDist = abs(viewPos.z);

        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_LIGHTS ${MAX_DOOM_LIGHTS}

      uniform sampler2D uMap;
      uniform float uTileXZ;
      uniform float uWallHeight;
      uniform float uBaseLight;
      uniform float uFullBright;
      uniform vec3 uLightPositions[MAX_LIGHTS];
      uniform float uLightIntensities[MAX_LIGHTS];
      uniform int uLightCount;
      uniform vec3 uFlashlightPos;
      uniform vec3 uFlashlightDir;
      uniform float uFlashlightIntensity;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vViewDist;

      void main() {
        vec3 nrm = normalize(vWorldNormal);
        vec3 an = abs(nrm);

        // Mapeamento UV em espaço do mundo sem distorção (estilo linedefs/flats de WAD)
        vec2 uv;
        if (an.y > 0.7) {
          uv = vWorldPos.xz / uTileXZ;
        } else if (an.x > 0.7) {
          uv = vec2(vWorldPos.z / uTileXZ, vWorldPos.y / uWallHeight);
        } else {
          uv = vec2(vWorldPos.x / uTileXZ, vWorldPos.y / uWallHeight);
        }

        vec4 texel = texture2D(uMap, uv);

        if (uFullBright > 0.5) {
          float farDim = clamp(1.15 - vViewDist * 0.028, 0.28, 1.0);
          float q = floor(farDim * 16.0) / 16.0;
          gl_FragColor = vec4(texel.rgb * q, 1.0);
          return;
        }

        // 1. Luz base do setor + luminárias de parede
        float sectorLight = uBaseLight;
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          float d = distance(vWorldPos, uLightPositions[i]);
          float atten = clamp(1.0 - d / 8.5, 0.0, 1.0);
          sectorLight += atten * atten * uLightIntensities[i];
        }
        sectorLight = clamp(sectorLight, 0.08, 1.0);

        // 2. "Fake Contrast" autêntico do id Tech 1
        float fakeContrast = 0.0;
        if (an.z > 0.7) {
          fakeContrast = 0.075;
        } else if (an.x > 0.7) {
          fakeContrast = -0.075;
        } else if (nrm.y < -0.7) {
          fakeContrast = -0.05;
        }

        // 3. Curva de profundidade "Light Diminishing" do DOOM
        float nearBoost = clamp((5.2 - vViewDist) * 0.065, 0.0, 0.28);
        float distFalloff = clamp(1.08 - vViewDist * 0.048, 0.0, 1.0);

        // 4. Contribuição do feixe da Lanterna (Tecla F)
        float flashContribution = 0.0;
        if (uFlashlightIntensity > 0.01) {
          vec3 toFrag = vWorldPos - uFlashlightPos;
          float flashDist = length(toFrag);
          vec3 fragDir = toFrag / max(0.0001, flashDist);
          float cosCone = dot(fragDir, normalize(uFlashlightDir));

          // Núcleo central forte + halo externo mais amplo
          float coreSpot = smoothstep(0.93, 0.985, cosCone);
          float outerHalo = smoothstep(0.77, 0.935, cosCone) * 0.42;
          float distAtten = clamp(1.0 - flashDist / 21.0, 0.0, 1.0);
          float facing = clamp(dot(nrm, -fragDir) * 0.75 + 0.35, 0.2, 1.0);

          flashContribution =
            (coreSpot + outerHalo) *
            distAtten *
            facing *
            uFlashlightIntensity *
            0.88;
        }

        float rawShade =
          (sectorLight * distFalloff) +
          nearBoost +
          fakeContrast +
          flashContribution;
        rawShade = clamp(rawShade, 0.0, 1.0);

        // 5. Quantização em 24 degraus discretos estilo COLORMAP
        float colormapBand = floor(rawShade * 24.0) / 24.0;

        vec3 shaded = texel.rgb * colormapBand;
        shaded.r *= mix(1.06, 1.0, colormapBand);
        shaded.b *= mix(0.88, 1.0, colormapBand);

        // Leve tom halógeno quente onde o foco da lanterna incide
        if (flashContribution > 0.02) {
          float warmMix = clamp(flashContribution * 0.55, 0.0, 0.35);
          shaded *= mix(vec3(1.0), vec3(1.08, 1.03, 0.90), warmMix);
        }

        gl_FragColor = vec4(shaded, 1.0);
      }
    `,
  });
}

/**
 * Material UV-mapped quantizado em COLORMAP para objetos 3D coletáveis,
 * sinalizadores e fios de teia de aranha (com suporte a recorte alpha nítido).
 */
export function createDoomPropMaterial(
  texture: THREE.Texture,
  shared: DoomSharedUniforms,
  options?: {
    baseLight?: number;
    alphaTest?: number;
    doubleSided?: boolean;
    emissiveBoost?: number;
    tint?: THREE.Color;
  }
): THREE.ShaderMaterial {
  const baseLight = options?.baseLight ?? 0.55;
  const alphaTest = options?.alphaTest ?? 0.0;
  const emissiveBoost = options?.emissiveBoost ?? 0.0;
  const tint = options?.tint ?? new THREE.Color(1, 1, 1);

  return new THREE.ShaderMaterial({
    side: options?.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    transparent: false,
    uniforms: {
      uMap: { value: texture },
      uBaseLight: { value: baseLight },
      uAlphaTest: { value: alphaTest },
      uEmissiveBoost: { value: emissiveBoost },
      uTint: { value: tint },
      uLightPositions: shared.uLightPositions,
      uLightIntensities: shared.uLightIntensities,
      uLightCount: shared.uLightCount,
      uFlashlightPos: shared.uFlashlightPos,
      uFlashlightDir: shared.uFlashlightDir,
      uFlashlightIntensity: shared.uFlashlightIntensity,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vViewDist;

      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 viewPos = viewMatrix * worldPos;
        vViewDist = abs(viewPos.z);
        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_LIGHTS ${MAX_DOOM_LIGHTS}

      uniform sampler2D uMap;
      uniform float uBaseLight;
      uniform float uAlphaTest;
      uniform float uEmissiveBoost;
      uniform vec3 uTint;
      uniform vec3 uLightPositions[MAX_LIGHTS];
      uniform float uLightIntensities[MAX_LIGHTS];
      uniform int uLightCount;
      uniform vec3 uFlashlightPos;
      uniform vec3 uFlashlightDir;
      uniform float uFlashlightIntensity;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vViewDist;

      void main() {
        vec4 texel = texture2D(uMap, vUv);
        if (uAlphaTest > 0.0 && texel.a < uAlphaTest) {
          discard;
        }

        float sectorLight = uBaseLight;
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          float d = distance(vWorldPos, uLightPositions[i]);
          float atten = clamp(1.0 - d / 8.5, 0.0, 1.0);
          sectorLight += atten * atten * uLightIntensities[i];
        }
        sectorLight = clamp(sectorLight, 0.08, 1.0);

        float nearBoost = clamp((5.2 - vViewDist) * 0.065, 0.0, 0.26);
        float distFalloff = clamp(1.08 - vViewDist * 0.048, 0.0, 1.0);

        float flashContribution = 0.0;
        if (uFlashlightIntensity > 0.01) {
          vec3 toFrag = vWorldPos - uFlashlightPos;
          float flashDist = length(toFrag);
          vec3 fragDir = toFrag / max(0.0001, flashDist);
          float cosCone = dot(fragDir, normalize(uFlashlightDir));

          float coreSpot = smoothstep(0.92, 0.985, cosCone);
          float outerHalo = smoothstep(0.76, 0.93, cosCone) * 0.45;
          float distAtten = clamp(1.0 - flashDist / 21.0, 0.0, 1.0);

          flashContribution =
            (coreSpot + outerHalo) *
            distAtten *
            uFlashlightIntensity *
            0.95;
        }

        float rawShade = clamp(
          (sectorLight * distFalloff) + nearBoost + flashContribution + uEmissiveBoost,
          0.0,
          1.15
        );
        float colormapBand = floor(rawShade * 24.0) / 24.0;

        vec3 shaded = texel.rgb * uTint * colormapBand;
        if (flashContribution > 0.02) {
          float warmMix = clamp(flashContribution * 0.5, 0.0, 0.32);
          shaded *= mix(vec3(1.0), vec3(1.08, 1.03, 0.90), warmMix);
        }

        gl_FragColor = vec4(shaded, 1.0);
      }
    `,
  });
}

/**
 * Material quitinoso negro/ósseo dedicado à Aranha Procedural (Evil Crawling Thing):
 * - Suporta cores por vértice (corpo negro brilhante -> pontas ósseas pálidas)
 * - Reflexo especular frio de carapaça úmida quando atingido pela lanterna ou luz próxima
 * - Quantização em bandas discretas COLORMAP fiel ao mundo 3D do jogo
 */
export function createSpiderChitinMaterial(
  shared: DoomSharedUniforms
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    uniforms: {
      uRageGlow: { value: 0.0 },
      uLightPositions: shared.uLightPositions,
      uLightIntensities: shared.uLightIntensities,
      uLightCount: shared.uLightCount,
      uFlashlightPos: shared.uFlashlightPos,
      uFlashlightDir: shared.uFlashlightDir,
      uFlashlightIntensity: shared.uFlashlightIntensity,
    },
    vertexShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying float vViewDist;

      void main() {
        vColor = color;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);

        vec4 viewPos = viewMatrix * worldPos;
        vViewDist = abs(viewPos.z);
        vViewDir = normalize(cameraPosition - worldPos.xyz);

        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_LIGHTS ${MAX_DOOM_LIGHTS}

      uniform float uRageGlow;
      uniform vec3 uLightPositions[MAX_LIGHTS];
      uniform float uLightIntensities[MAX_LIGHTS];
      uniform int uLightCount;
      uniform vec3 uFlashlightPos;
      uniform vec3 uFlashlightDir;
      uniform float uFlashlightIntensity;

      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      varying float vViewDist;

      void main() {
        vec3 nrm = normalize(vWorldNormal);
        if (!gl_FrontFacing) nrm = -nrm;

        float sectorLight = 0.28;
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          float d = distance(vWorldPos, uLightPositions[i]);
          float atten = clamp(1.0 - d / 9.0, 0.0, 1.0);
          sectorLight += atten * atten * uLightIntensities[i] * 1.1;
        }
        sectorLight = clamp(sectorLight, 0.08, 1.0);

        float distFalloff = clamp(1.10 - vViewDist * 0.044, 0.0, 1.0);
        float rim = pow(1.0 - clamp(abs(dot(nrm, normalize(vViewDir))), 0.0, 1.0), 2.4);

        float flashContribution = 0.0;
        float chitinSpec = 0.0;
        if (uFlashlightIntensity > 0.01) {
          vec3 toFrag = vWorldPos - uFlashlightPos;
          float flashDist = length(toFrag);
          vec3 fragDir = toFrag / max(0.0001, flashDist);
          float cosCone = dot(fragDir, normalize(uFlashlightDir));

          float coreSpot = smoothstep(0.92, 0.985, cosCone);
          float outerHalo = smoothstep(0.75, 0.93, cosCone) * 0.48;
          float distAtten = clamp(1.0 - flashDist / 22.0, 0.0, 1.0);

          flashContribution = (coreSpot + outerHalo) * distAtten * uFlashlightIntensity;

          // Brilho úmido na carapaça preta quando iluminada pela lanterna
          vec3 halfVec = normalize(-fragDir + normalize(vViewDir));
          float spec = pow(max(dot(nrm, halfVec), 0.0), 14.0);
          chitinSpec = spec * flashContribution * 0.26 + rim * flashContribution * 0.16;
        } else {
          chitinSpec = rim * sectorLight * distFalloff * 0.08;
        }

        float rawShade = clamp(
          sectorLight * distFalloff + flashContribution * 1.05,
          0.06,
          1.15
        );
        float band = floor(rawShade * 24.0) / 24.0;

        vec3 baseCol = vColor * band + vec3(0.82, 0.85, 0.90) * floor(chitinSpec * 20.0) / 20.0;

        // Sutil reflexo rubro nas pontas/olhos durante frenesi de perseguição
        if (uRageGlow > 0.01) {
          baseCol += vec3(0.14, 0.015, 0.01) * uRageGlow * rim;
        }

        gl_FragColor = vec4(clamp(baseCol, 0.0, 1.0), 1.0);
      }
    `,
  });
}

/**
 * Pipeline de pós-processamento Low-Res estilo DOOM DOS (250p NearestFilter + Bayer 4x4 + PLAYPAL),
 * com suporte a renderização da cena em 1ª pessoa (lanterna) sem atravessar paredes!
 */
export class DoomRetroCompositor {
  private renderTarget: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly postMaterial: THREE.ShaderMaterial;
  private readonly targetHeight = 250;

  constructor(initialWidth: number, initialHeight: number) {
    const aspect = Math.max(1, initialWidth) / Math.max(1, initialHeight);
    const lowW = Math.max(320, Math.round(this.targetHeight * aspect));
    const lowH = this.targetHeight;

    this.renderTarget = new THREE.WebGLRenderTarget(lowW, lowH, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    this.postMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.renderTarget.texture },
        uResolution: { value: new THREE.Vector2(lowW, lowH) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float bayer4x4(vec2 pixel) {
          int x = int(mod(pixel.x, 4.0));
          int y = int(mod(pixel.y, 4.0));
          int index = x + y * 4;
          if (index == 0) return 0.0 / 16.0;
          if (index == 1) return 8.0 / 16.0;
          if (index == 2) return 2.0 / 16.0;
          if (index == 3) return 10.0 / 16.0;
          if (index == 4) return 12.0 / 16.0;
          if (index == 5) return 4.0 / 16.0;
          if (index == 6) return 14.0 / 16.0;
          if (index == 7) return 6.0 / 16.0;
          if (index == 8) return 3.0 / 16.0;
          if (index == 9) return 11.0 / 16.0;
          if (index == 10) return 1.0 / 16.0;
          if (index == 11) return 9.0 / 16.0;
          if (index == 12) return 15.0 / 16.0;
          if (index == 13) return 7.0 / 16.0;
          if (index == 14) return 13.0 / 16.0;
          return 5.0 / 16.0;
        }

        void main() {
          vec2 pixelCoord = floor(vUv * uResolution);
          vec4 col = texture2D(tDiffuse, (pixelCoord + 0.5) / uResolution);

          float dither = (bayer4x4(pixelCoord) - 0.5) / 28.0;
          vec3 c = clamp(col.rgb + dither, 0.0, 1.0);

          c.r = floor(c.r * 24.0 + 0.5) / 24.0;
          c.g = floor(c.g * 24.0 + 0.5) / 24.0;
          c.b = floor(c.b * 20.0 + 0.5) / 20.0;

          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial);
    this.postScene.add(quad);
  }

  resize(viewportWidth: number, viewportHeight: number): void {
    const aspect = Math.max(1, viewportWidth) / Math.max(1, viewportHeight);
    const lowW = Math.max(320, Math.round(this.targetHeight * aspect));
    const lowH = this.targetHeight;

    this.renderTarget.setSize(lowW, lowH);
    this.postMaterial.uniforms.uResolution.value.set(lowW, lowH);
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    viewScene?: THREE.Scene,
    viewCamera?: THREE.Camera
  ): void {
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // Renderiza a lanterna em 1ª pessoa limpando apenas o depth buffer (nunca atravessa paredes!)
    if (viewScene && viewCamera) {
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
      renderer.autoClear = prevAutoClear;
    }

    renderer.setRenderTarget(null);
    renderer.render(this.postScene, this.postCamera);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.postMaterial.dispose();
  }
}
