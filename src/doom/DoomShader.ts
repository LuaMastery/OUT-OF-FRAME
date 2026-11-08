import * as THREE from 'three';

export const MAX_DOOM_LIGHTS = 16;

export interface DoomSharedUniforms {
  uLightPositions: { value: THREE.Vector3[] };
  uLightIntensities: { value: number[] };
  uLightCount: { value: number };
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
  };
}

/**
 * Material GLSL fiel ao id Tech 1 (DOOM Clássico, 1993):
 * - Coordenadas UV em espaço do mundo (ladrilhos nunca esticam, rodapés sempre alinhados)
 * - "Fake Contrast" original do DOOM (paredes Norte/Sul +claras, Leste/Oeste -escuras)
 * - Diminuição de luz por distância quantizada em bandas discretas estilo tabela COLORMAP (32 níveis)
 * - Iluminação de setores/luminárias com suporte a cintilação clássica de corredor
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
        // No DOOM clássico, a distância de atenuação usa profundidade perpendicular Z!
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
          // Luminárias embutidas LITE5: mantêm brilho alto mas ainda escurecem levemente muito longe
          float farDim = clamp(1.15 - vViewDist * 0.028, 0.28, 1.0);
          float q = floor(farDim * 16.0) / 16.0;
          gl_FragColor = vec4(texel.rgb * q, 1.0);
          return;
        }

        // 1. Luz base do setor + contribuição das luminárias de parede do labirinto
        float sectorLight = uBaseLight;
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          float d = distance(vWorldPos, uLightPositions[i]);
          float atten = clamp(1.0 - d / 8.5, 0.0, 1.0);
          sectorLight += atten * atten * uLightIntensities[i];
        }
        sectorLight = clamp(sectorLight, 0.08, 1.0);

        // 2. "Fake Contrast" autêntico do id Tech 1:
        // Paredes Norte/Sul ganham +contraste, Leste/Oeste ficam levemente mais escuras
        float fakeContrast = 0.0;
        if (an.z > 0.7) {
          fakeContrast = 0.075;
        } else if (an.x > 0.7) {
          fakeContrast = -0.075;
        } else if (nrm.y < -0.7) {
          fakeContrast = -0.05;
        }

        // 3. Curva de profundidade "Light Diminishing" do DOOM:
        // Perto do jogador há um reforço de visibilidade; ao longe cai para escuridão total
        float nearBoost = clamp((5.2 - vViewDist) * 0.065, 0.0, 0.28);
        float distFalloff = clamp(1.08 - vViewDist * 0.048, 0.0, 1.0);

        float rawShade = (sectorLight * distFalloff) + nearBoost + fakeContrast;
        rawShade = clamp(rawShade, 0.0, 1.0);

        // 4. Quantização em 24 degraus discretos imitando a tabela COLORMAP de 32 níveis!
        float colormapBand = floor(rawShade * 24.0) / 24.0;

        // Sutil aquecimento nas faixas escuras (característico da paleta PLAYPAL do DOOM)
        vec3 shaded = texel.rgb * colormapBand;
        shaded.r *= mix(1.06, 1.0, colormapBand);
        shaded.b *= mix(0.88, 1.0, colormapBand);

        gl_FragColor = vec4(shaded, 1.0);
      }
    `,
  });
}

/**
 * Pipeline de pós-processamento Low-Res estilo DOOM DOS (320x200 / 260p Widescreen):
 * Renderiza a cena 3D em resolução baixa crocante (`NearestFilter`, sem AA borrado)
 * e aplica matriz ordenada Bayer 4x4 + quantização de paleta de 256 cores (`PLAYPAL`).
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

        // Matriz ordenada de Bayer 4x4 clássica
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

          // Dithering ordenado sutil + quantização de cores estilo VGA 256-color PLAYPAL
          float dither = (bayer4x4(pixelCoord) - 0.5) / 28.0;
          vec3 c = clamp(col.rgb + dither, 0.0, 1.0);

          // Quantiza canais simulando paleta indexada rica do DOOM
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
    camera: THREE.Camera
  ): void {
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(this.postScene, this.postCamera);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.postMaterial.dispose();
  }
}
