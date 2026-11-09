import * as THREE from 'three';

export const MAX_DOOM_LIGHTS = 48;

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
 * Material GLSL sombrio fiel ao id Tech 1 (DOOM Clássico) com atmosfera real de terror:
 * - Suporta UV em espaço do mundo (paredes/pisos sem esticar) OU UV local 0..1 (`useLocalUv` para luminárias e painéis)
 * - Iluminação direcional das arandelas com halo quente + oclusão de contato nos cantos piso/parede/teto
 * - "Fake Contrast" clássico do DOOM + "Light Diminishing" com sombras profundas nos corredores apagados
 * - Feixe dramático de Lanterna (Tecla F) quantizado em 32 degraus COLORMAP
 */
export function createDoomSurfaceMaterial(
  texture: THREE.Texture,
  shared: DoomSharedUniforms,
  options?: {
    tileScaleXZ?: number;
    wallHeight?: number;
    baseLight?: number;
    fullBright?: boolean;
    useLocalUv?: boolean;
    useVertexEmission?: boolean;
  }
): THREE.ShaderMaterial {
  const tileXZ = options?.tileScaleXZ ?? 3.0;
  const wallH = options?.wallHeight ?? 3.2;
  const baseLight = options?.baseLight ?? 0.21;
  const fullBright = options?.fullBright ?? false;
  const useLocalUv = options?.useLocalUv ?? false;
  const useVertexEmission = options?.useVertexEmission ?? false;

  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uTileXZ: { value: tileXZ },
      uWallHeight: { value: wallH },
      uBaseLight: { value: baseLight },
      uFullBright: { value: fullBright ? 1.0 : 0.0 },
      uUseLocalUv: { value: useLocalUv ? 1.0 : 0.0 },
      uUseVertexEmission: { value: useVertexEmission ? 1.0 : 0.0 },
      uLightPositions: shared.uLightPositions,
      uLightIntensities: shared.uLightIntensities,
      uLightCount: shared.uLightCount,
      uFlashlightPos: shared.uFlashlightPos,
      uFlashlightDir: shared.uFlashlightDir,
      uFlashlightIntensity: shared.uFlashlightIntensity,
    },
    vertexShader: /* glsl */ `
      uniform float uUseVertexEmission;
      attribute float aLightEmission;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vViewDist;
      varying float vLightEmission;

      void main() {
        vUv = uv;
        vLightEmission = uUseVertexEmission > 0.5 ? aLightEmission : 1.0;
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
      uniform float uUseLocalUv;
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
      varying float vLightEmission;

      void main() {
        vec3 nrm = normalize(vWorldNormal);
        vec3 an = abs(nrm);

        vec2 uv;
        if (uUseLocalUv > 0.5) {
          uv = vUv;
        } else if (an.y > 0.7) {
          uv = vWorldPos.xz / uTileXZ;
        } else if (an.x > 0.7) {
          uv = vec2(vWorldPos.z / uTileXZ, vWorldPos.y / uWallHeight);
        } else {
          uv = vec2(vWorldPos.x / uTileXZ, vWorldPos.y / uWallHeight);
        }

        vec4 texel = texture2D(uMap, uv);

        if (uFullBright > 0.5) {
          float emission = clamp(vLightEmission, 0.0, 1.0);
          float farDim = clamp(1.12 - vViewDist * 0.024, 0.34, 1.0);
          float selfGlow = floor(farDim * emission * 20.0) / 20.0;

          // Quando o LED pisca/apaga, o vidro difusor apagado e a grade ainda refletem
          // a penumbra mínima do setor e o feixe da lanterna do jogador (realismo físico!)
          float distAttenAmbient = clamp(1.06 - vViewDist * 0.044, 0.0, 1.0);
          float unlitAmbient = clamp(uBaseLight * 0.42 * distAttenAmbient, 0.045, 0.14);
          float flashOnGlass = 0.0;
          if (uFlashlightIntensity > 0.01) {
            vec3 toFrag = vWorldPos - uFlashlightPos;
            float flashDist = length(toFrag);
            vec3 fragDir = toFrag / max(0.0001, flashDist);
            float cosCone = dot(fragDir, normalize(uFlashlightDir));
            float spot = smoothstep(0.925, 0.985, cosCone) + smoothstep(0.74, 0.93, cosCone) * 0.46;
            float dAtt = clamp(1.0 - flashDist / 23.0, 0.0, 1.0);
            float face = clamp(dot(nrm, -fragDir) * 0.72 + 0.36, 0.22, 1.0);
            flashOnGlass = spot * dAtt * face * uFlashlightIntensity * 0.78;
          }
          float passiveLit = floor(clamp(unlitAmbient + flashOnGlass, 0.0, 0.92) * 32.0) / 32.0;

          // Leve tom âmbar/quente quando o reator oscila em baixa tensão antes de apagar ou voltar
          vec3 sagTint = mix(vec3(0.94, 0.80, 0.66), vec3(1.0, 1.0, 1.0), smoothstep(0.08, 0.75, emission));
          vec3 glowRgb = texel.rgb * selfGlow * sagTint;
          vec3 passiveRgb = texel.rgb * passiveLit * vec3(0.82, 0.86, 0.92);

          gl_FragColor = vec4(clamp(max(glowRgb, passiveRgb), 0.0, 1.0), 1.0);
          return;
        }

        // 1. Luz base escura do setor + contribuição escultórica 3D das arandelas
        float lampLight = 0.0;
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          vec3 toLight = uLightPositions[i] - vWorldPos;
          float d = length(toLight);
          float atten = clamp(1.0 - d / 9.2, 0.0, 1.0);
          float nDotL = clamp(dot(nrm, toLight / max(0.001, d)) * 0.58 + 0.48, 0.24, 1.05);
          lampLight += atten * atten * uLightIntensities[i] * nDotL;
        }

        float sectorLight = clamp(uBaseLight + lampLight, 0.06, 1.05);

        // 2. Oclusão de contato nos encontros Parede-Piso e Parede-Teto para profundidade arquitetônica real
        float seamAO = 1.0;
        if (an.y < 0.5) {
          float floorAO = smoothstep(0.0, 0.34, vWorldPos.y);
          float ceilAO = smoothstep(0.0, 0.40, uWallHeight - vWorldPos.y);
          seamAO = mix(0.70, 1.0, floorAO * ceilAO);
        }

        // 3. "Fake Contrast" sutil do DOOM para separar faces ortogonais
        float fakeContrast = 0.0;
        if (an.z > 0.7) {
          fakeContrast = 0.045;
        } else if (an.x > 0.7) {
          fakeContrast = -0.045;
        } else if (nrm.y < -0.7) {
          fakeContrast = -0.035;
        }

        // 4. Queda de luz por distância estilo DOOM + leve leitura de silhueta bem de perto
        float nearVis = clamp((3.2 - vViewDist) * 0.038, 0.0, 0.11);
        float distFalloff = clamp(1.06 - vViewDist * 0.044, 0.0, 1.0);

        // 5. Feixe halógeno dramático da Lanterna (Tecla F)
        float flashContribution = 0.0;
        if (uFlashlightIntensity > 0.01) {
          vec3 toFrag = vWorldPos - uFlashlightPos;
          float flashDist = length(toFrag);
          vec3 fragDir = toFrag / max(0.0001, flashDist);
          float cosCone = dot(fragDir, normalize(uFlashlightDir));

          float coreSpot = smoothstep(0.925, 0.985, cosCone);
          float outerHalo = smoothstep(0.74, 0.93, cosCone) * 0.46;
          float distAtten = clamp(1.0 - flashDist / 23.0, 0.0, 1.0);
          float facing = clamp(dot(nrm, -fragDir) * 0.72 + 0.36, 0.22, 1.0);

          flashContribution =
            (coreSpot + outerHalo) *
            distAtten *
            facing *
            uFlashlightIntensity *
            1.02;
        }

        float rawShade =
          ((sectorLight * distFalloff + nearVis + fakeContrast) * seamAO) +
          flashContribution;
        rawShade = clamp(rawShade, 0.0, 1.08);

        // 6. Quantização em 32 bandas COLORMAP autênticas
        float colormapBand = floor(rawShade * 32.0) / 32.0;

        // Sombra fria de bunker vs luz quente halógena de arandelas e lanterna
        float warmFactor = clamp(lampLight * 0.75 + flashContribution * 0.85, 0.0, 1.0);
        vec3 shadowTint = vec3(0.92, 0.94, 1.02);
        vec3 warmTint = vec3(1.08, 1.01, 0.88);
        vec3 lightColor = mix(shadowTint, warmTint, warmFactor);

        vec3 shaded = texel.rgb * colormapBand * lightColor;
        gl_FragColor = vec4(clamp(shaded, 0.0, 1.0), 1.0);
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
  const baseLight = options?.baseLight ?? 0.34;
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

        float lampLight = 0.0;
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          float d = distance(vWorldPos, uLightPositions[i]);
          float atten = clamp(1.0 - d / 9.2, 0.0, 1.0);
          lampLight += atten * atten * uLightIntensities[i];
        }
        float sectorLight = clamp(uBaseLight + lampLight, 0.08, 1.05);

        float nearVis = clamp((3.6 - vViewDist) * 0.045, 0.0, 0.16);
        float distFalloff = clamp(1.06 - vViewDist * 0.044, 0.0, 1.0);

        float flashContribution = 0.0;
        if (uFlashlightIntensity > 0.01) {
          vec3 toFrag = vWorldPos - uFlashlightPos;
          float flashDist = length(toFrag);
          vec3 fragDir = toFrag / max(0.0001, flashDist);
          float cosCone = dot(fragDir, normalize(uFlashlightDir));

          float coreSpot = smoothstep(0.92, 0.985, cosCone);
          float outerHalo = smoothstep(0.75, 0.93, cosCone) * 0.46;
          float distAtten = clamp(1.0 - flashDist / 23.0, 0.0, 1.0);

          flashContribution =
            (coreSpot + outerHalo) *
            distAtten *
            uFlashlightIntensity *
            1.02;
        }

        float rawShade = clamp(
          (sectorLight * distFalloff) + nearVis + flashContribution + uEmissiveBoost,
          0.0,
          1.15
        );
        float colormapBand = floor(rawShade * 32.0) / 32.0;

        vec3 shaded = texel.rgb * uTint * colormapBand;
        if (flashContribution > 0.02 || lampLight > 0.05) {
          float warmMix = clamp((flashContribution + lampLight * 0.6) * 0.45, 0.0, 0.3);
          shaded *= mix(vec3(1.0), vec3(1.07, 1.02, 0.90), warmMix);
        }

        gl_FragColor = vec4(clamp(shaded, 0.0, 1.0), 1.0);
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
        vec3 viewDir = normalize(vViewDir);

        float sectorLight = 0.20;
        vec3 dominantLightDir = vec3(0.0, 1.0, 0.0);
        float dominantWeight = 0.25;
        for (int i = 0; i < MAX_LIGHTS; i++) {
          if (i >= uLightCount) break;
          vec3 toL = uLightPositions[i] - vWorldPos;
          float d = length(toL);
          float atten = clamp(1.0 - d / 9.6, 0.0, 1.0);
          float w = atten * atten * uLightIntensities[i];
          sectorLight += w * 1.12;
          if (d > 0.001) {
            dominantLightDir += (toL / d) * w;
            dominantWeight += w;
          }
        }
        sectorLight = clamp(sectorLight, 0.08, 1.0);
        dominantLightDir = normalize(dominantLightDir / max(0.001, dominantWeight));

        // Relevo volumétrico entre placas de quitina, espinhos, músculos e articulações
        float hemiRelief = 0.66 + 0.34 * clamp(dot(nrm, dominantLightDir) * 0.5 + 0.5, 0.0, 1.0);
        float viewRelief = 0.80 + 0.20 * clamp(dot(nrm, viewDir), 0.0, 1.0);
        float formFactor = hemiRelief * viewRelief;

        float distFalloff = clamp(1.08 - vViewDist * 0.043, 0.0, 1.0);
        float ndv = clamp(abs(dot(nrm, viewDir)), 0.0, 1.0);
        float rim = pow(1.0 - ndv, 2.6);

        float flashContribution = 0.0;
        float chitinSpec = 0.0;
        if (uFlashlightIntensity > 0.01) {
          vec3 toFrag = vWorldPos - uFlashlightPos;
          float flashDist = length(toFrag);
          vec3 fragDir = toFrag / max(0.0001, flashDist);
          float cosCone = dot(fragDir, normalize(uFlashlightDir));

          float coreSpot = smoothstep(0.915, 0.985, cosCone);
          float outerHalo = smoothstep(0.74, 0.93, cosCone) * 0.50;
          float distAtten = clamp(1.0 - flashDist / 23.5, 0.0, 1.0);
          float lambertFlash = 0.45 + 0.55 * clamp(dot(nrm, -fragDir), 0.0, 1.0);

          flashContribution = (coreSpot + outerHalo) * distAtten * uFlashlightIntensity * lambertFlash;

          vec3 halfVec = normalize(-fragDir + viewDir);
          float specSharp = pow(max(dot(nrm, halfVec), 0.0), 22.0);
          float specBroad = pow(max(dot(nrm, halfVec), 0.0), 6.0) * 0.25;
          chitinSpec = (specSharp * 0.30 + specBroad * 0.14 + rim * 0.18) * flashContribution;
        } else {
          vec3 halfSector = normalize(dominantLightDir + viewDir);
          float lampSpec = pow(max(dot(nrm, halfSector), 0.0), 16.0) * 0.07;
          chitinSpec = (rim * 0.09 + lampSpec) * sectorLight * distFalloff;
        }

        float rawShade = clamp(
          (sectorLight * distFalloff + flashContribution * 1.12) * formFactor,
          0.05,
          1.22
        );
        float band = floor(rawShade * 32.0) / 32.0;

        vec3 baseCol = vColor * band + vec3(0.78, 0.82, 0.88) * (floor(chitinSpec * 24.0) / 24.0);

        if (uRageGlow > 0.01) {
          baseCol += vec3(0.16, 0.018, 0.012) * uRageGlow * rim * distFalloff;
        }

        gl_FragColor = vec4(clamp(baseCol, 0.0, 1.0), 1.0);
      }
    `,
  });
}

/**
 * Material ocular dedicado aos 8 ocelos aracnídeos (Tapetum Lucidum + brilho predatório):
 * - Escurece naturalmente à distância na escuridão (sem flutuar como adesivo a 30m!)
 * - Reflete brilho vítreo intenso ao cruzar o feixe da lanterna e pulsa carmesim em fúria!
 */
export function createSpiderEyeMaterial(
  shared: DoomSharedUniforms
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      uRageGlow: { value: 0.0 },
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
      uniform float uRageGlow;
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
        vec3 viewDir = normalize(vViewDir);
        float distAtten = clamp(1.12 - vViewDist * 0.052, 0.0, 1.0);
        float centerGlint = pow(clamp(dot(nrm, viewDir), 0.0, 1.0), 2.2);

        float tapetum = 0.0;
        if (uFlashlightIntensity > 0.01) {
          vec3 toFrag = vWorldPos - uFlashlightPos;
          float d = length(toFrag);
          vec3 dir = toFrag / max(0.0001, d);
          float cone = smoothstep(0.76, 0.97, dot(dir, normalize(uFlashlightDir)));
          float fAtten = clamp(1.0 - d / 22.0, 0.0, 1.0);
          tapetum = cone * fAtten * uFlashlightIntensity;
        }

        vec3 calmTone = vColor * (0.18 + 0.42 * centerGlint) * distAtten;
        vec3 rageTone = vec3(0.92, 0.16, 0.09) * (0.35 + 0.65 * centerGlint) * uRageGlow * distAtten;
        vec3 flashGlint = vec3(1.0, 0.88, 0.68) * tapetum * (0.45 + 0.75 * pow(centerGlint, 3.0));

        vec3 finalCol = max(calmTone, rageTone) + flashGlint;
        gl_FragColor = vec4(clamp(finalCol, 0.0, 1.0), 1.0);
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

          float dither = (bayer4x4(pixelCoord) - 0.5) / 36.0;
          vec3 c = clamp(col.rgb + dither, 0.0, 1.0);

          c.r = floor(c.r * 32.0 + 0.5) / 32.0;
          c.g = floor(c.g * 32.0 + 0.5) / 32.0;
          c.b = floor(c.b * 28.0 + 0.5) / 28.0;

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
