import * as THREE from 'three';

/**
 * Shader GLSL triplanar com anti-aliasing analítico via derivadas de espaço de tela (`fwidth`).
 * Cria a estética arquitetônica minimalista de laboratório/Superhot sem texturas externas
 * e sem serrilhado/moiré no horizonte.
 */
export function createCalibrationGridMaterial(options?: {
  baseColor?: number;
  minorLineColor?: number;
  majorLineColor?: number;
}): THREE.ShaderMaterial {
  const base = new THREE.Color(options?.baseColor ?? 0xf3f4f7);
  const minor = new THREE.Color(options?.minorLineColor ?? 0xdadcdf);
  const major = new THREE.Color(options?.majorLineColor ?? 0xb6bac4);

  return new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: base },
      uMinorColor: { value: minor },
      uMajorColor: { value: major },
      uTimeScale: { value: 0.025 },
      uSunDir: { value: new THREE.Vector3(0.42, 0.86, 0.28).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBaseColor;
      uniform vec3 uMinorColor;
      uniform vec3 uMajorColor;
      uniform float uTimeScale;
      uniform vec3 uSunDir;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      float gridFactor(vec3 pos, vec3 nrm, float scale, float thickness) {
        vec3 coord = pos / scale;
        vec3 fw = max(fwidth(coord), vec3(0.0001));
        vec3 grid = abs(fract(coord - 0.5) - 0.5) / (fw * thickness);

        // Projeção triplanar limpa: anula o eixo paralelo à normal da superfície
        vec3 an = abs(nrm);
        float line = 1.0;
        if (an.y > 0.7) {
          line = min(grid.x, grid.z);
        } else if (an.x > 0.7) {
          line = min(grid.y, grid.z);
        } else {
          line = min(grid.x, grid.y);
        }
        return 1.0 - min(line, 1.0);
      }

      void main() {
        float dist = length(cameraPosition - vWorldPos);
        float fade = 1.0 - smoothstep(18.0, 52.0, dist);

        float gMinor = gridFactor(vWorldPos, vWorldNormal, 1.0, 1.05) * fade;
        float gMajor = gridFactor(vWorldPos, vWorldNormal, 4.0, 1.45) * fade;

        // Iluminação difusa hemisférica limpa estilo estúdio branco
        float ndl = dot(vWorldNormal, uSunDir) * 0.5 + 0.5;
        float hemi = mix(0.84, 1.04, ndl);

        // Sutil esfriamento cromático quando o tempo está congelado
        vec3 coldTint = vec3(0.95, 0.97, 1.0);
        vec3 surface = uBaseColor * mix(coldTint, vec3(1.0), clamp(uTimeScale, 0.0, 1.0));

        vec3 col = mix(surface, uMinorColor, gMinor * 0.65);
        col = mix(col, uMajorColor, gMajor * 0.85);
        col *= hemi;

        // Neblina atmosférica branca suave nas bordas distantes da câmara
        float fog = smoothstep(26.0, 68.0, dist);
        col = mix(col, vec3(0.96, 0.97, 0.985), fog * 0.75);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
