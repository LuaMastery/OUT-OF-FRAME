import * as THREE from 'three';
import {
  buildSubProjectionMatrix,
  DEFAULT_FRAME_RECT,
  FramePolarity,
  NormalizedRect,
} from '../math/SubFrustum';

/**
 * Capturador fotográfico offscreen (`WebGLRenderTarget`) do Sub-Frustum da Moldura.
 *
 * Renderiza exatamente a pirâmide perspectiva da sub-janela `[uMin..uMax] x [vMin..vMax]`
 * em uma textura dedicada no instante do recorte e projeta a chapa revelada no HUD
 * (incluindo inversão fotográfica de negativo e espelhamento horizontal ao apertar [R]).
 */
export class FramePipView {
  private readonly size = 224;
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly subCamera: THREE.PerspectiveCamera;
  private readonly pixelBuffer: Uint8Array;
  private readonly rawRgbaSnapshot: Uint8ClampedArray;
  private hasSnapshot = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.canvas.width = this.size;
    this.canvas.height = this.size;

    this.renderTarget = new THREE.WebGLRenderTarget(this.size, this.size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    });

    this.subCamera = new THREE.PerspectiveCamera();
    this.pixelBuffer = new Uint8Array(this.size * this.size * 4);
    this.rawRgbaSnapshot = new Uint8ClampedArray(this.size * this.size * 4);
    this.clearCanvas();
  }

  /**
   * Tira um instantâneo real do sub-frustum antes dos objetos recortados entrarem em estase.
   */
  captureSnapshot(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    mainCamera: THREE.PerspectiveCamera,
    near: number,
    far: number,
    rect: NormalizedRect = DEFAULT_FRAME_RECT,
    polarity: FramePolarity = 'normal'
  ): void {
    mainCamera.updateMatrixWorld(true);
    this.subCamera.position.copy(mainCamera.position);
    this.subCamera.quaternion.copy(mainCamera.quaternion);
    this.subCamera.updateMatrixWorld(true);

    buildSubProjectionMatrix(
      mainCamera.fov,
      mainCamera.aspect,
      near,
      Math.max(far, 45),
      rect,
      this.subCamera.projectionMatrix
    );
    this.subCamera.projectionMatrixInverse
      .copy(this.subCamera.projectionMatrix)
      .invert();

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(scene, this.subCamera);
    renderer.readRenderTargetPixels(
      this.renderTarget,
      0,
      0,
      this.size,
      this.size,
      this.pixelBuffer
    );
    renderer.setRenderTarget(prevTarget);

    // WebGL armazena linhas de baixo para cima; invertemos Y para coordenadas de tela
    const w = this.size;
    const h = this.size;
    for (let y = 0; y < h; y++) {
      const srcRow = (h - 1 - y) * w * 4;
      const dstRow = y * w * 4;
      for (let x = 0; x < w * 4; x++) {
        this.rawRgbaSnapshot[dstRow + x] = this.pixelBuffer[srcRow + x];
      }
    }

    this.hasSnapshot = true;
    this.redrawPlate(polarity);
  }

  /**
   * Re-renderiza a chapa fotográfica com a polaridade atual (`normal` ou `inverted` negativo).
   */
  redrawPlate(polarity: FramePolarity): void {
    if (!this.hasSnapshot) {
      this.clearCanvas();
      return;
    }

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this.size;
    const h = this.size;
    const img = ctx.createImageData(w, h);
    const dst = img.data;
    const src = this.rawRgbaSnapshot;

    for (let y = 0; y < h; y++) {
      // Scanline sutil estilo visor analógico/óptico
      const scan = y % 3 === 0 ? 0.91 : 1.0;
      for (let x = 0; x < w; x++) {
        // No modo negativo invertido, espelhamos X (idêntico à matemática x -> -x!)
        const sampleX = polarity === 'inverted' ? w - 1 - x : x;
        const si = (y * w + sampleX) * 4;
        const di = (y * w + x) * 4;

        let r = src[si];
        let g = src[si + 1];
        let b = src[si + 2];

        if (polarity === 'inverted') {
          // Revelação negativa de alto contraste com realce ciano/carmesim
          r = 255 - r;
          g = Math.min(255, Math.floor((255 - g) * 1.06 + 10));
          b = Math.min(255, Math.floor((255 - b) * 1.12 + 18));
        }

        dst[di] = Math.floor(r * scan);
        dst[di + 1] = Math.floor(g * scan);
        dst[di + 2] = Math.floor(b * scan);
        dst[di + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  clearCanvas(): void {
    this.hasSnapshot = false;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.size, this.size);
  }

  dispose(): void {
    this.renderTarget.dispose();
  }
}
