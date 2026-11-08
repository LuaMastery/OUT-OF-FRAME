import * as THREE from 'three';
import { ProceduralAudio } from '../engine/audio/ProceduralAudio';
import { World } from '../engine/ecs/World';
import { StaticColliderBox } from '../engine/physics/SpatialSweep';
import { FramePipView } from '../engine/render/FramePipView';
import { createCalibrationGridMaterial } from '../engine/render/GridMaterial';
import { ChronoKernel } from '../engine/time/ChronoKernel';
import {
  buildTestChamber,
  populateChamberEntities,
} from './ChamberBuilder';
import { Transform } from './components';
import { PlayerController } from './PlayerController';
import { CombatSystem } from './systems/CombatSystem';
import { FrameSystem } from './systems/FrameSystem';
import { KinematicsSystem } from './systems/KinematicsSystem';
import { RenderSyncSystem } from './systems/RenderSyncSystem';
import { TurretSystem } from './systems/TurretSystem';

/**
 * Orquestrador da Sala de Testes OUT-OF-FRAME.
 * Conecta o loop determinístico Dual-Clock (`ChronoKernel`) ao pipeline de sistemas ECS.
 */
export class SandboxApp {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly gridMaterial: THREE.ShaderMaterial;

  private readonly world = new World(2048);
  private readonly chrono = new ChronoKernel({
    fixedSimStep: 1 / 120,
    idleTimeScale: 0.025,
    activeTimeScale: 1.0,
  });
  private readonly audio = new ProceduralAudio();
  private readonly pipView: FramePipView;

  private readonly player: PlayerController;
  private readonly combat: CombatSystem;
  private readonly turrets: TurretSystem;
  private readonly kinematics: KinematicsSystem;
  private readonly frameSystem: FrameSystem;
  private readonly renderSync: RenderSyncSystem;

  private colliders: StaticColliderBox[] = [];
  private spawnPoint = new THREE.Vector3(0, 0, 10.5);
  private inspectorVisible = true;
  private lastRafTime = performance.now();

  constructor() {
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    const snapCanvas = document.getElementById('frame-snapshot') as HTMLCanvasElement;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0xf4f5f8, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.1,
      120
    );

    // Iluminação arquitetônica limpa de alto contraste
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd8dce6, 1.05);
    this.scene.add(hemi);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
    dirLight.position.set(12, 24, 10);
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xdce8ff, 0.45);
    backLight.position.set(-14, 12, -16);
    this.scene.add(backLight);

    this.gridMaterial = createCalibrationGridMaterial();
    this.pipView = new FramePipView(snapCanvas);

    this.combat = new CombatSystem(
      this.world,
      this.scene,
      this.audio,
      this.chrono
    );
    this.combat.registerSceneCleanup();

    this.turrets = new TurretSystem(this.world, this.scene, this.audio);
    this.kinematics = new KinematicsSystem(
      this.world,
      this.scene,
      this.audio,
      this.combat,
      () => this.flashElement('graze-flash')
    );

    this.frameSystem = new FrameSystem(
      this.world,
      this.scene,
      this.renderer,
      this.camera,
      this.pipView,
      this.audio,
      this.chrono
    );
    this.renderSync = new RenderSyncSystem(this.world);

    const built = buildTestChamber(this.world, this.scene, this.gridMaterial);
    this.colliders = built.colliders;
    this.spawnPoint.copy(built.spawnPoint);

    this.player = new PlayerController(this.camera, canvas);
    this.player.resetPose(this.spawnPoint);

    window.addEventListener('resize', () => this.onResize());
  }

  /**
   * Acionado sincronamente quando o operador seleciona "Sim" no Terminal CRT,
   * destravando áudio e controles FPS automaticamente sem nenhum modal intermediário.
   */
  engageFromTerminal(): void {
    this.onResize();
    this.audio.unlock();
    this.player.engage();
    this.renderSync.render(0);
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start(): void {
    this.lastRafTime = performance.now();
    const loop = (now: number) => {
      const rawDt = (now - this.lastRafTime) / 1000;
      this.lastRafTime = now;
      this.frame(rawDt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(rawRealDt: number): void {
    const realDt = Math.min(Math.max(rawRealDt, 0.0005), 0.08);

    // 1. Atualiza locomoção e câmera do jogador em tempo real (`realDt`)
    const { motionFactor, angularSpeed, jumped } = this.player.update(
      realDt,
      this.colliders
    );
    if (jumped) {
      this.chrono.injectActionPulse(0.65);
    }

    // 2. Consome ações discretas do jogador
    const actions = this.player.consumeActions();
    if (actions.toggleInspectorPressed) {
      this.inspectorVisible = !this.inspectorVisible;
      document
        .getElementById('inspector-panel')
        ?.classList.toggle('hidden', !this.inspectorVisible);
    }
    if (actions.cycleChronoPressed) {
      this.chrono.cycleMode();
    }
    if (actions.toggleMutePressed) {
      this.audio.toggleMute();
    }
    if (actions.resetChamberPressed) {
      this.resetChamber();
    }
    if (actions.flipPolarityPressed) {
      this.audio.unlock();
      this.frameSystem.togglePolarity();
    }
    if (actions.toggleGizmoPressed) {
      this.frameSystem.toggleGizmoPin();
    }
    if (actions.firePressed && this.player.isEngaged) {
      this.audio.unlock();
      this.combat.firePlayerPulse(
        this.player.getEyePosition(),
        this.player.getAimDirection()
      );
    }
    if (actions.frameActionPressed && this.player.isEngaged) {
      this.audio.unlock();
      this.frameSystem.triggerFrameAction(this.colliders);
      this.flashElement('shutter-flash');
    }

    // 3. Executa sub-passos determinísticos do mundo no acumulador dilatado (120Hz)
    const playerChest = this.player.position
      .clone()
      .add(new THREE.Vector3(0, 1.25, 0));

    const chronoStats = this.chrono.tick(
      realDt,
      this.player.isEngaged ? motionFactor : 0,
      this.player.isEngaged ? angularSpeed : 0,
      (simDt) => {
        this.turrets.stepSimulation(simDt, playerChest);
        this.kinematics.stepSimulation(simDt, this.colliders, this.player.position);
        this.combat.stepSimulation(simDt);
      }
    );

    // 4. Atualiza áudio procedural, shader de grade e varredura do Sub-Frustum
    this.audio.updateTimeScale(chronoStats.timeScale);
    this.gridMaterial.uniforms.uTimeScale.value = chronoStats.timeScale;

    const frameHud = this.frameSystem.updateRealtime(realDt, this.colliders);

    // 5. Sincronização interpolada C0 (alpha) e renderização WebGL
    this.renderSync.render(chronoStats.alpha);
    this.renderer.render(this.scene, this.camera);

    // 6. Atualiza HUD e telemetria
    this.updateHud(chronoStats, frameHud);
  }

  private resetChamber(): void {
    this.frameSystem.clearAllFrameState();
    this.combat.clearRespawns();

    const allDynamic = this.world.query(Transform.bit);
    for (const e of allDynamic) {
      this.world.destroyEntity(e);
    }

    this.player.resetPose(this.spawnPoint);
    populateChamberEntities(this.world, this.scene);
    this.flashElement('shutter-flash');
  }

  private flashElement(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    window.setTimeout(() => {
      el.style.opacity = '0';
    }, 85);
  }

  private updateHud(
    chrono: ReturnType<ChronoKernel['tick']>,
    frame: ReturnType<FrameSystem['updateRealtime']>
  ): void {
    const scaleEl = document.getElementById('timescale-readout');
    const barEl = document.getElementById('timescale-bar');
    const pillEl = document.getElementById('chrono-mode-pill');
    const simClockEl = document.getElementById('sim-clock');
    const realClockEl = document.getElementById('real-clock');
    const vignetteEl = document.getElementById('chrono-vignette');

    if (scaleEl) scaleEl.textContent = `${chrono.timeScale.toFixed(2)}x`;
    if (barEl) {
      barEl.style.width = `${Math.min(100, Math.max(2, chrono.timeScale * 100)).toFixed(1)}%`;
    }
    if (pillEl) {
      pillEl.textContent =
        chrono.mode === 'superhot'
          ? 'SUPERHOT'
          : chrono.mode === 'frozen'
          ? 'CONGELADO'
          : 'TEMPO REAL';
    }
    if (simClockEl) simClockEl.textContent = `${chrono.simTime.toFixed(2)}s`;
    if (realClockEl) realClockEl.textContent = `${chrono.realTime.toFixed(1)}s`;
    if (vignetteEl) {
      vignetteEl.style.opacity = (0.85 * (1 - Math.min(1, chrono.timeScale))).toFixed(2);
    }

    // Estado da moldura central
    const frameBox = document.getElementById('optical-frame');
    const bannerEl = document.getElementById('frame-bottom-banner');
    if (frameBox) {
      frameBox.classList.remove(
        'state-idle',
        'state-target',
        'state-loaded',
        'state-inverted'
      );
      if (frame.pocketCount > 0) {
        frameBox.classList.add(
          frame.polarity === 'inverted' ? 'state-inverted' : 'state-loaded'
        );
      } else if (frame.framedLiveCount > 0) {
        frameBox.classList.add('state-target');
      } else {
        frameBox.classList.add('state-idle');
      }
    }
    if (bannerEl) bannerEl.textContent = frame.statusBanner;

    // Chapa fotográfica
    const plateDock = document.getElementById('plate-dock');
    const plateSummary = document.getElementById('plate-summary');
    const polarityBadge = document.getElementById('polarity-badge');
    if (plateDock) {
      plateDock.classList.toggle('empty', frame.pocketCount === 0);
    }
    if (plateSummary) plateSummary.textContent = frame.pocketSummary;
    if (polarityBadge) {
      polarityBadge.className = frame.polarity;
      polarityBadge.textContent =
        frame.polarity === 'inverted' ? 'NEGATIVO [R]' : 'NORMAL [R]';
    }

    // Painel de telemetria
    if (this.inspectorVisible) {
      const ecsStats = this.world.stats;
      const setTxt = (id: string, val: string) => {
        const node = document.getElementById(id);
        if (node) node.textContent = val;
      };
      setTxt('stat-ecs', `${ecsStats.alive} vivas (${ecsStats.recycledSlots} rec.)`);
      setTxt(
        'stat-accum',
        `α ${chrono.alpha.toFixed(2)} | ${chrono.stepsLastFrame} ticks`
      );
      setTxt('stat-stasis', `${frame.pocketCount} suspensas`);
      setTxt('stat-framed', `${frame.framedLiveCount} visíveis`);
      setTxt('stat-shatter', `${this.combat.shatteredTotal} alvos`);
      setTxt('stat-gizmo', frame.gizmoPinned ? 'Fixado' : 'Auto');
    }
  }
}
