import { DoomTaserViewmodel, TASER_ITEM_ID, TASER_RANGE, TASER_RECHARGE_SECONDS, TASER_STUN_SECONDS, taserImpactDistance, advanceTaserRecharge } from '../src/doom/DoomTaser';
import { SHOTGUN_PART_IDS, SHOTGUN_ITEM_ID, SHOTGUN_AMMO_ITEM_ID, canAssembleShotgun, computeShotgunBlastDamage, shotgunImpactDistance, DoomShotgunViewmodel } from '../src/doom/DoomShotgun';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createAstronautMaterials,
  DoomAstronaut,
} from '../src/doom/DoomAstronaut';
import { DoomFlashlight, QuickHandheldKind } from '../src/doom/DoomFlashlight';
import { QuickItemAction } from '../src/doom/DoomItemAction';
import {
  createInitialSlideState,
  stepPlayerSlideState,
  DoomGameApp,
} from '../src/doom/DoomGameApp';
import {
  computeAdaptiveVerticalFov,
  computeVirtualJoystickVector,
} from '../src/doom/DoomTouchControls';
import {
  computeShortcutsHubState,
  DoomInventory,
  ITEM_CATALOG,
  QUICK_SLOT_COUNT,
  renderFirstPersonWebOverlay,
} from '../src/doom/DoomInventory';
import {
  createRandomArenaLayout,
  findValidLairChambers,
  hashArenaSeed,
} from '../src/doom/DoomArenaRandomizer';
import {
  buildDoomLabyrinth,
  evaluateDoomLightFlicker,
  gridCellToWorld,
  isSolidCell,
  isStoneSectorWorld,
  LABYRINTH_MAP,
  LAIR_GRID_CELL,
  STONE_SECTOR_START_ROW,
  syncLightPanelEmissionAttribute,
  syncNearestDoomLightsToUniforms,
  WALL_HEIGHT,
  worldToGridCell,
} from '../src/doom/DoomMazeBuilder';
import {
  DoomRadar,
  getSectorNameForCell,
  RADAR_CANVAS_SIZE,
  RADAR_EXTENDED_SPAN_CELLS,
  renderRadarMinimapCanvas,
} from '../src/doom/DoomRadar';
import { DoomPauseMenu } from '../src/doom/DoomPauseMenu';
import {
  AstronautRagdoll,
  computeCollisionSafeRagdollCamera,
  computeWalkableDragPolyline,
  sampleDragPolyline,
} from '../src/doom/DoomRagdoll';
import {
  ANNEX_MIN_GRID,
  buildDoomThemedRooms,
  getThemedRoomAtCell,
  getThemedRoomByKeyItemId,
  getThemedRoomMiniMapTile,
  isThemedRoomDoorCell,
  isThemedRoomUnlocked,
  isWalkableArenaCell,
  resetThemedRoomLocks,
  THEMED_ROOMS,
  unlockThemedRoom,
} from '../src/doom/DoomRooms';
import {
  DEFAULT_DOOM_SETTINGS,
  DOOM_SETTINGS_DESCRIPTORS,
  DOOM_SETTINGS_STORAGE_KEY,
  DoomSettingsStore,
  resolutionPresetToHeight,
  sanitizeDoomSettings,
  SETTINGS_CATEGORIES,
} from '../src/doom/DoomSettings';
import {
  createDoomSharedUniforms,
  DoomRetroCompositor,
  MAX_DOOM_LIGHTS,
} from '../src/doom/DoomShader';
import { DoomSpider } from '../src/doom/DoomSpider';
import { DoomSpiderWebManager } from '../src/doom/DoomSpiderWebs';
import {
  boostPlayerStamina,
  canPlayerSlideWithStamina,
  canPlayerSprintWithStamina,
  createInitialStaminaState,
  MAX_PLAYER_STAMINA,
  STAMINA_EXHAUSTION_RECOVERY_THRESHOLD,
  STAMINA_SLIDE_BURST_COST,
  stepPlayerStaminaState,
} from '../src/doom/DoomStamina';
import {
  applyMetricBoxUvs,
  applyMetricCylinderUvs,
  buildDoomMapObstacles,
  ObstaclePlacement,
} from '../src/doom/DoomObstacles';
import {
  createDoomTextures,
  createSpecialRoomDoorIconTexture,
  createSpecialRoomMiniMapTexture,
} from '../src/doom/DoomTextures';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import {
  computeFootstepLayerProfile,
  computeLabyrinthSoundAcoustics,
  computeSpiderStepLayerProfile,
  SoundEngine,
} from '../src/engine/audio/SoundEngine';
import { resolveCylinderWorldCollisions } from '../src/engine/physics/SpatialSweep';
import {
  AFK_HIDDEN_GRACE_MS,
  AFK_IDLE_TIMEOUT_MS,
  clearLocalMirrorRoomsForTests,
  formatRoomCodeDisplay,
  isPlayerConsideredAfk,
  MultiplayerLobbyService,
  MultiplayerRoomClient,
  NetworkPlayerPosePacket,
  NetworkWorldEvent,
  normalizeRoomCode,
  STALE_HEARTBEAT_TTL_MS,
} from '../src/multiplayer/MultiplayerService';
import { DoomMultiplayerCoordinator } from '../src/multiplayer/DoomMultiplayerCoordinator';
import {
  applyChunkMicroFade,
  buildRetro8BitQuantizerCurve,
  computeProximityVoiceAcousticParams,
  computeRadioVoiceLinkMode,
  computeSpiderVoiceHearingAlert,
  countLabyrinthWallsBetween,
  createInitialVoiceGateState,
  decodeMuLawBase64ToPcm,
  downsamplePcmWithAntiAlias,
  encodePcmToMuLawBase64,
  FULL_VOLUME_VOICE_DISTANCE,
  MAX_PROXIMITY_VOICE_DISTANCE,
  ProximityVoiceChatManager,
  RelaySeqDeduplicator,
  stepVoiceGateState,
} from '../src/multiplayer/ProximityVoiceChat';
import {
  computeDoomDancePose,
  DOOM_DANCES,
  DoomDanceId,
  getDoomDanceBeatIndex,
  getDoomDanceDefinition,
  getDoomDanceIndex,
  getNextDoomDanceId,
  isDoomDanceId,
} from '../src/doom/DoomDance';
import { TITLE_MENU_ITEMS } from '../src/terminal/TerminalBoot';

describe('Labirinto, Ninho de Teia & Aranha Gigante Procedural (Evil Crawler)', () => {
  it('mantém correspondência exata entre células da grade e coordenadas do mundo', () => {
    for (let gz = 1; gz < LABYRINTH_MAP.length - 1; gz++) {
      for (let gx = 1; gx < LABYRINTH_MAP[gz].length - 1; gx++) {
        const w = gridCellToWorld(gx, gz);
        const back = worldToGridCell(w.x, w.z);
        expect(back.gx).toBe(gx);
        expect(back.gz).toBe(gz);
      }
    }
    expect(Object.keys(ITEM_CATALOG).length).toBeGreaterThanOrEqual(8);
  });

  it('prende o jogador ao pisar numa armadilha de teia e alerta a aranha imediatamente', () => {
    const scene = new THREE.Scene();
    const uniforms = createDoomSharedUniforms();
    const webs = new DoomSpiderWebManager(scene, uniforms);
    const sound = {
      playWebTrapSnap: () => {},
      playItemUse: () => {},
    } as unknown as SoundEngine;

    const trapCell = gridCellToWorld(5, 5);
    expect(isSolidCell(LABYRINTH_MAP, 5, 5)).toBe(false);
    webs.spawnWebTrap(trapCell.x, trapCell.z, true);

    let alertedPos: THREE.Vector3 | null = null;
    const playerPos = new THREE.Vector3(trapCell.x + 0.2, 0, trapCell.z - 0.1);
    const res = webs.update(
      0.016,
      playerPos,
      false,
      false,
      sound,
      (pos) => {
        alertedPos = pos;
      }
    );

    expect(webs.isPlayerEnsnared).toBe(true);
    expect(res.speedMultiplier).toBeLessThan(0.25);
    expect(alertedPos).not.toBeNull();
  });

  it('permite que o jogador acorde no meio do Ninho da Aranha e saia caminhando livremente rasgando os fios sem re-alertar', () => {
    const scene = new THREE.Scene();
    const uniforms = createDoomSharedUniforms();
    const webs = new DoomSpiderWebManager(scene, uniforms);

    let snapPlayed = false;
    let reAlerted = false;
    const sound = {
      playWebTrapSnap: () => {
        snapPlayed = true;
      },
      playItemUse: () => {},
    } as unknown as SoundEngine;

    webs.placePlayerInWakingLairWeb();
    const playerPos = webs.lairCenter.clone();
    expect(webs.isPlayerEnsnared).toBe(true);
    expect(webs.getWakingLairSilkFactor(playerPos)).toBeGreaterThan(0.7);

    // Dentro do ninho: consegue caminhar com resistência de seda (0.35), sem disparar alerta!
    const inside = webs.update(0.05, playerPos, false, false, sound, () => {
      reAlerted = true;
    });
    expect(inside.speedMultiplier).toBeCloseTo(0.35, 2);
    expect(reAlerted).toBe(false);

    // Caminha livremente para fora do Ninho (>= 1.68m): rasga os fios e sai!
    playerPos.z -= 1.85;
    const outside = webs.update(0.05, playerPos, false, false, sound, () => {
      reAlerted = true;
    });
    expect(snapPlayed).toBe(true);
    expect(reAlerted).toBe(false);
    expect(webs.isPlayerEnsnared).toBe(false);
    expect(outside.speedMultiplier).toBe(1.0);
    expect(webs.getWakingLairSilkFactor(playerPos)).toBe(0);
  });

  it('constrói a Aranha Gigante, persegue em velocidade absurda, executa poses cinemáticas de sequestro e gera malha IK válida', () => {
    const scene = new THREE.Scene();
    const uniforms = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(scene, textures, uniforms);
    const webs = new DoomSpiderWebManager(scene, uniforms);

    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;

    const spider = new DoomSpider(
      scene,
      uniforms,
      maze.colliders,
      webs,
      mockSound
    );

    const farPlayer = new THREE.Vector3(
      maze.spawnPosition.x,
      0,
      maze.spawnPosition.z
    );
    const startPos = spider.position.clone();

    // 1 segundo em patrulha lenta (~1.18 m/s)
    for (let i = 0; i < 30; i++) {
      spider.update(
        1 / 30,
        i / 30,
        farPlayer,
        0,
        false,
        true,
        false,
        new THREE.Vector3(0, 0, -1),
        [],
        () => {}
      );
    }
    const stalkDist = Math.hypot(
      spider.position.x - startPos.x,
      spider.position.z - startPos.z
    );
    expect(stalkDist).toBeLessThan(2.0);

    // Alerta de teia -> entra imediatamente em FRENZY_CHASE muito mais rápida!
    spider.alertToWebTrap(farPlayer, farPlayer);
    expect(spider.currentState).toBe('FRENZY_CHASE');

    const chaseStart = spider.position.clone();
    for (let i = 0; i < 30; i++) {
      spider.update(
        1 / 30,
        1 + i / 30,
        farPlayer,
        0,
        true,
        false,
        true,
        new THREE.Vector3(0, 0, -1),
        [],
        () => {}
      );
    }
    const chaseDist = Math.hypot(
      spider.position.x - chaseStart.x,
      spider.position.z - chaseStart.z
    );
    expect(chaseDist).toBeGreaterThan(stalkDist * 2.5);

    // Testa sequência cinemática de arrastar o jogador até o ninho e relocação pós-sequestro
    const dragVictim = webs.dragCorridorStart.clone();
    const dragSpiderPos = new THREE.Vector3(
      dragVictim.x,
      1.38,
      dragVictim.z + 2.15
    );
    spider.updateCinematicSequence(
      0.016,
      2.5,
      'DRAGGING_TO_WEB',
      0.5,
      dragSpiderPos,
      dragVictim,
      dragVictim
    );
    expect(spider.currentState).toBe('CINEMATIC_SEQUENCE');

    spider.relocateAwayAfterAbduction();
    expect(spider.currentState).toBe('STALK_PATROL');
    expect(spider.position.distanceTo(webs.lairCenter)).toBeGreaterThan(15);

    // Verifica que todas as malhas de patas gigantes possuem coordenadas finitas e grande envergadura
    const spiderRoot = scene.getObjectByName('EvilCrawlingSpider')!;
    let checkedVertices = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    spiderRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const pos = obj.geometry.getAttribute('position');
        for (let k = 0; k < pos.count; k++) {
          const x = pos.getX(k);
          const y = pos.getY(k);
          const z = pos.getZ(k);
          expect(Number.isFinite(x)).toBe(true);
          expect(Number.isFinite(y)).toBe(true);
          expect(Number.isFinite(z)).toBe(true);
          if (obj.parent === spiderRoot) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
          }
          checkedVertices++;
        }
      }
    });
    expect(checkedVertices).toBeGreaterThan(700);
    // Confirma que a envergadura horizontal das patas gigantes supera ~3.2m
    expect(maxX - minX).toBeGreaterThan(3.2);
  });

  it('mantém postura ereta, patas sem esticar entre salas e sai limpo do estado cinemático após deixar o jogador na teia', () => {
    const scene = new THREE.Scene();
    const uniforms = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(scene, textures, uniforms);
    const webs = new DoomSpiderWebManager(scene, uniforms);

    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;

    const spider = new DoomSpider(
      scene,
      uniforms,
      maze.colliders,
      webs,
      mockSound
    );
    const spiderRoot = scene.getObjectByName('EvilCrawlingSpider')!;
    const bodyGroup = spiderRoot.children[0] as THREE.Group;

    const assertSpiderMeshHealthy = (expectFloorUpright: boolean) => {
      if (expectFloorUpright) {
        const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
          bodyGroup.quaternion
        );
        expect(worldUp.y).toBeGreaterThan(0.98);
      }
      // Nenhum vértice de pata pode ficar preso em outra sala (> 4.6m do corpo!)
      for (let i = 1; i < spiderRoot.children.length; i++) {
        const limbMesh = spiderRoot.children[i] as THREE.Mesh;
        const pos = limbMesh.geometry.getAttribute('position');
        for (let k = 0; k < pos.count; k++) {
          const d = Math.hypot(
            pos.getX(k) - spider.position.x,
            pos.getY(k) - spider.position.y,
            pos.getZ(k) - spider.position.z
          );
          expect(d).toBeLessThan(4.65);
        }
      }
    };

    // 1) Bote em corredor distante no norte (vindo direto do teto!)
    const northStrikeOrigin = gridCellToWorld(2, 1);
    const victimStrike = new THREE.Vector3(
      northStrikeOrigin.x,
      0,
      northStrikeOrigin.z
    );
    const spiderStrike = new THREE.Vector3(
      northStrikeOrigin.x,
      1.38,
      northStrikeOrigin.z - 1.45
    );
    for (let f = 0; f < 10; f++) {
      spider.updateCinematicSequence(
        0.016,
        f * 0.05,
        'STRIKE_ATTACK',
        f / 10,
        spiderStrike,
        victimStrike,
        victimStrike
      );
      assertSpiderMeshHealthy(true);
    }

    // 2) Corte de 30 metros para o corredor do Ninho Sul (DRAGGING_TO_WEB)
    for (let f = 0; f <= 20; f++) {
      const u = f / 20;
      const victimDrag = new THREE.Vector3().lerpVectors(
        webs.dragCorridorStart,
        webs.lairCenter,
        u
      );
      const spiderDrag = new THREE.Vector3(
        victimDrag.x,
        1.38,
        victimDrag.z + 2.15
      );
      spider.updateCinematicSequence(
        0.016,
        1.5 + f * 0.1,
        'DRAGGING_TO_WEB',
        u,
        spiderDrag,
        victimDrag,
        victimDrag
      );
      assertSpiderMeshHealthy(true);
    }

    // 3) Tecendo fios sobre o jogador no Ninho (WEBBING_IN_LAIR até u = 1.0)
    for (let f = 0; f <= 15; f++) {
      const u = f / 15;
      const spiderLair = new THREE.Vector3(
        webs.lairCenter.x,
        1.36,
        webs.lairCenter.z + 1.05
      );
      spider.updateCinematicSequence(
        0.016,
        4.6 + f * 0.08,
        'WEBBING_IN_LAIR',
        u,
        spiderLair,
        webs.lairCenter,
        webs.lairCenter
      );
      assertSpiderMeshHealthy(true);
    }

    // 4) Fim do apagão -> aranha reloca para longe e volta a patrulhar normalmente!
    spider.relocateAwayAfterAbduction();
    spider.ensureExitedCinematic();
    expect(spider.currentState).toBe('STALK_PATROL');
    expect(spider.position.distanceTo(webs.lairCenter)).toBeGreaterThan(18);
    assertSpiderMeshHealthy(false);

    const postPos = spider.position.clone();
    for (let i = 0; i < 30; i++) {
      spider.update(
        1 / 30,
        8 + i / 30,
        webs.lairCenter,
        0,
        false,
        false,
        false,
        new THREE.Vector3(0, 0, -1),
        [],
        () => {}
      );
      assertSpiderMeshHealthy(false);
    }
    // Confirma que a aranha voltou a se mover ativamente pelo mapa (não ficou congelada!)
    expect(spider.position.distanceTo(postPos)).toBeGreaterThan(0.35);
  });

  it('corta armadilhas de teia e fios do ninho instantaneamente ao acionar o canivete pelo atalho rápido', () => {
    expect(QUICK_SLOT_COUNT).toBe(3);
    expect(ITEM_CATALOG.rusty_knife.usable).toBe(true);

    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const webs = new DoomSpiderWebManager(scene, shared);
    const sound = {
      playWebTrapSnap: () => {},
      playItemUse: () => {},
    } as unknown as SoundEngine;

    // 1) Preso numa armadilha de corredor -> golpe de faca liberta na hora!
    const cellPos = gridCellToWorld(7, 3);
    webs.spawnWebTrap(cellPos.x, cellPos.z, true);
    webs.update(
      0.016,
      new THREE.Vector3(cellPos.x, 0, cellPos.z),
      false,
      false,
      sound,
      () => {}
    );
    expect(webs.isPlayerEnsnared).toBe(true);

    const slashRes1 = webs.slashWebWithKnife(
      new THREE.Vector3(cellPos.x, 1.72, cellPos.z),
      new THREE.Vector3(0, 0, -1),
      sound
    );
    expect(slashRes1.cutActiveSnare).toBe(true);
    expect(webs.isPlayerEnsnared).toBe(false);

    // 2) Acordou preso no Ninho Principal -> golpe de faca pelo atalho [1] corta a seda na hora!
    webs.placePlayerInWakingLairWeb();
    expect(webs.isPlayerEnsnared).toBe(true);
    expect(webs.getWakingLairSilkFactor(webs.lairCenter)).toBeGreaterThan(0.7);

    const slashRes2 = webs.slashWebWithKnife(
      new THREE.Vector3(webs.lairCenter.x, 1.72, webs.lairCenter.z),
      new THREE.Vector3(0, 0, -1),
      sound
    );
    expect(slashRes2.cutActiveSnare).toBe(true);
    expect(webs.isPlayerEnsnared).toBe(false);
    expect(webs.getWakingLairSilkFactor(webs.lairCenter)).toBe(0);
  });

  it('constrói modelagem 3D detalhada de arquitetura, caixotes de suprimento, lanterna e ação rápida de faca', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();

    const built = buildDoomLabyrinth(scene, textures, shared);
    expect(built.colliders.length).toBeGreaterThan(20);
    expect(built.lights.length).toBeGreaterThan(12);
    expect(textures.startanWall.image.width).toBe(128);
    expect(textures.stoneWall.image.width).toBe(128);
    expect(textures.stoneFloor.image.width).toBe(128);
    expect(textures.pillarBulkhead.image.width).toBe(128);

    const lightPanelsMesh = scene.getObjectByName(
      'MazeLightPanels'
    ) as THREE.Mesh | undefined;
    expect(lightPanelsMesh).toBeDefined();
    expect(
      (lightPanelsMesh!.material as THREE.ShaderMaterial).uniforms.uUseLocalUv
        .value
    ).toBe(1);

    // Verifica objetos 3D compostos e caixotes de suprimentos no mapa
    const worldItems = new DoomWorldItems(scene, shared);
    let totalItemMeshes = 0;
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) totalItemMeshes++;
    });
    expect(totalItemMeshes).toBeGreaterThan(60);

    worldItems.spawnLitFlare(new THREE.Vector3(4, 1.7, -4), 0);
    expect(worldItems.getActiveFlares().length).toBe(1);

    // Verifica Viewmodel 3D de lanterna + golpe rápido 3D de faca em 1ª pessoa
    const flashlight = new DoomFlashlight(16 / 9);
    let viewMeshes = 0;
    flashlight.viewScene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) viewMeshes++;
    });
    expect(viewMeshes).toBeGreaterThan(35);

    flashlight.triggerQuickItemAction('knife');
    flashlight.update(0.08, 0, 0, () => {});
    // Confirma que a mão esquerda com canivete entrou em animação ativa
    const quickGroup = flashlight.viewScene.children.find(
      (c) => c instanceof THREE.Group && c.visible
    );
    expect(quickGroup).toBeDefined();
  });

  it('renderiza teias orgânicas pixel-art em 1ª pessoa com centro limpo, casulo denso e retração ao cortar, além de cabos 3D catenários', () => {
    const W = 384;
    const H = 240;
    const runOverlay = (snare: number, cocoon: number, rip: number) => {
      let out: Uint8ClampedArray | null = null;
      const mockCtx = {
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: (img: { data: Uint8ClampedArray }) => {
          out = img.data;
        },
      } as unknown as CanvasRenderingContext2D;
      renderFirstPersonWebOverlay(mockCtx, snare, cocoon, rip, 1.0);
      return out!;
    };

    const countLitInRect = (
      buf: Uint8ClampedArray,
      x0: number,
      y0: number,
      x1: number,
      y1: number
    ) => {
      let lit = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (buf[(y * W + x) * 4 + 3] > 35) lit++;
        }
      }
      return lit;
    };

    const snareBuf = runOverlay(0.94, 0, 0);
    // Todos os 4 cantos devem ter teias orgânicas ricas, enquanto o centro de mira permanece 100% desobstruído!
    expect(countLitInRect(snareBuf, 0, 0, 110, 80)).toBeGreaterThan(350);
    expect(countLitInRect(snareBuf, W - 110, 0, W, 80)).toBeGreaterThan(350);
    expect(countLitInRect(snareBuf, 0, H - 80, 110, H)).toBeGreaterThan(350);
    expect(countLitInRect(snareBuf, W - 110, H - 80, W, H)).toBeGreaterThan(
      350
    );
    expect(countLitInRect(snareBuf, 152, 92, 232, 148)).toBe(0);

    // O casulo do Ninho acrescenta arcos orgânicos adicionais nas bordas
    const cocoonBuf = runOverlay(0.4, 0.88, 0);
    const totalSnareLit = countLitInRect(snareBuf, 0, 0, W, H);
    const totalCocoonLit = countLitInRect(cocoonBuf, 0, 0, W, H);
    expect(totalCocoonLit).toBeGreaterThan(totalSnareLit + 600);

    // Ao cortar com a faca (rip -> 0.85), os fios retraem e desaparecem
    const rippedBuf = runOverlay(0.94, 0, 0.85);
    expect(countLitInRect(rippedBuf, 0, 0, W, H)).toBeLessThan(
      totalSnareLit * 0.45
    );

    // Verifica cabos catenários 3D e contador de ruptura no mundo 3D
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const webs = new DoomSpiderWebManager(scene, shared);
    let totalWebMeshes = 0;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) totalWebMeshes++;
    });
    expect(totalWebMeshes).toBeGreaterThan(80);

    const prevSeq = webs.snapBurstSequence;
    webs.placePlayerInWakingLairWeb();
    webs.slashWebWithKnife(
      webs.lairCenter,
      new THREE.Vector3(0, 0, -1),
      { playWebTrapSnap: () => {} } as unknown as SoundEngine
    );
    expect(webs.snapBurstSequence).toBe(prevSeq + 1);
  });

  it('derruba e oculta a lanterna e itens em 1ª pessoa ao ser sequestrado/desmaiado pela aranha, permitindo reequipar após acordar', () => {
    const flashlight = new DoomFlashlight(16 / 9);

    // Jogador está com a lanterna acesa na mão direita E usando o canivete na mão esquerda
    expect(flashlight.toggle()).toBe(true);
    let activeOut = { beamIntensity: 0, aimYawOffset: 0, aimPitchOffset: 0 };
    for (let i = 0; i < 12; i++) {
      activeOut = flashlight.update(0.05, i * 0.2, 3.0, () => {}, 0, 100);
    }
    flashlight.triggerQuickItemAction('knife');
    flashlight.update(0.05, 1.0, 2.0, () => {}, 0, 100);
    expect(flashlight.isEquipped).toBe(true);
    expect(flashlight.isVisibleInView).toBe(true);
    expect(activeOut.beamIntensity).toBeGreaterThan(0.8);

    // Aranha captura o jogador -> inicia queda imediata da lanterna
    flashlight.beginKnockoutDrop();
    expect(flashlight.isEquipped).toBe(false);

    // No início do impacto (~0.04s), a mão está caindo para baixo da tela
    const impactStep = flashlight.updateKnockoutDrop(0.04, 100);
    expect(impactStep.aimPitchOffset).toBeLessThan(0);

    // Antes do desmaio e do arrasto (~0.42s), o foco e o modelo 3D estão 100% apagados e invisíveis!
    let afterDrop = impactStep;
    for (let i = 0; i < 10; i++) {
      afterDrop = flashlight.updateKnockoutDrop(0.05, 100);
    }
    expect(afterDrop.beamIntensity).toBe(0);
    expect(flashlight.isVisibleInView).toBe(false);

    // Depois de acordar na teia, apertar F volta a sacar e acender a lanterna sem qualquer travamento
    expect(flashlight.toggle()).toBe(true);
    let reequipOut = { beamIntensity: 0, aimYawOffset: 0, aimPitchOffset: 0 };
    for (let i = 0; i < 12; i++) {
      reequipOut = flashlight.update(0.05, 0, 0, () => {}, 0, 100);
    }
    expect(flashlight.isEquipped).toBe(true);
    expect(flashlight.isVisibleInView).toBe(true);
    expect(reequipOut.beamIntensity).toBeGreaterThan(0.8);
  });

  it('constrói o protagonista Astronauta 3D completo, marca seus dois braços como ativos e utiliza os braços originais do astronauta na lanterna, faca e todos os objetos', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const astronaut = new DoomAstronaut(scene, shared);

    expect(scene.getObjectByName('DoomProtagonistAstronaut')).toBe(
      astronaut.root
    );
    expect(astronaut.root.userData.characterId).toBe('protagonist_astronaut');

    // Modelo 3D limpo e coeso em Traje Biológico Encapsulado Nível-A (capuz integrado + viseira panorâmica + bolsa dorsal interna + luvas pretas + galochas amarelas)
    expect(astronaut.headGroup.name).toBe('AstronautHelmet');
    expect(astronaut.plssBackpack.name).toBe('AstronautPLSSBackpack');

    let totalAstronautMeshes = 0;
    astronaut.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) totalAstronautMeshes++;
    });
    // Geometria enxuta e sem poluição de micro-peças (reduzida de ~200 malhas sobrepostas para ~78 malhas limpas incluindo os 10 dedos articulados)
    expect(totalAstronautMeshes).toBeGreaterThanOrEqual(55);
    expect(totalAstronautMeshes).toBeLessThanOrEqual(95);

    // Ambos os braços do Traje Biológico são explicitamente marcados como braços ativos de gameplay
    for (const [arm, expectedSide, expectedName] of [
      [astronaut.leftArm, 'left', 'AstronautLeftArm'],
      [astronaut.rightArm, 'right', 'AstronautRightArm'],
    ] as const) {
      expect(arm.root.name).toBe(expectedName);
      expect(arm.metadata.isAstronautArm).toBe(true);
      expect(arm.metadata.isActiveGameplayArm).toBe(true);
      expect(arm.metadata.armSide).toBe(expectedSide);
      expect(arm.root.userData.isAstronautArm).toBe(true);
      expect(arm.root.userData.isActiveGameplayArm).toBe(true);
      expect(arm.fingers.length).toBe(4);
      // Anel único vermelho de travamento hermético no punho (sem excesso de travas metálicas)
      expect(arm.wristRingGroup.children.length).toBe(1);
    }
    // Sem caixa de manômetro espacial saliente no antebraço
    expect(astronaut.leftArm.gaugeNeedleMesh).toBeNull();

    // Sincronização em 1ª pessoa e em pose supina: corpo próprio permanece oculto para o jogador local!
    const playerPos = new THREE.Vector3(2, 0, -4);
    astronaut.updateFirstPersonBody(playerPos, 0.5, 1.2, 4.0, 0, true, true);
    expect(astronaut.root.visible).toBe(false);
    expect(astronaut.rightArm.metadata.currentlyInUse).toBe(true);
    expect(astronaut.leftArm.metadata.currentlyInUse).toBe(true);
    expect(astronaut.headGroup.visible).toBe(false);

    astronaut.updateSupineAbductionPose(playerPos, Math.PI, 1.5, true);
    expect(astronaut.root.visible).toBe(false);
    expect(astronaut.rightArm.metadata.currentlyInUse).toBe(false);
    expect(astronaut.leftArm.metadata.currentlyInUse).toBe(false);

    // Modo 3ª pessoa restaura capuz biológico (5 malhas limpas), bolsa dorsal encapsulada (3 malhas limpas) e braços completos
    astronaut.setFirstPersonMode(false);
    expect(astronaut.root.visible).toBe(true);
    expect(astronaut.headGroup.visible).toBe(true);
    expect(astronaut.headGroup.children.length).toBe(5);
    expect(astronaut.plssBackpack.visible).toBe(true);
    expect(astronaut.plssBackpack.children.length).toBe(3);
    expect(astronaut.leftArm.root.visible).toBe(true);
    expect(astronaut.rightArm.root.visible).toBe(true);

    // Verifica que as galochas amarelas ficam niveladas ao piso (y ~ 0.00m) tanto em pé quanto 100% agachado (zero afundamento!)
    for (const testCrouch of [0, 0.5, 1]) {
      astronaut.updateThirdPersonAlly(
        new THREE.Vector3(0, 0, 0),
        0,
        0,
        0,
        0,
        testCrouch,
        false,
        false
      );
      astronaut.root.updateMatrixWorld(true);
      let minCharY = Infinity;
      const vTmp = new THREE.Vector3();
      astronaut.hipsGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const posAttr = mesh.geometry.getAttribute('position');
        for (let i = 0; i < posAttr.count; i++) {
          vTmp.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
          if (vTmp.y < minCharY) minCharY = vTmp.y;
        }
      });
      expect(minCharY).toBeGreaterThanOrEqual(-0.008);
      expect(minCharY).toBeLessThanOrEqual(0.018);
    }

    // Entrada e saída do slide: pose assimétrica, botas sem atravessar o piso e recuperação do agachamento.
    for (const slide of [0, 0.25, 0.5, 0.75, 1]) {
      astronaut.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 1, false, false, false, false, null, 1 / 60, slide);
      astronaut.root.updateMatrixWorld(true);
      let minY = Infinity;
      const vertex = new THREE.Vector3();
      astronaut.hipsGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const positions = mesh.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
          minY = Math.min(minY, vertex.y);
        }
      });
      expect(minY).toBeGreaterThanOrEqual(-0.015);
      expect(minY).toBeLessThanOrEqual(0.03);
      if (slide === 1) {
        expect((astronaut as any).leftLeg.kneePivot.rotation.x).toBeCloseTo(-0.30);
        expect((astronaut as any).rightLeg.kneePivot.rotation.x).toBeCloseTo(-2.0);
      }
    }
    astronaut.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 1, false, false);
    expect((astronaut as any).leftLeg.kneePivot.rotation.x).toBeCloseTo(-1.88);

    // Captura/arrasto têm prioridade sobre o slide recebido pela rede.
    for (const dragged of [false, true]) {
      astronaut.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 1, false, true, false, dragged, new THREE.Vector3(2, 1, 0), 1 / 60, 0);
      const captureRotation = astronaut.torsoGroup.rotation.toArray();
      astronaut.updateThirdPersonAlly(new THREE.Vector3(), 0, 0, 0, 0, 1, false, true, false, dragged, new THREE.Vector3(2, 1, 0), 1 / 60, 1);
      expect(astronaut.torsoGroup.rotation.toArray()).toEqual(captureRotation);
    }

    // Viewmodel em 1ª pessoa usa exatamente os braços originais marcados do Astronauta (AstronautRightArm + AstronautLeftArm)
    const flashlight = new DoomFlashlight(16 / 9);
    expect(flashlight.rightAstronautArm.root.name).toBe('AstronautRightArm');
    expect(flashlight.rightAstronautArm.metadata.isAstronautArm).toBe(true);
    expect(flashlight.rightAstronautArm.metadata.isActiveGameplayArm).toBe(
      true
    );
    expect(flashlight.leftAstronautArm.root.name).toBe('AstronautLeftArm');
    expect(flashlight.leftAstronautArm.metadata.isAstronautArm).toBe(true);
    expect(flashlight.leftAstronautArm.metadata.isActiveGameplayArm).toBe(true);

    // Lanterna (F) marca o braço direito do Astronauta como em uso
    flashlight.toggle();
    for (let i = 0; i < 10; i++) {
      flashlight.update(0.04, 0, 0, () => {}, 0, 100);
    }
    expect(flashlight.rightAstronautArm.metadata.currentlyInUse).toBe(true);
    expect(
      flashlight.viewScene.getObjectByName('AstronautRightArm')
    ).toBeDefined();

    // Todas as animações de objetos empunhados (faca, gaze, láudano, bateria, magnésio e chave) usam o braço esquerdo original do Astronauta!
    expect(ITEM_CATALOG.sector_b_key.usable).toBe(true);
    const handheldKinds: QuickHandheldKind[] = [
      'knife',
      'bandage',
      'morphine',
      'battery',
      'flare',
      'key',
      'radar',
    ];
    for (const kind of handheldKinds) {
      flashlight.triggerQuickItemAction(kind);
      flashlight.update(0.08, 0, 0, () => {}, 0, 100);
      expect(flashlight.isLeftArmAnimating).toBe(true);
      expect(flashlight.leftAstronautArm.metadata.currentlyInUse).toBe(true);
      expect(
        flashlight.viewScene.getObjectByName('AstronautLeftArm')
      ).toBeDefined();
    }

    // Desmaiar / guardar forçado limpa o estado de uso dos dois braços do Astronauta
    flashlight.forceStowImmediate();
    expect(flashlight.rightAstronautArm.metadata.currentlyInUse).toBe(false);
    expect(flashlight.leftAstronautArm.metadata.currentlyInUse).toBe(false);
    expect(flashlight.isLeftArmAnimating).toBe(false);
  });

  it('ancora 100% da modelagem 3D das armadilhas de teia apenas em paredes, colunas, piso e teto realmente existentes em todas as células do mapa', () => {
    const baseScene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(baseScene, textures, shared);
    const clampTmp = new THREE.Vector3();

    const distToNearestSolidSurface = (ptWorld: THREE.Vector3): number => {
      let minD = Math.min(
        Math.abs(ptWorld.y),
        Math.abs(WALL_HEIGHT - ptWorld.y)
      );
      for (const col of maze.colliders) {
        col.box.clampPoint(ptWorld, clampTmp);
        const d = clampTmp.distanceTo(ptWorld);
        if (d < minD) minD = d;
      }
      return minD;
    };

    let testedCells = 0;
    let verifiedAnchorPoints = 0;

    for (let gz = 0; gz < LABYRINTH_MAP.length; gz++) {
      for (let gx = 0; gx < LABYRINTH_MAP[gz].length; gx++) {
        if (isSolidCell(LABYRINTH_MAP, gx, gz)) continue;

        const cellScene = new THREE.Scene();
        const wm = new DoomSpiderWebManager(cellScene, shared);
        const w = gridCellToWorld(gx, gz);
        // Testa também chamada levemente deslocada do centro e tecelagem progressiva (instant = false)
        const trap = wm.spawnWebTrap(w.x + 0.18, w.z - 0.14, false);
        if (!trap) continue;

        testedCells++;
        // Mesmo durante a tecelagem (weaveProgress < 1), X e Z permanecem 1.0 (cravados nas paredes!)
        expect(trap.group.scale.x).toBe(1);
        expect(trap.group.scale.z).toBe(1);

        trap.group.scale.set(1, 1, 1);
        trap.group.updateMatrixWorld(true);

        trap.group.traverse((obj) => {
          const ud = obj.userData as Record<string, THREE.Vector3 | string>;
          const assertAnchored = (localPt: THREE.Vector3) => {
            const worldPt = localPt.clone().applyMatrix4(trap.group.matrixWorld);
            const dist = distToNearestSolidSurface(worldPt);
            expect(dist).toBeLessThanOrEqual(0.05);
            verifiedAnchorPoints++;
          };

          if (ud.webPart === 'catenary_cable') {
            assertAnchored(ud.anchorA as THREE.Vector3);
            assertAnchored(ud.anchorB as THREE.Vector3);
          } else if (ud.webPart === 'anchored_corner_sheet') {
            const c0 = ud.cornerOrigin as THREE.Vector3;
            const u0 = ud.edgeAlongU0 as THREE.Vector3;
            const v0 = ud.edgeAlongV0 as THREE.Vector3;
            assertAnchored(c0);
            assertAnchored(u0);
            assertAnchored(v0);
            assertAnchored(c0.clone().lerp(u0, 0.5));
            assertAnchored(c0.clone().lerp(v0, 0.5));
          } else if (ud.webPart === 'anchored_orb_quad') {
            const bA = ud.botA as THREE.Vector3;
            const bB = ud.botB as THREE.Vector3;
            const tA = ud.topA as THREE.Vector3;
            const tB = ud.topB as THREE.Vector3;
            assertAnchored(bA);
            assertAnchored(bB);
            assertAnchored(tA);
            assertAnchored(tB);
            assertAnchored(bA.clone().lerp(tA, 0.5));
            assertAnchored(bB.clone().lerp(tB, 0.5));
          }
        });
      }
    }

    expect(testedCells).toBeGreaterThan(400);
    expect(verifiedAnchorPoints).toBeGreaterThan(10000);
  });

  it('expande o complexo subterrâneo para escala 29x29 multi-setores 100% interligado com iluminação dinâmica e 24 caixotes', () => {
    expect(LABYRINTH_MAP.length).toBe(29);
    for (const row of LABYRINTH_MAP) {
      expect(row.length).toBe(29);
    }

    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(scene, textures, shared);

    // 1) 100% das células caminháveis alcançáveis a partir do spawn (grafo conexo único > 440 células!)
    const start = worldToGridCell(maze.spawnPosition.x, maze.spawnPosition.z);
    const visited = new Set<string>([`${start.gx},${start.gz}`]);
    const queue: Array<[number, number]> = [[start.gx, start.gz]];
    while (queue.length > 0) {
      const [cx, cz] = queue.shift()!;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + dx;
        const nz = cz + dz;
        const key = `${nx},${nz}`;
        if (!isSolidCell(LABYRINTH_MAP, nx, nz) && !visited.has(key)) {
          visited.add(key);
          queue.push([nx, nz]);
        }
      }
    }

    let totalWalkable = 0;
    for (let gz = 0; gz < LABYRINTH_MAP.length; gz++) {
      for (let gx = 0; gx < LABYRINTH_MAP[gz].length; gx++) {
        if (!isSolidCell(LABYRINTH_MAP, gx, gz)) {
          totalWalkable++;
          expect(visited.has(`${gx},${gz}`)).toBe(true);
        }
      }
    }
    expect(totalWalkable).toBeGreaterThan(440);

    // 2) Iluminação distribuída pelos 5 setores (>= 70 pontos luminosos) + streaming das luzes mais próximas
    expect(maze.lights.length).toBeGreaterThanOrEqual(70);
    expect(MAX_DOOM_LIGHTS).toBeGreaterThanOrEqual(48);
    const lairWorld = gridCellToWorld(
      maze.arenaLayout.lairCell.gx,
      maze.arenaLayout.lairCell.gz
    );
    const uploaded = syncNearestDoomLightsToUniforms(
      maze.lights.map((l) => ({
        position: l.position,
        intensity: l.baseIntensity,
      })),
      new THREE.Vector3(lairWorld.x, 0, lairWorld.z),
      shared
    );
    expect(uploaded).toBe(MAX_DOOM_LIGHTS);
    const nearestUploadedDist = Math.hypot(
      shared.uLightPositions.value[0].x - lairWorld.x,
      shared.uLightPositions.value[0].z - lairWorld.z
    );
    expect(nearestUploadedDist).toBeLessThan(1.0);

    // 3) Transição acústica precisa entre setores industriais Norte e Catacumbas Sul (inclusive com spawn aleatório)
    const northRef = gridCellToWorld(2, 1);
    const southRef = gridCellToWorld(LAIR_GRID_CELL.gx, LAIR_GRID_CELL.gz);
    expect(isStoneSectorWorld(northRef.x, northRef.z)).toBe(false);
    expect(isStoneSectorWorld(southRef.x, southRef.z)).toBe(true);
    expect(
      isStoneSectorWorld(maze.spawnPosition.x, maze.spawnPosition.z)
    ).toBe(start.gz >= STONE_SECTOR_START_ROW);

    // 4) 24 caixotes de suprimento esculpidos e 100% alcançáveis em todos os setores
    const items = new DoomWorldItems(scene, shared);
    let collectedCount = 0;
    const collectedIds = new Set<string>();
    const invMock = {
      addItem: (itemId: string) => {
        collectedCount++;
        collectedIds.add(itemId);
        return true;
      },
    };
    // Aproxima-se pela frente do obstáculo, em vez de presumir que o item
    // continua próximo ao centro da célula no chão.
    for (const c of maze.arenaLayout.cratePlacements) {
      const w = gridCellToWorld(c.gx, c.gz);
      const front = new THREE.Vector3(Math.sin(c.crateYaw), 0, Math.cos(c.crateYaw));
      const player = new THREE.Vector3(w.x + c.ox, 0, w.z + c.oz).addScaledVector(front, .96);
      const camera = player.clone().add(new THREE.Vector3(0, 1.72, 0));
      const lookAt = front.clone().negate();
      // Caixote lacrado: abrir com [E] e esperar a tampa subir antes de recolher.
      items.updateAndCheckPickups(.016, 0, player, camera, lookAt, true, invMock as never);
      for (let frame = 0; frame < 40; frame++) {
        items.updateAndCheckPickups(.016, 0, player, camera, lookAt, false, invMock as never);
      }
    }
    // 25 caixotes, com o Taser adicional na mesma caixa de cartuchos.
    expect(collectedCount).toBe(26);
    expect(collectedIds.has('field_taser')).toBe(true);
    expect(collectedIds.has('torn_log_04')).toBe(true);
    expect(collectedIds.has('field_radar')).toBe(true);
    expect(collectedIds.has('rusty_knife')).toBe(true);
    expect(collectedIds.has('arachnid_report_09')).toBe(true);
    expect(collectedIds.has('sector_b_key')).toBe(true);
  });

  it('mantém o corpo próprio invisível em 1ª pessoa mesmo ao olhar totalmente para baixo, corrige punho reto na lanterna simples e anima o canivete oxidado', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const astronaut = new DoomAstronaut(scene, shared);
    const mats = createAstronautMaterials();

    // 1) Camuflagem Astronáutica 64x64 de alto contraste aplicada nos braços e traje
    const camoMat = mats.astroCamo as THREE.MeshLambertMaterial;
    expect(camoMat.map).toBeDefined();
    expect(camoMat.map!.image.width).toBe(64);
    const camoPixels = camoMat.map!.image.data as Uint8Array;
    let minLum = 255;
    let maxLum = 0;
    for (let i = 0; i < camoPixels.length; i += 4) {
      const lum = (camoPixels[i] + camoPixels[i + 1] + camoPixels[i + 2]) / 3;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }
    expect(maxLum - minLum).toBeGreaterThan(120);

    // 2) Olhando na horizontal (pitch = 0) OU totalmente para baixo (pitch = -1.12):
    //    o corpo próprio permanece 100% invisível para o jogador local (zero clipping/bugs visuais)!
    for (const testPitch of [0, -0.6, -1.12]) {
      for (const lanternEquipped of [false, true]) {
        astronaut.updateFirstPersonBody(
          new THREE.Vector3(0, 0, 0),
          0,
          0,
          0,
          0,
          lanternEquipped,
          false,
          testPitch
        );
        const upperChest = astronaut.torsoGroup.getObjectByName(
          'AstronautUpperChest'
        )!;
        expect(astronaut.root.visible).toBe(false);
        expect(upperChest.visible).toBe(false);
        expect(astronaut.leftArm.root.visible).toBe(false);
        expect(astronaut.rightArm.root.visible).toBe(false);
      }
    }

    // 3) Braço direito na lanterna possui punho reto coaxial (sem torção quebrada) e sem braço superior invadindo a lente!
    const fl = new DoomFlashlight(16 / 9);
    expect(fl.rightAstronautArm.upperArmGroup.children.length).toBe(0);
    expect(
      Math.hypot(
        fl.rightAstronautArm.wristPivot.rotation.x,
        fl.rightAstronautArm.wristPivot.rotation.z
      )
    ).toBeLessThan(0.05);

    // Verifica que todas as pontas dos dedos envolvem o tubo externo da lanterna sem atravessá-lo (r >= 0.026)
    fl.toggle();
    for (let i = 0; i < 12; i++) {
      fl.update(0.04, 0, 0, () => {}, 0, 100);
    }
    fl.viewScene.updateMatrixWorld(true);
    const lanternModel = fl.rightAstronautArm.root.parent!;
    const invModel = lanternModel.matrixWorld.clone().invert();
    for (const fg of fl.rightAstronautArm.fingers) {
      const tipWorld = new THREE.Vector3();
      fg.distPivot.children[2].getWorldPosition(tipWorld);
      tipWorld.applyMatrix4(invModel);
      expect(Math.hypot(tipWorld.x, tipWorld.y)).toBeGreaterThanOrEqual(0.026);
    }

    // 4) Canivete Oxidado montado no gripSocket da luva EVA esquerda com abertura dobrável + golpe pelas juntas!
    const bladePivot = fl.leftAstronautArm.gripSocket.getObjectByName(
      'AstronautPocketKnifeBladePivot'
    );
    expect(bladePivot).toBeDefined();

    fl.triggerQuickItemAction('knife');
    fl.update(0.02, 0, 0, () => {}, 0, 100);
    const initialFold = bladePivot!.rotation.x;
    const initialWristRoll = fl.leftAstronautArm.wristPivot.rotation.y;
    expect(initialFold).toBeLessThan(-1.0);

    // Meio do golpe diagonal: lâmina totalmente travada aberta (0 rad) e punho EVA rotacionando axialmente!
    fl.update(0.22, 0, 0, () => {}, 0, 100);
    expect(Math.abs(bladePivot!.rotation.x)).toBeLessThan(0.02);
    expect(
      Math.abs(fl.leftAstronautArm.wristPivot.rotation.y - initialWristRoll)
    ).toBeGreaterThan(0.25);
  });

  it('permite encontrar o Radar Topográfico e exibe minimapa com posição exata do jogador e pontos prováveis de equipamentos', () => {
    expect(ITEM_CATALOG.field_radar).toBeDefined();
    expect(ITEM_CATALOG.field_radar.usable).toBe(true);
    expect(ITEM_CATALOG.field_radar.droppable).toBe(false);

    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const items = new DoomWorldItems(scene, shared);

    // 1) Todos os sinais prováveis iniciais situam-se dentro de células abertas transitáveis
    const initialSignals = items.getUncollectedEquipmentSignals();
    expect(initialSignals.length).toBe(29);
    for (const sig of initialSignals) {
      const cell = worldToGridCell(sig.probableX, sig.probableZ);
      expect(isWalkableArenaCell(cell.gx, cell.gz, { ignoreRoomLocks: true })).toBe(true);
      expect(sig.uncertaintyRadiusM).toBeGreaterThan(1.0);
    }

    // 2) Ao caminhar até a caixa aleatória onde o Radar Topográfico foi gerado, o jogador o encontra e ativa!
    const radar = new DoomRadar(null);
    expect(radar.hasRadar).toBe(false);
    expect(radar.isActive).toBe(false);

    const radarCrate = items
      .getPickupsSnapshot()
      .find((p) => p.itemId === 'field_radar')!;
    expect(radarCrate).toBeDefined();

    let radarPicked = false;
    const radarPlayer = new THREE.Vector3(radarCrate.position.x, 0, radarCrate.position.z);
    const radarCamera = new THREE.Vector3(radarCrate.position.x, 1.72, radarCrate.position.z);
    const radarLook = radarCrate.position.clone().sub(radarCamera).normalize();
    const collectRadar = (interact: boolean) =>
      items.updateAndCheckPickups(
        0.016,
        0,
        radarPlayer,
        radarCamera,
        radarLook,
        interact,
        { addItem: () => true } as never,
        (itemId) => {
          if (itemId === 'field_radar') {
            radarPicked = true;
            radar.unlockAndActivate();
          }
        }
      );
    // Interage para abrir o caixote e espera a tampa subir antes de recolher.
    collectRadar(true);
    for (let frame = 0; frame < 40; frame++) collectRadar(false);

    expect(radarPicked).toBe(true);
    expect(radar.hasRadar).toBe(true);
    expect(radar.isActive).toBe(true);

    // O item coletado deixa de emitir sinal provável no radar (29 -> 28)
    const remainingSignals = items.getUncollectedEquipmentSignals();
    expect(remainingSignals.length).toBe(28);

    // 3) Alternância de visibilidade [M], escala [N] (GERAL <-> ZOOM) e nomes táticos de setores
    expect(radar.mode).toBe('FULL');
    expect(radar.cycleScaleMode()).toBe('LOCAL');
    expect(radar.cycleScaleMode()).toBe('FULL');
    expect(radar.toggleActive()).toBe(false);
    expect(radar.toggleActive()).toBe(true);

    expect(getSectorNameForCell(2, 1)).toBe('ESCLUSA NOROESTE');
    expect(getSectorNameForCell(22, 5)).toBe('SALÃO DOS REATORES');
    expect(getSectorNameForCell(14, 11)).toBe('ÁTRIO CENTRAL');
    expect(getSectorNameForCell(14, 23)).toBe('GRANDE NINHO SUL');

    // 4) Renderização 2D do minimapa (203x203) desenha a planta, o marcador exato do jogador e os ecos de equipamentos
    const drawOps: Array<{ style: string; x: number; y: number; w: number; h: number }> = [];
    let arcCalls = 0;
    const mockCtx = {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      fillRect: function (
        this: { fillStyle: string },
        x: number,
        y: number,
        w: number,
        h: number
      ) {
        drawOps.push({ style: String(this.fillStyle), x, y, w, h });
      },
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      setLineDash: () => {},
      arc: () => {
        arcCalls++;
      },
    } as unknown as CanvasRenderingContext2D;

    const explored = new Uint8Array(29 * 29);
    const radarCell = worldToGridCell(
      radarCrate.position.x,
      radarCrate.position.z
    );
    explored[radarCell.gz * 29 + radarCell.gx] = 1;
    renderRadarMinimapCanvas(mockCtx, {
      playerX: radarCrate.position.x,
      playerZ: radarCrate.position.z,
      playerYaw: -Math.PI * 0.5,
      elapsedSec: 2.5,
      mode: 'FULL',
      exploredMask: explored,
      signals: remainingSignals,
    });

    // Verifica que os 24 anéis prováveis + feixe + cone direcional foram desenhados, além do núcleo branco na posição exata do jogador!
    expect(arcCalls).toBeGreaterThanOrEqual(26);
    const extMinWorld = -((29 * 3) / 2) + ANNEX_MIN_GRID * 3;
    const extSpanWorld = RADAR_EXTENDED_SPAN_CELLS * 3;
    const expectedPxX = Math.round(
      ((radarCrate.position.x - extMinWorld) / extSpanWorld) * RADAR_CANVAS_SIZE
    );
    const expectedPxY = Math.round(
      ((radarCrate.position.z - extMinWorld) / extSpanWorld) * RADAR_CANVAS_SIZE
    );
    const playerCoreDraw = drawOps.find(
      (op) =>
        op.style === '#ffffff' &&
        op.x === expectedPxX - 1 &&
        op.y === expectedPxY - 1 &&
        op.w === 3 &&
        op.h === 3
    );
    expect(playerCoreDraw).toBeDefined();

    radar.destroy();
  });

  it('garante que nenhum LED de teto ou parede colida com paredes, vigas ou molduras e que pórticos fiquem limpos', () => {
    const scene = new THREE.Scene();
    const uniforms = createDoomSharedUniforms();
    const textures = createDoomTextures();
    buildDoomLabyrinth(scene, textures, uniforms);

    const meshes: Record<string, THREE.Mesh> = {};
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.name) {
        meshes[obj.name] = obj as THREE.Mesh;
      }
    });

    const countIntersectingTris = (
      mesh: THREE.Mesh | undefined,
      testBox: THREE.Box3
    ): number => {
      if (!mesh) return 0;
      const g = mesh.geometry;
      const p = g.getAttribute('position');
      const index = g.getIndex();
      const tri = new THREE.Triangle();
      let hits = 0;
      const triCount = index ? index.count / 3 : p.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index.getX(t * 3) : t * 3;
        const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
        tri.a.set(p.getX(i0), p.getY(i0), p.getZ(i0));
        tri.b.set(p.getX(i1), p.getY(i1), p.getZ(i1));
        tri.c.set(p.getX(i2), p.getY(i2), p.getZ(i2));
        if (testBox.intersectsTriangle(tri)) hits++;
      }
      return hits;
    };

    const lightMesh = meshes['MazeLightPanels'];
    expect(lightMesh).toBeDefined();
    const pos = lightMesh.geometry.getAttribute('position');
    let ceilingCount = 0;
    let wallCount = 0;

    for (let v = 0; v < pos.count; v += 4) {
      const box = new THREE.Box3();
      for (let k = 0; k < 4; k++) {
        box.expandByPoint(
          new THREE.Vector3(pos.getX(v + k), pos.getY(v + k), pos.getZ(v + k))
        );
      }
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const cell = worldToGridCell(center.x, center.z);
      const ch = LABYRINTH_MAP[cell.gz]?.[cell.gx];

      if (size.y < 0.25) {
        // 1. Plafons de teto: sempre em células abertas '.' e sem colidir com paredes ou vigas
        ceilingCount++;
        expect(ch).toBe('.');
        const fixtureBox = box
          .clone()
          .expandByVector(new THREE.Vector3(0.12, 0.04, 0.12));
        for (const mName of [
          'MazeWallsStartan',
          'MazeWallsStone',
          'MazeBulkheadPillar',
          'MazePropsWood',
          'MazeTrimMetal',
        ]) {
          expect(countIntersectingTris(meshes[mName], fixtureBox)).toBe(0);
        }
      } else {
        // 2. LEDs de parede ('L'): sempre voltados para corredor livre ('.' ou 'P', nunca para arco 'A') e sem molduras na frente
        wallCount++;
        expect(ch === '.' || ch === 'P').toBe(true);
        const cellCenter = gridCellToWorld(cell.gx, cell.gz);
        const dirX = Math.sign(cellCenter.x - center.x);
        const dirZ = Math.sign(cellCenter.z - center.z);
        const wallFaceX = center.x - dirX * 0.02;
        const wallFaceZ = center.z - dirZ * 0.02;
        const frontBox = new THREE.Box3();
        if (Math.abs(size.x) > Math.abs(size.z)) {
          frontBox.min.set(
            center.x - 0.5,
            0.65,
            Math.min(wallFaceZ + dirZ * 0.13, wallFaceZ + dirZ * 0.85)
          );
          frontBox.max.set(
            center.x + 0.5,
            2.65,
            Math.max(wallFaceZ + dirZ * 0.13, wallFaceZ + dirZ * 0.85)
          );
        } else {
          frontBox.min.set(
            Math.min(wallFaceX + dirX * 0.13, wallFaceX + dirX * 0.85),
            0.65,
            center.z - 0.5
          );
          frontBox.max.set(
            Math.max(wallFaceX + dirX * 0.13, wallFaceX + dirX * 0.85),
            2.65,
            center.z + 0.5
          );
        }
        for (const mName of Object.keys(meshes)) {
          if (mName === 'MazeLightPanels') continue;
          expect(countIntersectingTris(meshes[mName], frontBox)).toBe(0);
        }
      }
    }

    expect(ceilingCount).toBe(13);
    expect(wallCount).toBeGreaterThanOrEqual(50);

    // 3. Quadros de madeira ('MazePropsWood') não cruzam vigas de pedra/metal nem passam do teto (WALL_HEIGHT)
    for (const m of Object.values(meshes)) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        expect(p.getY(i)).toBeLessThanOrEqual(WALL_HEIGHT + 0.005);
      }
    }
  });

  it('mantém a HUB minimizada de atalhos semi-transparente quando não configurada e mais visível ao selecionar ou interagir', () => {
    const unconfiguredIdle = computeShortcutsHubState({
      inventoryOpen: false,
      gameOver: false,
      cinematicHidden: false,
      hasConfiguredSlots: false,
      isHovered: false,
      activeUntilMs: 0,
      nowMs: 1000,
    });
    expect(unconfiguredIdle.tier).toBe('unconfigured');
    expect(unconfiguredIdle.opacity).toBeCloseTo(0.34, 2);

    const configuredIdle = computeShortcutsHubState({
      inventoryOpen: false,
      gameOver: false,
      cinematicHidden: false,
      hasConfiguredSlots: true,
      isHovered: false,
      activeUntilMs: 500,
      nowMs: 1000,
    });
    expect(configuredIdle.tier).toBe('configured-idle');
    expect(configuredIdle.opacity).toBeGreaterThan(unconfiguredIdle.opacity);
    expect(configuredIdle.opacity).toBeLessThan(0.7);

    const selectingByWheelOrKey = computeShortcutsHubState({
      inventoryOpen: false,
      gameOver: false,
      cinematicHidden: false,
      hasConfiguredSlots: false,
      isHovered: false,
      activeUntilMs: 4200,
      nowMs: 1500,
    });
    expect(selectingByWheelOrKey.tier).toBe('active');
    expect(selectingByWheelOrKey.opacity).toBeGreaterThan(0.9);

    const hoveredState = computeShortcutsHubState({
      inventoryOpen: false,
      gameOver: false,
      cinematicHidden: false,
      hasConfiguredSlots: true,
      isHovered: true,
      activeUntilMs: 0,
      nowMs: 5000,
    });
    expect(hoveredState.tier).toBe('active');
    expect(hoveredState.opacity).toBeGreaterThan(configuredIdle.opacity);

    const hiddenWhenTabOpen = computeShortcutsHubState({
      inventoryOpen: true,
      gameOver: false,
      cinematicHidden: false,
      hasConfiguredSlots: true,
      isHovered: true,
      activeUntilMs: 9999,
      nowMs: 1000,
    });
    expect(hiddenWhenTabOpen.tier).toBe('hidden');
    expect(hiddenWhenTabOpen.opacity).toBe(0);
  });

  it('escala paredes e contorna quinas de 90° sem jamais travar no ar nem apoiar garras no vazio', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const { colliders } = buildDoomLabyrinth(scene, textures, shared);
    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;
    const webs = new DoomSpiderWebManager(scene, shared);
    const spider = new DoomSpider(scene, shared, colliders, webs, mockSound);

    const spiderInternal = spider as unknown as {
      placeAtCell: (
        wx: number,
        wz: number,
        mode: 'FLOOR' | 'WALL' | 'CEILING'
      ) => void;
      buildGridPathTo: (tx: number, tz: number) => void;
      surfaceMode: 'FLOOR' | 'WALL' | 'CEILING';
      surfaceDecisionTimer: number;
      webCooldownTimer: number;
      limbs: Array<{
        stepping: boolean;
        footWorld: THREE.Vector3;
      }>;
    };

    const isFootOnPhysicalSurface = (foot: THREE.Vector3): boolean => {
      // Piso ou teto reais
      if (foot.y <= 0.09 || foot.y >= WALL_HEIGHT - 0.09) return true;
      // Ou encostada na face de algum bloco sólido de parede real!
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i].box;
        if (foot.y < b.min.y - 0.08 || foot.y > b.max.y + 0.08) continue;
        const dx = Math.max(b.min.x - foot.x, 0, foot.x - b.max.x);
        const dz = Math.max(b.min.z - foot.z, 0, foot.z - b.max.z);
        if (Math.hypot(dx, dz) <= 0.12) return true;
      }
      return false;
    };

    // Encontra um corredor com curvas em L reais no mapa para testar escalada em parede + quina de 90°
    const findOpenCellNear = (cgx: number, cgz: number) => {
      for (let r = 0; r <= 4; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const gx = cgx + dx;
            const gz = cgz + dz;
            if (!isSolidCell(LABYRINTH_MAP, gx, gz)) {
              return gridCellToWorld(gx, gz);
            }
          }
        }
      }
      return gridCellToWorld(1, 1);
    };

    const startCell = findOpenCellNear(1, 1);
    const goalCell = findOpenCellNear(15, 11);
    spiderInternal.placeAtCell(startCell.x, startCell.z, 'FLOOR');
    spiderInternal.buildGridPathTo(goalCell.x, goalCell.z);
    spiderInternal.surfaceMode = 'WALL';
    spiderInternal.surfaceDecisionTimer = 999;
    spiderInternal.webCooldownTimer = 999;

    const farPlayer = new THREE.Vector3(999, 1.7, 999);
    const flashDir = new THREE.Vector3(0, 0, -1);
    const dt = 1 / 60;
    let elapsed = 0;
    let cumulativeTravel = 0;
    const prevPos = spider.position.clone();
    let windowTravel = 0;

    for (let step = 0; step < 900; step++) {
      elapsed += dt;
      // Força tentativa recorrente de escalar parede a cada 1.2s (inclusive bem em cima de curvas e cruzamentos!)
      if (step % 72 === 0) {
        spiderInternal.surfaceMode = 'WALL';
      }
      spiderInternal.surfaceDecisionTimer = 999;
      spiderInternal.webCooldownTimer = 999;

      spider.update(
        dt,
        elapsed,
        farPlayer,
        0,
        false,
        false,
        false,
        flashDir,
        [],
        () => {}
      );

      const dStep = Math.hypot(
        spider.position.x - prevPos.x,
        spider.position.z - prevPos.z
      );
      cumulativeTravel += dStep;
      windowTravel += dStep;
      prevPos.copy(spider.position);

      // A cada 1 segundo (60 frames), enquanto ainda não chegou ao destino, garante avanço real (nunca presa no ar!)
      if ((step + 1) % 60 === 0) {
        const distToGoal = Math.hypot(
          spider.position.x - goalCell.x,
          spider.position.z - goalCell.z
        );
        if (distToGoal > 1.2) {
          expect(windowTravel).toBeGreaterThan(0.45);
        }
        windowTravel = 0;
      }

      // Garante que TODA pata plantada toca chão, teto ou face real de parede (jamais suspensa no ar do corredor!)
      for (const limb of spiderInternal.limbs) {
        if (!limb.stepping) {
          expect(isFootOnPhysicalSurface(limb.footWorld)).toBe(true);
        }
      }
    }

    expect(cumulativeTravel).toBeGreaterThan(14.0);
  });

  it('expõe a opção MULTIPLAYER no menu principal e suporta salas públicas, privadas com senha, salas ocultas da lista e entrada por número da sala', async () => {
    expect(TITLE_MENU_ITEMS).toEqual(['INICIAR', 'MULTIPLAYER', 'SAIR']);

    expect(normalizeRoomCode('#482-910')).toBe('482910');
    expect(normalizeRoomCode('https://out-of-frame-tan.vercel.app/?room=739-104')).toBe(
      '739104'
    );
    expect(formatRoomCodeDisplay('482910')).toBe('482-910');

    clearLocalMirrorRoomsForTests();
    const lobby = new MultiplayerLobbyService({ forceLocalOnly: true });

    // 1. Sala Pública Aberta (aparece na lista pública, entra direto)
    const pubOpen = await lobby.createRoom(
      { roomName: 'Servidor Público Alfa', isListed: true, maxPlayers: 4 },
      { id: 'host-a', name: 'Rhuan' }
    );
    expect(pubOpen.roomCode).toHaveLength(6);
    expect(pubOpen.isListed).toBe(true);
    expect(pubOpen.hasPassword).toBe(false);

    // 2. Sala Pública com Senha (aparece na lista pública com cadeado, exige senha)
    const pubLocked = await lobby.createRoom(
      {
        roomName: 'Servidor Público Com Senha',
        isListed: true,
        password: '4321',
        maxPlayers: 3,
      },
      { id: 'host-b', name: 'Carla' }
    );
    expect(pubLocked.isListed).toBe(true);
    expect(pubLocked.hasPassword).toBe(true);

    // 3. Sala Oculta com Senha (NÃO aparece na lista pública — apenas pelo Número da Sala + Senha!)
    const hiddenLocked = await lobby.createRoom(
      {
        roomName: 'Esquadrão Secreto',
        isListed: false,
        password: 'omega',
        maxPlayers: 2,
      },
      { id: 'host-c', name: 'Vitor' }
    );
    expect(hiddenLocked.isListed).toBe(false);
    expect(hiddenLocked.hasPassword).toBe(true);

    // Verifica que apenas as salas marcadas para listagem aparecem na aba pública
    const publicList = await lobby.listPublicRooms();
    const listedCodes = publicList.map((r) => r.roomCode);
    expect(listedCodes).toContain(pubOpen.roomCode);
    expect(listedCodes).toContain(pubLocked.roomCode);
    expect(listedCodes).not.toContain(hiddenLocked.roomCode);

    // Entrada direta em sala pública aberta funciona imediatamente
    const joinOpen = await lobby.joinRoom(pubOpen.roomCode, undefined, {
      id: 'guest-1',
      name: 'Lucas',
    });
    expect(joinOpen.ok).toBe(true);
    expect(joinOpen.session?.playerCount).toBe(2);

    // Entrada pelo Número da Sala em sala oculta com senha:
    // Passo 1: inspeciona pelo número -> encontra a sala e detecta que exige senha!
    const inspectedHidden = await lobby.inspectRoomByCode(
      formatRoomCodeDisplay(hiddenLocked.roomCode)
    );
    expect(inspectedHidden.found).toBe(true);
    expect(inspectedHidden.isListed).toBe(false);
    expect(inspectedHidden.hasPassword).toBe(true);

    // Passo 2: tentar sem senha solicita senha; senha incorreta bloqueia; senha certa entra com sucesso!
    const missingPw = await lobby.joinRoom(hiddenLocked.roomCode, '', {
      id: 'guest-2',
      name: 'Ana',
    });
    expect(missingPw.ok).toBe(false);
    expect(missingPw.errorCode).toBe('PASSWORD_REQUIRED');

    const wrongPw = await lobby.joinRoom(hiddenLocked.roomCode, 'errada', {
      id: 'guest-2',
      name: 'Ana',
    });
    expect(wrongPw.ok).toBe(false);
    expect(wrongPw.errorCode).toBe('WRONG_PASSWORD');

    const rightPw = await lobby.joinRoom(hiddenLocked.roomCode, 'omega', {
      id: 'guest-2',
      name: 'Ana',
    });
    expect(rightPw.ok).toBe(true);
    expect(rightPw.session?.roomCode).toBe(hiddenLocked.roomCode);
    expect(rightPw.session?.playerCount).toBe(2);

    // Capacidade máxima respeitada (2/2 lotada para um 3º jogador)
    const thirdTry = await lobby.joinRoom(hiddenLocked.roomCode, 'omega', {
      id: 'guest-3',
      name: 'Pedro',
    });
    expect(thirdTry.ok).toBe(false);
    expect(thirdTry.errorCode).toBe('ROOM_FULL');
  });

  it('renderiza Astronautas aliados em 3ª pessoa completa e sincroniza estado de rede da Aranha Gigante', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const { colliders } = buildDoomLabyrinth(scene, textures, shared);

    const ally = new DoomAstronaut(scene, shared);
    ally.updateThirdPersonAlly(
      new THREE.Vector3(3, 0, -6),
      Math.PI * 0.25,
      -0.2,
      1.8,
      4.5,
      0,
      true,
      false
    );
    expect(ally.isFirstPersonMode).toBe(false);

    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;
    const webs = new DoomSpiderWebManager(scene, shared);
    const hostSpider = new DoomSpider(scene, shared, colliders, webs, mockSound);
    const guestSpider = new DoomSpider(scene, shared, colliders, webs, mockSound);

    const snap = hostSpider.getNetworkSnapshot();
    const guestOut = guestSpider.applyRemoteNetworkState(
      1 / 60,
      1.0,
      snap,
      new THREE.Vector3(25, 0, 25),
      0,
      () => {}
    );
    expect(guestOut.playerDistance).toBeGreaterThan(0);
    expect(guestSpider.currentSurfaceMode).toBe(snap.surfaceMode);
  });

  it('desliza pelo chão ao correr e segurar Ctrl, desacelerando até agachar furtivamente', () => {
    const slideState = createInitialSlideState();
    const dt = 1 / 60;

    // 1. Jogador está correndo para frente (Shift + W) a ~9.1 m/s
    const sprintFrame = stepPlayerSlideState(slideState, {
      dt,
      holdingCtrl: false,
      holdingShift: true,
      wishX: 0,
      wishZ: -1,
      forwardX: 0,
      forwardZ: -1,
      velX: 0,
      velZ: -9.1,
      canStandUp: true,
      ensnared: false,
      injurySlow: 1,
      webSpeedMultiplier: 1,
    });
    expect(sprintFrame.isSliding).toBe(false);
    expect(sprintFrame.sprinting).toBe(true);

    // 2. Pressiona e segura Ctrl durante a corrida -> inicia deslize com impulso rápido (> 10.5 m/s)!
    const slideStart = stepPlayerSlideState(slideState, {
      dt,
      holdingCtrl: true,
      holdingShift: true,
      wishX: 0,
      wishZ: -1,
      forwardX: 0,
      forwardZ: -1,
      velX: 0,
      velZ: -9.1,
      canStandUp: true,
      ensnared: false,
      injurySlow: 1,
      webSpeedMultiplier: 1,
    });
    expect(slideStart.startedSlide).toBe(true);
    expect(slideStart.isSliding).toBe(true);
    expect(slideStart.overrideVelocity).toBe(true);
    const initialSlideSpeed = Math.hypot(
      slideStart.outVelX,
      slideStart.outVelZ
    );
    expect(initialSlideSpeed).toBeGreaterThan(10.5);

    // 3. Mantém Ctrl segurado durante o deslize -> desliza desacelerando até transicionar suavemente para agachado
    let vx = slideStart.outVelX;
    let vz = slideStart.outVelZ;
    let totalSlideDist = 0;
    let lastRes = slideStart;
    for (let i = 0; i < 65; i++) {
      lastRes = stepPlayerSlideState(slideState, {
        dt,
        holdingCtrl: true,
        holdingShift: true,
        wishX: 0,
        wishZ: -1,
        forwardX: 0,
        forwardZ: -1,
        velX: vx,
        velZ: vz,
        canStandUp: true,
        ensnared: false,
        injurySlow: 1,
        webSpeedMultiplier: 1,
      });
      if (lastRes.overrideVelocity) {
        vx = lastRes.outVelX;
        vz = lastRes.outVelZ;
        totalSlideDist += Math.hypot(vx, vz) * dt;
      }
    }

    // Deslizou vários metros pelo piso e agora está agachado sem reiniciar deslizes infinitos!
    expect(totalSlideDist).toBeGreaterThan(4.5);
    expect(lastRes.isSliding).toBe(false);
    expect(lastRes.isCrouching).toBe(true);
    expect(lastRes.startedSlide).toBe(false);
  });

  it('permite fugir correndo da aranha, quebrar a linha de visão direta e se esconder enquanto a aranha continua correndo e procurando', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const { colliders } = buildDoomLabyrinth(scene, textures, shared);
    const webs = new DoomSpiderWebManager(scene, shared);
    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;

    const spider = new DoomSpider(scene, shared, colliders, webs, mockSound);
    const spiderInternal = spider as unknown as {
      placeAtCell: (
        wx: number,
        wz: number,
        mode: 'FLOOR' | 'WALL' | 'CEILING'
      ) => void;
    };

    // Encontra um cruzamento em L (célula A -> esquina B -> esconderijo C atrás de parede sólida entre A e C!)
    let cellA = gridCellToWorld(1, 1);
    let cornerB = gridCellToWorld(2, 1);
    let hideC = gridCellToWorld(2, 2);
    let foundCorner = false;

    for (let gz = 2; gz < LABYRINTH_MAP.length - 4 && !foundCorner; gz++) {
      for (let gx = 2; gx < LABYRINTH_MAP[gz].length - 4 && !foundCorner; gx++) {
        // Corredor horizontal (gx-2, gz) -> (gx, gz) que dobra para (gx, gz+2) e recua num nicho lateral sem visão direta de cornerB!
        if (
          !isSolidCell(LABYRINTH_MAP, gx - 2, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx - 1, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx, gz + 1) &&
          !isSolidCell(LABYRINTH_MAP, gx, gz + 2) &&
          isSolidCell(LABYRINTH_MAP, gx - 1, gz + 1)
        ) {
          cellA = gridCellToWorld(gx - 2, gz);
          cornerB = gridCellToWorld(gx, gz);
          // Escolhe um esconderijo oculto a várias esquinas de distância (sem visão direta de A nem B, provando que a aranha não tem wallhack!)
          for (let hz = LABYRINTH_MAP.length - 3; hz >= 2 && !foundCorner; hz--) {
            for (
              let hx = LABYRINTH_MAP[hz].length - 3;
              hx >= 2 && !foundCorner;
              hx--
            ) {
              if (
                !isSolidCell(LABYRINTH_MAP, hx, hz) &&
                hx !== gx &&
                hz !== gz &&
                Math.abs(hx - gx) + Math.abs(hz - gz) >= 10
              ) {
                hideC = gridCellToWorld(hx, hz);
                foundCorner = true;
              }
            }
          }
        }
      }
    }
    expect(foundCorner).toBe(true);

    // 1. Aranha inicia perseguição (FRENZY_CHASE) rumo à esquina onde viu o jogador por último
    spiderInternal.placeAtCell(cellA.x, cellA.z, 'FLOOR');
    spider.alertToWebTrap(
      new THREE.Vector3(cornerB.x, 0, cornerB.z),
      new THREE.Vector3(cornerB.x, 0, cornerB.z)
    );
    expect(spider.currentState).toBe('FRENZY_CHASE');

    // 2. O jogador já dobrou a esquina e parou de correr, escondido e agachado em hideC (sem visão direta e lanterna apagada!)
    const hiddenPlayerPos = new THREE.Vector3(hideC.x, 0, hideC.z);
    let caughtHiddenPlayer = false;
    let enteredSearchMode = false;
    let searchTravelDist = 0;
    const prevPos = spider.position.clone();
    const dt = 1 / 60;

    for (let step = 0; step < 210; step++) {
      spider.update(
        dt,
        step * dt,
        hiddenPlayerPos,
        0,
        false, // parou de correr!
        true, // agachado escondido!
        false, // lanterna apagada!
        new THREE.Vector3(0, 0, 1),
        [],
        () => {
          caughtHiddenPlayer = true;
        }
      );

      const dMoved = Math.hypot(
        spider.position.x - prevPos.x,
        spider.position.z - prevPos.z
      );
      if (spider.isSearchingHiddenPlayer) {
        enteredSearchMode = true;
        searchTravelDist += dMoved;
      }
      prevPos.copy(spider.position);
    }

    // A aranha chega ao último ponto avistado (cornerB), entra em modo de busca ativa e continua correndo procurando!
    expect(enteredSearchMode).toBe(true);
    expect(searchTravelDist).toBeGreaterThan(2.5);
    expect(caughtHiddenPlayer).toBe(false);
  });

  it('sincroniza o brilho emissivo dos painéis de LED (arandelas e plafons) com a piscada de luz do ambiente', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const built = buildDoomLabyrinth(scene, textures, shared);

    expect(built.lightPanelEmissionAttr).not.toBeNull();
    const attr = built.lightPanelEmissionAttr!;
    const lightPanelsMesh = scene.getObjectByName(
      'MazeLightPanels'
    ) as THREE.Mesh;
    expect(lightPanelsMesh).toBeDefined();
    const shaderMat = lightPanelsMesh.material as THREE.ShaderMaterial;
    expect(shaderMat.uniforms.uUseVertexEmission.value).toBe(1);
    expect(lightPanelsMesh.geometry.getAttribute('aLightEmission')).toBe(attr);

    // Mapeamento exato 1-para-1 entre todas as luzes e todos os vértices dos painéis de LED
    let cursor = 0;
    for (const src of built.lights) {
      expect(src.panelVertexStart).toBe(cursor);
      expect(src.panelVertexCount).toBeGreaterThanOrEqual(4);
      cursor += src.panelVertexCount;
    }
    expect(cursor).toBe(attr.count);

    const flickeringLight = built.lights.find((l) => l.flicker)!;
    const steadyLight = built.lights.find((l) => !l.flicker)!;
    expect(flickeringLight).toBeDefined();
    expect(steadyLight).toBeDefined();

    let sawBlackout = false;
    let sawSputter = false;
    let sawFullBright = false;

    for (let tick = 0; tick < 240; tick++) {
      const t = tick / 12 + 0.01;
      const flickSample = evaluateDoomLightFlicker(flickeringLight, t);
      const steadySample = evaluateDoomLightFlicker(steadyLight, t);

      expect(steadySample.intensity).toBe(steadyLight.baseIntensity);
      expect(steadySample.panelEmission).toBe(1.0);

      syncLightPanelEmissionAttribute(
        attr,
        flickeringLight,
        flickSample.panelEmission
      );
      syncLightPanelEmissionAttribute(
        attr,
        steadyLight,
        steadySample.panelEmission
      );

      // Sempre que a luz do ambiente cai, o painel de LED apaga/enfraquece exatamente junto!
      if (flickSample.intensity < flickeringLight.baseIntensity * 0.1) {
        sawBlackout = true;
        expect(flickSample.panelEmission).toBeLessThanOrEqual(0.05);
      } else if (flickSample.intensity < flickeringLight.baseIntensity * 0.5) {
        sawSputter = true;
        expect(flickSample.panelEmission).toBeLessThan(0.4);
      } else if (flickSample.intensity === flickeringLight.baseIntensity) {
        sawFullBright = true;
        expect(flickSample.panelEmission).toBe(1.0);
      }

      for (
        let v = flickeringLight.panelVertexStart;
        v < flickeringLight.panelVertexStart + flickeringLight.panelVertexCount;
        v++
      ) {
        expect(attr.getX(v)).toBeCloseTo(flickSample.panelEmission, 4);
      }
      for (
        let v = steadyLight.panelVertexStart;
        v < steadyLight.panelVertexStart + steadyLight.panelVertexCount;
        v++
      ) {
        expect(attr.getX(v)).toBeCloseTo(1.0, 4);
      }
    }

    expect(sawBlackout).toBe(true);
    expect(sawSputter).toBe(true);
    expect(sawFullBright).toBe(true);
  });

  it('mantém a lanterna 100% sólida e opaca tanto em 1ª pessoa quanto empunhada na mão direita em 3ª pessoa (Co-op)', () => {
    // 1) Lanterna de 1ª pessoa totalmente opaca (zero malhas transparentes visíveis quando equipada)
    const fpFlashlight = new DoomFlashlight(16 / 10);
    fpFlashlight.toggle();
    for (let i = 0; i < 45; i++) {
      fpFlashlight.update(1 / 60, 0, 0, () => {}, 0, 100, 0);
    }

    const isVisibleChain = (obj: THREE.Object3D): boolean => {
      let cur: THREE.Object3D | null = obj;
      while (cur) {
        if (!cur.visible) return false;
        cur = cur.parent;
      }
      return true;
    };

    let visibleTransparentMeshes = 0;
    fpFlashlight.viewScene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && isVisibleChain(obj)) {
        const mat = (obj as THREE.Mesh).material as THREE.Material;
        if (mat?.transparent) {
          visibleTransparentMeshes++;
        }
      }
    });
    expect(visibleTransparentMeshes).toBe(0);

    // 2) Lanterna sólida 3D acoplada na mão direita do aliado em 3ª pessoa (Co-op)
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const allyAstronaut = new DoomAstronaut(scene, shared);

    allyAstronaut.updateThirdPersonAlly(
      new THREE.Vector3(2, 0, -4),
      0,
      0,
      0,
      0,
      0,
      true,
      false
    );

    expect(allyAstronaut.thirdPersonFlashlightGroup.visible).toBe(true);
    expect(
      allyAstronaut.thirdPersonFlashlightGroup.children.length
    ).toBeGreaterThanOrEqual(6);
    expect(allyAstronaut.thirdPersonFlashlightGroup.parent).toBe(
      allyAstronaut.rightArm.gripSocket
    );

    let tpTransparentMeshes = 0;
    allyAstronaut.thirdPersonFlashlightGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mat = (obj as THREE.Mesh).material as THREE.Material;
        if (mat?.transparent) {
          tpTransparentMeshes++;
        }
      }
    });
    expect(tpTransparentMeshes).toBe(0);

    const muzzlePos = new THREE.Vector3();
    const muzzleDir = new THREE.Vector3();
    expect(
      allyAstronaut.getThirdPersonFlashlightMuzzleWorld(muzzlePos, muzzleDir)
    ).toBe(true);
    // Com yaw = 0 e pitch = 0, o bocal da lanterna sólida aponta diretamente para frente (-Z)
    expect(muzzleDir.z).toBeLessThan(-0.96);
    expect(Math.abs(muzzleDir.x)).toBeLessThan(0.12);
    expect(Math.abs(muzzleDir.y)).toBeLessThan(0.12);

    // Ao desligar a lanterna, o modelo 3D em 3ª pessoa e o bocal ficam inativos
    allyAstronaut.updateThirdPersonAlly(
      new THREE.Vector3(2, 0, -4),
      0,
      0,
      0,
      0,
      0,
      false,
      false
    );
    expect(allyAstronaut.thirdPersonFlashlightGroup.visible).toBe(false);
    expect(
      allyAstronaut.getThirdPersonFlashlightMuzzleWorld(muzzlePos, muzzleDir)
    ).toBe(false);
  });

  it('mantém jogadores inativos dentro da partida sem desconectá-los e sincroniza o estado/ícone AFK', async () => {
    // 1) Detecção pura de estado AFK (tempo ocioso ou aba minimizada)
    expect(isPlayerConsideredAfk(0, false, 0)).toBe(false);
    expect(isPlayerConsideredAfk(AFK_IDLE_TIMEOUT_MS - 1, false, 0)).toBe(false);
    expect(isPlayerConsideredAfk(AFK_IDLE_TIMEOUT_MS, false, 0)).toBe(true);
    expect(isPlayerConsideredAfk(500, true, AFK_HIDDEN_GRACE_MS - 100)).toBe(
      false
    );
    expect(isPlayerConsideredAfk(500, true, AFK_HIDDEN_GRACE_MS)).toBe(true);
    // Ao retomar atividade com aba visível, sai de AFK imediatamente
    expect(isPlayerConsideredAfk(0, false, 0)).toBe(false);

    // 2) Sala mantém operadores ausentes conectados e propaga status AFK em tempo real
    clearLocalMirrorRoomsForTests();
    const lobby = new MultiplayerLobbyService({ forceLocalOnly: true });
    const hostSession = await lobby.createRoom(
      { roomName: 'Setor AFK Seguro', isListed: true, maxPlayers: 4 },
      { id: 'astro-host-afk', name: 'HOST-ALFA' }
    );
    const guestJoin = await lobby.joinRoom(
      hostSession.roomCode,
      undefined,
      { id: 'astro-guest-afk', name: 'OPERADOR-AUSENTE' }
    );
    expect(guestJoin.ok).toBe(true);
    expect(guestJoin.session).toBeDefined();

    const receivedPoses: NetworkPlayerPosePacket[] = [];
    const hostClient = new MultiplayerRoomClient(
      hostSession,
      {
        onRemotePlayerPose: (pkt) => receivedPoses.push(pkt),
        onRemotePlayerLeft: () => {},
        onSpiderSync: () => {},
        onWorldEvent: () => {},
        onRosterUpdated: () => {},
      },
      true
    );
    const guestClient = new MultiplayerRoomClient(
      guestJoin.session!,
      {
        onRemotePlayerPose: () => {},
        onRemotePlayerLeft: () => {},
        onSpiderSync: () => {},
        onWorldEvent: () => {},
        onRosterUpdated: () => {},
      },
      true
    );

    hostClient.connect();
    guestClient.connect();

    guestClient.broadcastPlayerPose({
      x: 4,
      y: 0,
      z: -6,
      yaw: 0,
      pitch: 0,
      speed: 3.2,
      bobPhase: 1,
      crouch: 0,
      flashlightOn: true,
      flashDirX: 0,
      flashDirY: 0,
      flashDirZ: -1,
      health: 100,
      bleeding: false,
      ensnared: false,
      inSequence: false,
      dead: false,
      afk: false,
    });

    // Entra em modo AFK -> continua na sala, velocidade zera e pacote propaga afk=true!
    guestClient.setLocalAfk(true);
    expect(guestClient.isLocalAfk).toBe(true);

    await new Promise((r) => setTimeout(r, 35));

    if (typeof BroadcastChannel !== 'undefined') {
      expect(receivedPoses.some((p) => p.afk === true && p.speed === 0)).toBe(
        true
      );
    }

    const inspectedAfk = await lobby.inspectRoomByCode(hostSession.roomCode);
    expect(inspectedAfk.found).toBe(true);
    expect(inspectedAfk.playerCount).toBe(2);
    const guestSummary = inspectedAfk.playersSummary?.find(
      (p) => p.id === 'astro-guest-afk'
    );
    expect(guestSummary).toBeDefined();
    expect(guestSummary?.status).toBe('AFK');

    // Retorna da ausência -> sai de AFK sem jamais ter sido desconectado
    guestClient.setLocalAfk(false);
    expect(guestClient.isLocalAfk).toBe(false);
    const inspectedBack = await lobby.inspectRoomByCode(hostSession.roomCode);
    expect(inspectedBack.playerCount).toBe(2);
    expect(
      inspectedBack.playersSummary?.find((p) => p.id === 'astro-guest-afk')
        ?.status
    ).toBe('ONLINE');

    guestClient.disconnect();
    hostClient.disconnect();
  });

  it('sincroniza a Aranha em Multiplayer (perseguição multi-jogador, arrasto em 3ª pessoa, armadilhas de teia e resgate com sinalizador/faca)', async () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const built = buildDoomLabyrinth(scene, textures, shared);
    const webs = new DoomSpiderWebManager(scene, shared);
    const sound = {
      playSpiderStep: () => {},
      playSpiderHiss: () => {},
      playSpiderScream: () => {},
      playSpiderStrike: () => {},
      playSpiderDragPull: () => {},
      playSpiderWebSpin: () => {},
      playWebTrapSnap: () => {},
      playItemUse: () => {},
    } as unknown as SoundEngine;

    const hostSpider = new DoomSpider(
      scene,
      shared,
      built.colliders,
      webs,
      sound
    );
    const guestScene = new THREE.Scene();
    const guestShared = createDoomSharedUniforms();
    const guestWebs = new DoomSpiderWebManager(guestScene, guestShared);
    const guestSpider = new DoomSpider(
      guestScene,
      guestShared,
      built.colliders,
      guestWebs,
      sound
    );

    // 1) Seleção inteligente de alvo multi-jogador: Host furtivo atrás de parede vs Convidado correndo de lanterna acesa perto da aranha!
    const nearSpiderCell = worldToGridCell(
      hostSpider.position.x,
      hostSpider.position.z
    );
    const hostPos =
      nearSpiderCell.gx < 14
        ? gridCellToWorld(25, 1)
        : gridCellToWorld(2, 13);
    const guestPos = gridCellToWorld(nearSpiderCell.gx, nearSpiderCell.gz);

    const selected = hostSpider.selectBestMultiplayerCandidate([
      {
        id: 'host-stealth',
        isLocal: true,
        pos: new THREE.Vector3(hostPos.x, 0, hostPos.z),
        yaw: 0,
        sprinting: false,
        crouching: true,
        flashlightOn: false,
        flashlightDir: new THREE.Vector3(0, 0, -1),
        ensnared: false,
        afk: false,
      },
      {
        id: 'guest-runner',
        isLocal: false,
        pos: new THREE.Vector3(guestPos.x, 0, guestPos.z),
        yaw: 0,
        sprinting: true,
        crouching: false,
        flashlightOn: true,
        flashlightDir: new THREE.Vector3(0, 0, -1),
        ensnared: false,
        afk: false,
      },
    ]);
    expect(selected.id).toBe('guest-runner');
    expect(selected.isLocal).toBe(false);

    // 2) Sincronização de cena cinemática (sequestro / arrasto) do Host para o Cliente e postura deitado + casulo no Astronauta 3D!
    const dragVictimPos = webs.dragCorridorStart
      .clone()
      .lerp(webs.lairCenter, 0.45);
    const dragSpiderPos = new THREE.Vector3(
      dragVictimPos.x,
      1.38,
      dragVictimPos.z + 2.15
    );
    hostSpider.updateCinematicSequence(
      0.016,
      4.0,
      'DRAGGING_TO_WEB',
      0.45,
      dragSpiderPos,
      dragVictimPos,
      dragVictimPos
    );

    const snap = hostSpider.getNetworkSnapshot('guest-runner');
    expect(snap.state).toBe('CINEMATIC_SEQUENCE');
    expect(snap.cinematicMode).toBe('DRAGGING_TO_WEB');
    expect(snap.victimId).toBe('guest-runner');

    guestSpider.applyRemoteNetworkState(
      0.016,
      4.0,
      snap,
      new THREE.Vector3(hostPos.x, 0, hostPos.z),
      0,
      () => {}
    );
    expect(guestSpider.currentState).toBe('CINEMATIC_SEQUENCE');
    expect(guestSpider.position.distanceTo(dragSpiderPos)).toBeLessThan(0.25);

    // Astronauta aliado sendo arrastado deitado no chão + casulo de teia 3D visível!
    const allyAstro = new DoomAstronaut(guestScene, guestShared);
    allyAstro.updateThirdPersonAlly(
      dragVictimPos,
      0,
      0,
      1.2,
      0,
      0,
      false,
      true,
      false,
      true
    );
    const cocoonGroup = allyAstro.root.getObjectByName(
      'AstronautThirdPersonWebCocoon'
    );
    expect(cocoonGroup?.visible).toBe(true);
    const bodyPivot = allyAstro.root.children[0];
    expect(Math.abs(bodyPivot.rotation.x)).toBeGreaterThan(1.2);
    expect(bodyPivot.position.y).toBeLessThan(-0.5);

    // 3) Resgate Cooperativo! Um aliado joga Sinalizador / usa Faca perto da Aranha durante o arrasto ->
    //    Aranha solta o amigo na hora, entra em FLEE_RETREAT e o cliente remoto acompanha suavemente!
    const rescuerPos = dragSpiderPos.clone().add(new THREE.Vector3(0, 0, -1.6));
    hostSpider.interruptAbductionAndFlee(rescuerPos);
    expect(hostSpider.currentState).toBe('FLEE_RETREAT');

    const fleeSnap = hostSpider.getNetworkSnapshot(null);
    expect(fleeSnap.state).toBe('FLEE_RETREAT');
    expect(fleeSnap.cinematicMode).toBeNull();

    guestSpider.applyRemoteNetworkState(
      0.016,
      4.05,
      fleeSnap,
      rescuerPos,
      0,
      () => {}
    );
    expect(guestSpider.currentState).toBe('FLEE_RETREAT');

    // Aliado resgatado volta imediatamente a ficar de pé e sem casulo de teia!
    allyAstro.updateThirdPersonAlly(
      dragVictimPos,
      0,
      0,
      1.5,
      0,
      0,
      true,
      false,
      false,
      false
    );
    expect(bodyPivot.rotation.x).toBe(0);
    expect(cocoonGroup?.visible).toBe(false);

    // 4) Sincronização de armadilha de teia cortada por faca entre clientes (`cutTrapPos` + `collapseTrapNearWorld`)
    const trapCell = gridCellToWorld(7, 3);
    webs.spawnWebTrap(trapCell.x, trapCell.z, false);
    guestWebs.spawnWebTrap(trapCell.x, trapCell.z, false);

    const knifeRes = webs.slashWebWithKnife(
      new THREE.Vector3(trapCell.x, 1.72, trapCell.z + 1.2),
      new THREE.Vector3(0, 0, -1),
      sound
    );
    expect(knifeRes.cutNearbyTrap).toBe(true);
    expect(knifeRes.cutTrapPos).toBeDefined();

    const collapsedOnGuest = guestWebs.collapseTrapNearWorld(
      knifeRes.cutTrapPos!.x,
      knifeRes.cutTrapPos!.z
    );
    expect(collapsedOnGuest).toBe(true);
  });

  it('remove imediatamente jogadores que saem da partida (desconexão explícita, fechamento de aba ou sessão órfã) sem deixar jogadores fantasmas na lista', async () => {
    clearLocalMirrorRoomsForTests();
    const lobby = new MultiplayerLobbyService({ forceLocalOnly: true });

    const hostSession = await lobby.createRoom(
      { roomName: 'Setor Sem Fantasmas', isListed: true, maxPlayers: 4 },
      { id: 'astro-host-clean', name: 'HOST-REAL' }
    );
    const guestJoin = await lobby.joinRoom(
      hostSession.roomCode,
      undefined,
      { id: 'astro-guest-leaving', name: 'CONVIDADO-SAINDO' }
    );
    expect(guestJoin.ok).toBe(true);

    const leftIds: string[] = [];
    let latestRosterIds: string[] = [];

    const hostClient = new MultiplayerRoomClient(
      hostSession,
      {
        onRemotePlayerPose: () => {},
        onRemotePlayerLeft: (id) => leftIds.push(id),
        onSpiderSync: () => {},
        onWorldEvent: () => {},
        onRosterUpdated: (players) => {
          latestRosterIds = players.map((p) => p.id);
        },
      },
      true
    );
    const guestClient = new MultiplayerRoomClient(
      guestJoin.session!,
      {
        onRemotePlayerPose: () => {},
        onRemotePlayerLeft: () => {},
        onSpiderSync: () => {},
        onWorldEvent: () => {},
        onRosterUpdated: () => {},
      },
      true
    );

    hostClient.connect();
    guestClient.connect();
    await new Promise((r) => setTimeout(r, 35));

    // Antes de sair: 2 jogadores na sala
    const beforeLeave = await lobby.inspectRoomByCode(hostSession.roomCode);
    expect(beforeLeave.found).toBe(true);
    expect(beforeLeave.playerCount).toBe(2);

    // 1) Convidado sai do jogo -> removido imediatamente da lista de jogadores do Host e do diretório da sala!
    guestClient.disconnect(true);
    await new Promise((r) => setTimeout(r, 35));

    if (typeof BroadcastChannel !== 'undefined') {
      expect(leftIds).toContain('astro-guest-leaving');
      expect(latestRosterIds).not.toContain('astro-guest-leaving');
    }

    const afterGuestLeft = await lobby.inspectRoomByCode(hostSession.roomCode);
    expect(afterGuestLeft.found).toBe(true);
    expect(afterGuestLeft.playerCount).toBe(1);
    expect(
      afterGuestLeft.playersSummary?.some((p) => p.id === 'astro-guest-leaving')
    ).toBe(false);

    const listedAfterGuest = await lobby.listPublicRooms();
    const listedRoom = listedAfterGuest.find(
      (r) => r.roomCode === hostSession.roomCode
    );
    expect(listedRoom?.playerCount).toBe(1);
    expect(
      listedRoom?.playersSummary.some((p) => p.id === 'astro-guest-leaving')
    ).toBe(false);

    // 2) Simula um segundo convidado cuja aba travou/fechou sem disparar disconnect(), enquanto o Host permanece com a aba aberta (mesmo em AFK!)
    const baseNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow);
    try {
      const ghostJoin = await lobby.joinRoom(
        hostSession.roomCode,
        undefined,
        { id: 'astro-crashed-tab', name: 'ABA-FECHADA' }
      );
      expect(ghostJoin.ok).toBe(true);

      // +20s: Host continua com a aba aberta (entra em AFK e envia heartbeat automático), mas ABA-FECHADA nunca mais enviou pulso!
      nowSpy.mockReturnValue(baseNow + 20_000);
      hostClient.setLocalAfk(true);
      await new Promise((r) => setTimeout(r, 25));

      // +43s: ABA-FECHADA ultrapassou STALE_HEARTBEAT_TTL_MS (40s) sem pulso, enquanto o Host tem pulso recente (23s atrás)!
      nowSpy.mockReturnValue(baseNow + STALE_HEARTBEAT_TTL_MS + 3_000);

      const afterGhostPruned = await lobby.inspectRoomByCode(
        hostSession.roomCode
      );
      expect(afterGhostPruned.found).toBe(true);
      expect(afterGhostPruned.playerCount).toBe(1);
      expect(
        afterGhostPruned.playersSummary?.some(
          (p) => p.id === 'astro-crashed-tab'
        )
      ).toBe(false);
      expect(
        afterGhostPruned.playersSummary?.some(
          (p) => p.id === 'astro-host-clean'
        )
      ).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }

    // 3) Quando o último jogador (Host) sai, a sala inteira fecha sem sobrar fantasma!
    hostClient.disconnect();
    const afterAllLeft = await lobby.inspectRoomByCode(hostSession.roomCode);
    expect(afterAllLeft.found).toBe(false);
  });

  it('suporta Microfone por Distância (atenuação espacial, oclusão por paredes, Push-to-Talk [B] padrão, codec fallback e audição da Aranha)', () => {
    // 1) Curva acústica por distância + abafamento de paredes no labirinto
    const closeClear = computeProximityVoiceAcousticParams(
      FULL_VOLUME_VOICE_DISTANCE * 0.6,
      0
    );
    expect(closeClear.audible).toBe(true);
    expect(closeClear.gain).toBeCloseTo(1.0, 4);
    expect(closeClear.lowpassHz).toBe(16_500);

    const midCorridor = computeProximityVoiceAcousticParams(11.0, 0);
    expect(midCorridor.audible).toBe(true);
    expect(midCorridor.gain).toBeGreaterThan(0.15);
    expect(midCorridor.gain).toBeLessThan(0.75);

    const throughOneWall = computeProximityVoiceAcousticParams(6.0, 1);
    const throughTwoWalls = computeProximityVoiceAcousticParams(6.0, 2);
    expect(throughOneWall.lowpassHz).toBe(1_900);
    expect(throughTwoWalls.lowpassHz).toBe(920);
    expect(throughTwoWalls.gain).toBeLessThan(throughOneWall.gain);

    const outOfRange = computeProximityVoiceAcousticParams(
      MAX_PROXIMITY_VOICE_DISTANCE + 1,
      0
    );
    expect(outOfRange.audible).toBe(false);
    expect(outOfRange.gain).toBe(0);

    // Contagem real de barreiras de parede entre duas células do mapa
    const cellA = gridCellToWorld(1, 1);
    const cellB = gridCellToWorld(15, 13);
    expect(countLabyrinthWallsBetween(cellA.x, cellA.z, cellA.x, cellA.z)).toBe(
      0
    );
    expect(
      countLabyrinthWallsBetween(cellA.x, cellA.z, cellB.x, cellB.z)
    ).toBeGreaterThan(0);

    // 2) Modo padrão Push-to-Talk [B] (`PTT`), alternância `[Z]` (`PTT` -> `OPEN` -> `MUTED`) e silêncio ao morrer
    const voiceMgr = new ProximityVoiceChatManager({
      localPlayerId: 'astro-local-mic',
      sendSignal: () => {},
      sendRelayChunk: () => {},
    });
    expect(voiceMgr.activationMode).toBe('PTT');
    expect(voiceMgr.isMicArmed).toBe(false);

    voiceMgr.setPushToTalkHeld(true);
    expect(voiceMgr.isMicArmed).toBe(true);
    voiceMgr.setPushToTalkHeld(false);
    expect(voiceMgr.isMicArmed).toBe(false);

    expect(voiceMgr.cycleVoiceMode()).toBe('OPEN');
    expect(voiceMgr.isMicArmed).toBe(true);
    expect(voiceMgr.cycleVoiceMode()).toBe('MUTED');
    expect(voiceMgr.isMicArmed).toBe(false);
    // Mesmo mutado, segurar [B] funciona como fala rápida de emergência!
    voiceMgr.setPushToTalkHeld(true);
    expect(voiceMgr.isMicArmed).toBe(true);
    voiceMgr.setPushToTalkHeld(false);
    expect(voiceMgr.cycleVoiceMode()).toBe('PTT');

    voiceMgr.setForceSilenced(true);
    voiceMgr.setPushToTalkHeld(true);
    expect(voiceMgr.isMicArmed).toBe(false);
    voiceMgr.destroy();

    // 3) Codec compacto G.711 μ-law (fallback universal entre abas / NAT simétrico)
    const testWave = new Float32Array(160);
    for (let i = 0; i < testWave.length; i++) {
      testWave[i] = Math.sin((i / testWave.length) * Math.PI * 4) * 0.65;
    }
    const b64 = encodePcmToMuLawBase64(testWave);
    const decoded = decodeMuLawBase64ToPcm(b64);
    expect(decoded.length).toBe(testWave.length);
    let maxErr = 0;
    for (let i = 0; i < testWave.length; i++) {
      maxErr = Math.max(maxErr, Math.abs(decoded[i] - testWave[i]));
    }
    expect(maxErr).toBeLessThan(0.06);

    // 4) Audição da Aranha Gigante por voz alta/grito no microfone (estilo Lethal Company)
    expect(computeSpiderVoiceHearingAlert(0.02, 4.0, 0, false).heard).toBe(
      false
    );
    // Sussurro baixo a 7m atrás de parede -> seguro!
    expect(computeSpiderVoiceHearingAlert(0.16, 7.0, 1, true).heard).toBe(
      false
    );
    // Grito / voz alta a 9m mesmo através de 1 parede -> a Aranha escuta!
    expect(computeSpiderVoiceHearingAlert(0.85, 9.0, 1, false).heard).toBe(
      true
    );

    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const built = buildDoomLabyrinth(scene, textures, shared);
    const webs = new DoomSpiderWebManager(scene, shared);
    const sound = {
      playSpiderStep: () => {},
      playSpiderHiss: () => {},
      playSpiderScream: () => {},
      playSpiderStrike: () => {},
      playSpiderDragPull: () => {},
      playSpiderWebSpin: () => {},
      playWebTrapSnap: () => {},
      playItemUse: () => {},
    } as unknown as SoundEngine;
    const spider = new DoomSpider(scene, shared, built.colliders, webs, sound);

    const spCell = worldToGridCell(spider.position.x, spider.position.z);
    // Procura uma célula vizinha aberta a <= 2 células da Aranha onde um grito seja ouvido mesmo sem lanterna/corrida!
    let shouterPos = new THREE.Vector3(spider.position.x, 0, spider.position.z);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dz === 0) continue;
        const gx = spCell.gx + dx;
        const gz = spCell.gz + dz;
        if (!isSolidCell(LABYRINTH_MAP, gx, gz)) {
          const w = gridCellToWorld(gx, gz);
          shouterPos = new THREE.Vector3(w.x, 0, w.z);
        }
      }
    }
    const farQuietPos = gridCellToWorld(1, 1);

    const target = spider.selectBestMultiplayerCandidate([
      {
        id: 'quiet-player',
        isLocal: true,
        pos: new THREE.Vector3(farQuietPos.x, 0, farQuietPos.z),
        yaw: 0,
        sprinting: false,
        crouching: true,
        flashlightOn: false,
        flashlightDir: new THREE.Vector3(0, 0, -1),
        voiceLevel: 0,
        ensnared: false,
        afk: false,
      },
      {
        id: 'screaming-friend',
        isLocal: false,
        pos: shouterPos,
        yaw: 0,
        sprinting: false,
        crouching: true,
        flashlightOn: false,
        flashlightDir: new THREE.Vector3(0, 0, -1),
        voiceLevel: 0.92,
        ensnared: false,
        afk: false,
      },
    ]);
    expect(target.id).toBe('screaming-friend');
  });

  it('modela acústica 3D do labirinto, passos multicamada do jogador/aranha, oclusão por paredes e corte dedicado de teia', () => {
    // 1. Oclusão progressiva por paredes de pedra/metal do labirinto + balanço Dry/Reverb
    const clearNear = computeLabyrinthSoundAcoustics(2.0, 22.0, 0);
    const oneWall = computeLabyrinthSoundAcoustics(6.0, 22.0, 1);
    const twoWalls = computeLabyrinthSoundAcoustics(6.0, 22.0, 2);
    const beyondRange = computeLabyrinthSoundAcoustics(24.0, 22.0, 0);

    expect(clearNear.audible).toBe(true);
    expect(clearNear.lowpassHz).toBeGreaterThan(14_000);
    expect(oneWall.lowpassHz).toBeLessThan(2_000);
    expect(twoWalls.lowpassHz).toBeLessThan(oneWall.lowpassHz);
    expect(twoWalls.dryGain).toBeLessThan(oneWall.dryGain);
    expect(beyondRange.audible).toBe(false);

    // 2. Perfil multicamada dos passos do jogador: tech vs stone, furtivo vs corrida e mancando quando ferido
    const stepTechWalk = computeFootstepLayerProfile('tech', false, false, false, 0, false);
    const stepStoneWalk = computeFootstepLayerProfile('stone', false, false, false, 0, false);
    const stepCrouch = computeFootstepLayerProfile('tech', false, true, false, 0, false);
    const stepSprintInjured = computeFootstepLayerProfile('stone', true, false, true, 2, true);

    expect(stepTechWalk.heelBaseHz).toBeGreaterThan(stepStoneWalk.heelBaseHz);
    expect(stepTechWalk.surfaceModesHz[2]).toBeGreaterThan(stepStoneWalk.surfaceModesHz[2]);
    expect(stepCrouch.heelGain).toBeLessThan(stepTechWalk.heelGain * 0.5);
    expect(stepCrouch.lowpassCutoffHz).toBeLessThan(2_000);
    expect(stepSprintInjured.heelGain).toBeGreaterThan(stepStoneWalk.heelGain);
    expect(stepSprintInjured.limpScuffGain).toBeGreaterThan(0);

    // 3. Passos da Aranha Gigante: clangor metálico no teto vs garra na pedra + frenesi + oclusão de parede
    const spiderFloorStalk = computeSpiderStepLayerProfile(5.0, false, false, 0);
    const spiderCeilingChase = computeSpiderStepLayerProfile(5.0, true, true, 0);
    const spiderBehindWalls = computeSpiderStepLayerProfile(5.0, true, true, 2);

    expect(spiderFloorStalk.audible).toBe(true);
    expect(spiderFloorStalk.metallicModesHz).toBeNull();
    expect(spiderCeilingChase.metallicModesHz).toHaveLength(3);
    expect(spiderCeilingChase.clawStrikeGain).toBeGreaterThan(spiderFloorStalk.clawStrikeGain);
    expect(spiderCeilingChase.subWeightGain).toBeGreaterThan(spiderFloorStalk.subWeightGain);
    expect(spiderBehindWalls.lowpassHz).toBeLessThan(spiderCeilingChase.lowpassHz);

    // 4. No Co-op Host, a espacialização da Aranha usa os ouvidos do ouvinte local (`listenerPos`), não da vítima remota!
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const built = buildDoomLabyrinth(scene, textures, shared);
    const webs = new DoomSpiderWebManager(scene, shared);

    let capturedScreamDist = -1;
    let capturedScreamWalls = -1;
    let snapCount = 0;
    let cutCount = 0;

    const soundMock = {
      playSpiderFootstep: () => {},
      playSpiderChitter: () => {},
      playSpiderScream: (_pan: number, dist: number, walls = 0) => {
        capturedScreamDist = dist;
        capturedScreamWalls = walls;
      },
      playSpiderPainRecoil: () => {},
      playSpiderWebSpin: () => {},
      playWebTrapSnap: () => {
        snapCount++;
      },
      playWebCut: () => {
        cutCount++;
      },
    } as unknown as SoundEngine;

    const spider = new DoomSpider(
      scene,
      shared,
      built.colliders,
      webs,
      soundMock,
      createRandomArenaLayout({ worldSeed: 4242, playerSeed: 4242 })
    );
    const trapPos = new THREE.Vector3(spider.position.x + 0.5, 0, spider.position.z);
    const victimNearSpider = new THREE.Vector3(spider.position.x + 0.5, 0, spider.position.z);
    const farHostCell = gridCellToWorld(1, 1);
    const farHostListener = new THREE.Vector3(farHostCell.x, 0, farHostCell.z);

    spider.alertToWebTrap(trapPos, victimNearSpider, farHostListener, 0);
    expect(capturedScreamDist).toBeCloseTo(spider.position.distanceTo(farHostListener), 2);
    expect(capturedScreamWalls).toBeGreaterThanOrEqual(1);

    // 5. Pisar na teia toca `playWebTrapSnap`, enquanto cortar com a faca toca `playWebCut` dedicado!
    const cell55 = gridCellToWorld(5, 5);
    webs.spawnWebTrap(cell55.x, cell55.z, true);
    const walker = new THREE.Vector3(cell55.x, 0, cell55.z);
    webs.update(0.016, walker, false, false, soundMock, () => {});
    expect(snapCount).toBe(1);
    expect(cutCount).toBe(0);

    webs.slashWebWithKnife(walker, new THREE.Vector3(0, 0, -1), soundMock);
    expect(cutCount).toBe(1);
  });

  it('valida controles e layout mobile: analógico 360° furtivo/corrida, FOV vertical adaptativo em retrato e escala binária sem cortes', () => {
    // 1. Zona morta radial evita deriva involuntária no analógico virtual
    const idleVec = computeVirtualJoystickVector(2, -2, 44, 0.12);
    expect(idleVec.magnitude).toBe(0);
    expect(idleVec.moveX).toBe(0);
    expect(idleVec.moveY).toBe(0);

    // 2. Empurrar o analógico pela metade para cima gera avanço furtivo contínuo (0 < magnitude < 1)
    const stealthVec = computeVirtualJoystickVector(0, -24, 44, 0.12);
    expect(stealthVec.moveY).toBeGreaterThan(0.35);
    expect(stealthVec.moveY).toBeLessThan(0.75);
    expect(stealthVec.moveX).toBeCloseTo(0, 4);
    expect(stealthVec.magnitude).toBeCloseTo(stealthVec.moveY, 4);

    // 3. Arrastar além do raio máximo grampeia em magnitude = 1.0 e clampedDy = -maxRadius
    const fullForward = computeVirtualJoystickVector(0, -90, 44, 0.12);
    expect(fullForward.moveY).toBeCloseTo(1, 5);
    expect(fullForward.magnitude).toBeCloseTo(1, 5);
    expect(fullForward.clampedDy).toBeCloseTo(-44, 5);

    // 4. FOV vertical adaptativo preserva exatamente 74° no Desktop/Paisagem e abre suavemente no Retrato
    expect(computeAdaptiveVerticalFov(16 / 9, 74, 98)).toBe(74);
    expect(computeAdaptiveVerticalFov(20 / 9, 74, 98)).toBe(74);
    const portraitFov = computeAdaptiveVerticalFov(390 / 844, 74, 98);
    expect(portraitFov).toBeGreaterThan(88);
    expect(portraitFov).toBeLessThanOrEqual(98);


  });

  it('valida modelagem 3D aracnídea aprimorada: coxas alinhadas ao fêmur, quelíceras em tesoura, garras seladas e normais sem torção no piso e no teto', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(scene, textures, shared);
    const webs = new DoomSpiderWebManager(scene, shared);
    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;

    const spider = new DoomSpider(
      scene,
      shared,
      maze.colliders,
      webs,
      mockSound
    );

    const internal = spider as unknown as {
      placeAtCell: (
        wx: number,
        wz: number,
        mode: 'FLOOR' | 'WALL' | 'CEILING'
      ) => void;
      coxaPivots: THREE.Group[];
      leftCheliceraPivot: THREE.Group;
      rightCheliceraPivot: THREE.Group;
      leftPalpPivot: THREE.Group;
      rightPalpPivot: THREE.Group;
      abdomenPivot: THREE.Group;
      bodyGroup: THREE.Group;
      limbs: Array<{
        ikPoints: THREE.Vector3[];
        curvePoints: THREE.Vector3[];
        posAttr: THREE.BufferAttribute;
        normAttr: THREE.BufferAttribute;
      }>;
    };

    expect(internal.coxaPivots.length).toBe(8);

    const openCell = gridCellToWorld(3, 3);
    for (const mode of ['FLOOR', 'CEILING'] as const) {
      internal.placeAtCell(openCell.x, openCell.z, mode);
      spider.update(
        0.016,
        1.25,
        new THREE.Vector3(maze.spawnPosition.x, 0, maze.spawnPosition.z),
        0,
        false,
        false,
        false,
        new THREE.Vector3(0, 0, -1),
        [],
        () => {}
      );
      scene.updateMatrixWorld(true);

      // 1. Quelíceras articulam simetricamente em tesoura (sinais opostos em Z e Y!)
      expect(
        Math.sign(internal.leftCheliceraPivot.rotation.z)
      ).toBe(-Math.sign(internal.rightCheliceraPivot.rotation.z));
      expect(Math.abs(internal.leftCheliceraPivot.rotation.z)).toBeGreaterThan(0.01);

      // 2. Cada cápsula Coxa+Trocânter aponta diretamente para o Fêmur (`ikPoints[1]`)!
      for (let i = 0; i < 8; i++) {
        const coxa = internal.coxaPivots[i];
        const limb = internal.limbs[i];
        const coxaWorldZ = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(coxa.getWorldQuaternion(new THREE.Quaternion()))
          .normalize();
        const femurDir = new THREE.Vector3()
          .subVectors(limb.ikPoints[1], limb.ikPoints[0])
          .normalize();
        expect(coxaWorldZ.dot(femurDir)).toBeGreaterThan(0.99);

        // 3. Normais unitárias externas válidas e ponta distal da garra selada (sem buraco aberto!)
        expect(limb.posAttr.count).toBe(34 * 10);
        for (let v = 0; v < limb.normAttr.count; v++) {
          const nLen = Math.hypot(
            limb.normAttr.getX(v),
            limb.normAttr.getY(v),
            limb.normAttr.getZ(v)
          );
          expect(nLen).toBeCloseTo(1.0, 3);
        }

        // Diâmetro do último anel (ponta da garra) é selado (< 1cm)
        const lastRingBase = (34 - 1) * 10;
        const pTip0 = new THREE.Vector3(
          limb.posAttr.getX(lastRingBase),
          limb.posAttr.getY(lastRingBase),
          limb.posAttr.getZ(lastRingBase)
        );
        const pTipOpposite = new THREE.Vector3(
          limb.posAttr.getX(lastRingBase + 5),
          limb.posAttr.getY(lastRingBase + 5),
          limb.posAttr.getZ(lastRingBase + 5)
        );
        expect(pTip0.distanceTo(pTipOpposite)).toBeLessThan(0.01);

        // Quilha dorsal (k = 0) aponta para o dorso anatômico da aranha tanto no PISO quanto no TETO!
        const midRingIdx = 12 * 10; // Fêmur/Patela no arco
        const dorsalVert = new THREE.Vector3(
          limb.posAttr.getX(midRingIdx),
          limb.posAttr.getY(midRingIdx),
          limb.posAttr.getZ(midRingIdx)
        );
        const ventralVert = new THREE.Vector3(
          limb.posAttr.getX(midRingIdx + 5),
          limb.posAttr.getY(midRingIdx + 5),
          limb.posAttr.getZ(midRingIdx + 5)
        );
        if (mode === 'FLOOR') {
          expect(dorsalVert.y).toBeGreaterThan(ventralVert.y);
        } else {
          expect(dorsalVert.y).toBeLessThan(ventralVert.y);
        }
      }
    }
  });

  it('randomiza itens das caixas, posições das caixas, spawn do jogador, ninho, teias e aranha preservando o mapa 29x29 intacto', () => {
    const mapSnapshotBefore = LABYRINTH_MAP.slice();
    const lairChambers = findValidLairChambers();
    expect(lairChambers.length).toBeGreaterThanOrEqual(10);

    const uniqueSpawnCells = new Set<string>();
    const uniqueLairCells = new Set<string>();
    const uniqueSpiderCells = new Set<string>();
    const uniqueRadarCells = new Set<string>();
    const uniqueConsumableDistributions = new Set<string>();
    const uniqueFirstCrateItems = new Set<string>();

    for (let run = 0; run < 24; run++) {
      const layout = createRandomArenaLayout({
        worldSeed: 100001 + run * 7919,
        playerSeed: 900007 + run * 104729,
      });

      // 1) Spawn do jogador em célula aberta segura, longe >= 18m da Aranha e sem armadilha no pé
      expect(
        isSolidCell(
          LABYRINTH_MAP,
          layout.playerSpawnCell.gx,
          layout.playerSpawnCell.gz
        )
      ).toBe(false);

      const spiderWorld = gridCellToWorld(
        layout.spiderInitialSpawnCell.gx,
        layout.spiderInitialSpawnCell.gz
      );
      const distPlayerToSpider = Math.hypot(
        spiderWorld.x - layout.playerSpawnPosition.x,
        spiderWorld.z - layout.playerSpawnPosition.z
      );
      expect(distPlayerToSpider).toBeGreaterThanOrEqual(18.0);

      for (const trap of layout.initialWebTrapCells) {
        expect(
          Math.hypot(
            trap.gx - layout.playerSpawnCell.gx,
            trap.gz - layout.playerSpawnCell.gz
          )
        ).toBeGreaterThanOrEqual(2.5);
      }

      // 2) Olhar inicial do jogador aponta na direção de um corredor transitável (nunca colado na parede)
      const lookStepX =
        layout.playerSpawnPosition.x - Math.sin(layout.playerSpawnYaw) * 2.2;
      const lookStepZ =
        layout.playerSpawnPosition.z - Math.cos(layout.playerSpawnYaw) * 2.2;
      const aheadCell = worldToGridCell(lookStepX, lookStepZ);
      expect(
        isSolidCell(LABYRINTH_MAP, aheadCell.gx, aheadCell.gz)
      ).toBe(false);

      // 3) Todas as 25 caixas caem em células abertas distintas, fora do spawn exato do jogador e com itens essenciais garantidos
      expect(layout.cratePlacements.length).toBe(25);
      const crateKeys = new Set<string>();
      const itemCounts: Record<string, number> = {};
      for (const c of layout.cratePlacements) {
        expect(isSolidCell(LABYRINTH_MAP, c.gx, c.gz)).toBe(false);
        expect(
          c.gx === layout.playerSpawnCell.gx &&
            c.gz === layout.playerSpawnCell.gz
        ).toBe(false);
        const key = `${c.gx},${c.gz}`;
        expect(crateKeys.has(key)).toBe(false);
        crateKeys.add(key);
        itemCounts[c.itemId] = (itemCounts[c.itemId] ?? 0) + 1;
        if (c.itemId === 'field_radar') {
          uniqueRadarCells.add(key);
        }
      }

      expect(itemCounts.field_radar).toBe(1);
      expect(itemCounts.rusty_knife).toBe(1);
      expect(itemCounts.sector_b_key).toBe(1);
      expect(itemCounts.industrial_battery).toBeGreaterThanOrEqual(1);
      expect(itemCounts.sterile_bandage).toBeGreaterThanOrEqual(1);
      expect(itemCounts.magnesium_flare).toBeGreaterThanOrEqual(1);
      expect(itemCounts.old_morphine).toBeGreaterThanOrEqual(1);

      uniqueSpawnCells.add(
        `${layout.playerSpawnCell.gx},${layout.playerSpawnCell.gz}`
      );
      uniqueLairCells.add(`${layout.lairCell.gx},${layout.lairCell.gz}`);
      uniqueSpiderCells.add(
        `${layout.spiderInitialSpawnCell.gx},${layout.spiderInitialSpawnCell.gz}`
      );
      uniqueFirstCrateItems.add(layout.cratePlacements[0].itemId);
      uniqueConsumableDistributions.add(
        `${itemCounts.industrial_battery}-${itemCounts.sterile_bandage}-${itemCounts.magnesium_flare}-${itemCounts.old_morphine}`
      );
    }

    // Confirma alta diversidade real entre partidas em TODOS os sistemas!
    expect(uniqueSpawnCells.size).toBeGreaterThanOrEqual(14);
    expect(uniqueLairCells.size).toBeGreaterThanOrEqual(6);
    expect(uniqueSpiderCells.size).toBeGreaterThanOrEqual(12);
    expect(uniqueRadarCells.size).toBeGreaterThanOrEqual(12);
    expect(uniqueFirstCrateItems.size).toBeGreaterThanOrEqual(4);
    expect(uniqueConsumableDistributions.size).toBeGreaterThanOrEqual(5);

    // Sincronismo Multiplayer Co-op por código de sala: mundo compartilhado idêntico, spawns individuais variados!
    const roomWorldSeed = hashArenaSeed('oof-arena-world:SALA77');
    const hostLayout = createRandomArenaLayout({
      worldSeed: roomWorldSeed,
      playerSeed: 11111,
      isMultiplayer: true,
    });
    const guestLayout = createRandomArenaLayout({
      worldSeed: roomWorldSeed,
      playerSeed: 22222,
      isMultiplayer: true,
    });
    expect(hostLayout.lairCell).toEqual(guestLayout.lairCell);
    expect(hostLayout.cratePlacements).toEqual(guestLayout.cratePlacements);
    expect(hostLayout.initialWebTrapCells).toEqual(
      guestLayout.initialWebTrapCells
    );
    expect(hostLayout.playerSpawnCell).not.toEqual(guestLayout.playerSpawnCell);

    // E o mapa arquitetônico 29x29 permanece 100% imutável!
    expect(LABYRINTH_MAP).toEqual(mapSnapshotBefore);
  });

  it('implementa sistema de estamina diegético completo (dreno na corrida e slide, exaustão, recuperação e tônico) com ZERO HUD na tela', () => {
    const stam = createInitialStaminaState();
    expect(stam.stamina).toBe(MAX_PLAYER_STAMINA);
    expect(stam.exhausted).toBe(false);
    expect(canPlayerSprintWithStamina(stam)).toBe(true);
    expect(canPlayerSlideWithStamina(stam)).toBe(true);

    // 1. Descansado (100%): fadiga zero e câmera sem balanço de falta de ar
    const rested = stepPlayerStaminaState(stam, {
      dt: 1 / 60,
      isSprinting: false,
      startedSlide: false,
      isSliding: false,
      isCrouching: false,
      planarSpeed: 0,
    });
    expect(rested.fatigue01).toBe(0);
    expect(rested.chestHeaveOffsetY).toBe(0);

    // 2. Iniciar um deslize consome custo imediato de estamina
    const afterSlide = stepPlayerStaminaState(stam, {
      dt: 1 / 60,
      isSprinting: false,
      startedSlide: true,
      isSliding: true,
      isCrouching: true,
      planarSpeed: 11.2,
    });
    expect(afterSlide.stamina).toBeCloseTo(
      MAX_PLAYER_STAMINA - STAMINA_SLIDE_BURST_COST,
      2
    );

    // 3. Correr continuamente esgota o fôlego até 0%, disparando `becameExhausted` uma única vez e travando sprint/slide
    let exhaustedTriggerCount = 0;
    for (let i = 0; i < 600; i++) {
      const canRun = canPlayerSprintWithStamina(stam);
      const res = stepPlayerStaminaState(stam, {
        dt: 1 / 60,
        isSprinting: canRun,
        startedSlide: false,
        isSliding: false,
        isCrouching: false,
        planarSpeed: canRun ? 8.9 : 5.2,
      });
      if (res.becameExhausted) {
        exhaustedTriggerCount++;
      }
      if (stam.exhausted) break;
    }
    expect(exhaustedTriggerCount).toBe(1);
    expect(stam.stamina).toBe(0);
    expect(stam.exhausted).toBe(true);
    expect(canPlayerSprintWithStamina(stam)).toBe(false);
    expect(canPlayerSlideWithStamina(stam)).toBe(false);

    // Confirma que `stepPlayerSlideState` bloqueia sprint e slide quando sem fôlego
    const slideState = createInitialSlideState();
    const blockedMove = stepPlayerSlideState(slideState, {
      dt: 1 / 60,
      holdingCtrl: true,
      holdingShift: true,
      wishX: 0,
      wishZ: -1,
      forwardX: 0,
      forwardZ: -1,
      velX: 0,
      velZ: -8.0,
      canStandUp: true,
      ensnared: false,
      injurySlow: 1,
      webSpeedMultiplier: 1,
      canSprint: canPlayerSprintWithStamina(stam),
      canSlide: canPlayerSlideWithStamina(stam),
    });
    expect(blockedMove.sprinting).toBe(false);
    expect(blockedMove.startedSlide).toBe(false);
    expect(blockedMove.isSliding).toBe(false);

    // 4. Parado recuperando o fôlego: produz oscilação respiratória sutil na câmera e destrava ao cruzar 26%
    let maxHeave = 0;
    for (let i = 0; i < 120; i++) {
      const res = stepPlayerStaminaState(stam, {
        dt: 1 / 60,
        isSprinting: false,
        startedSlide: false,
        isSliding: false,
        isCrouching: true,
        planarSpeed: 0,
      });
      maxHeave = Math.max(maxHeave, Math.abs(res.chestHeaveOffsetY));
    }
    expect(maxHeave).toBeGreaterThan(0.004);
    expect(stam.stamina).toBeGreaterThanOrEqual(
      STAMINA_EXHAUSTION_RECOVERY_THRESHOLD
    );
    expect(stam.exhausted).toBe(false);
    expect(canPlayerSprintWithStamina(stam)).toBe(true);

    // 5. Frasco de láudano (`boostPlayerStamina`) restaura fôlego e limpa exaustão na hora
    stam.stamina = 0;
    stam.exhausted = true;
    boostPlayerStamina(stam, 55);
    expect(stam.stamina).toBe(55);
    expect(stam.exhausted).toBe(false);
  });

  it('elimina 100% os teletransportes, flips aéreos e travamentos em quinas da Aranha (Solo + Multiplayer)', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const built = buildDoomLabyrinth(scene, textures, shared);
    const webs = new DoomSpiderWebManager(scene, shared);
    const sound = {
      playSpiderFootstep: () => {},
      playSpiderHiss: () => {},
      playSpiderScream: () => {},
      playSpiderStrike: () => {},
      playSpiderDragPull: () => {},
      playSpiderWebSpin: () => {},
      playWebTrapSnap: () => {},
      playSpiderChitter: () => {},
    } as unknown as SoundEngine;

    const spider = new DoomSpider(
      scene,
      shared,
      built.colliders,
      webs,
      sound
    );
    const spiderInternal = spider as unknown as {
      placeAtCell: (wx: number, wz: number, mode: 'FLOOR' | 'CEILING') => void;
      resolveBodyMazeCollision: () => void;
    };

    // Encontra uma esquina real em L (célula aberta (cx, cz) com vizinho aberto Leste (cx+1, cz),
    // vizinho aberto Sul (cx, cz+1) e parede sólida diagonal (cx+1, cz+1)!)
    let cornerCell = { gx: 3, gz: 3 };
    let startArm = { gx: 3, gz: 4 };
    let targetArm = { gx: 4, gz: 3 };
    outer: for (let gz = 2; gz < LABYRINTH_MAP.length - 3; gz++) {
      for (let gx = 2; gx < LABYRINTH_MAP[gz].length - 3; gx++) {
        if (
          !isSolidCell(LABYRINTH_MAP, gx, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx + 1, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx, gz + 1) &&
          isSolidCell(LABYRINTH_MAP, gx + 1, gz + 1)
        ) {
          cornerCell = { gx, gz };
          startArm = { gx, gz: gz + 1 };
          targetArm = { gx: gx + 1, gz };
          break outer;
        }
      }
    }

    // 1. Teste de Perseguição em Quina de 90° (cenário exato que causava loop de stuckTimer + teleporte!)
    const startW = gridCellToWorld(startArm.gx, startArm.gz);
    const targetW = gridCellToWorld(targetArm.gx, targetArm.gz);
    // Posiciona jogador encostado atrás da quina sólida para forçar contorno real de 90°!
    const playerBehindCorner = new THREE.Vector3(
      targetW.x + 0.65,
      1.6,
      targetW.z + 0.65
    );
    const flashDir = new THREE.Vector3(0, 0, -1);

    spiderInternal.placeAtCell(startW.x + 0.7, startW.z, 'CEILING');
    spider.alertToWebTrap(playerBehindCorner, playerBehindCorner);
    expect(spider.currentState).toBe('FRENZY_CHASE');

    const dt = 1 / 60;
    let elapsed = 0;
    let caught = false;
    const prev = spider.position.clone();

    for (let f = 0; f < 420; f++) {
      elapsed += dt;
      spider.update(
        dt,
        elapsed,
        playerBehindCorner,
        0,
        true,
        false,
        true,
        flashDir,
        [],
        () => {
          caught = true;
        }
      );

      // ZERO teletransporte em nenhum frame (deslocamento estritamente contínuo)!
      const planarStep = Math.hypot(
        spider.position.x - prev.x,
        spider.position.z - prev.z
      );
      const vertStep = Math.abs(spider.position.y - prev.y);
      expect(planarStep).toBeLessThanOrEqual(0.28);
      expect(vertStep).toBeLessThanOrEqual(0.22);

      // Permanece sempre em célula caminhável (nunca entra em parede '#') e firme no FLOOR durante FRENZY_CHASE!
      const c = worldToGridCell(spider.position.x, spider.position.z);
      expect(isSolidCell(LABYRINTH_MAP, c.gx, c.gz)).toBe(false);
      expect(spider.currentSurfaceMode).toBe('FLOOR');

      prev.copy(spider.position);
      if (caught) break;
    }
    expect(caught).toBe(true);

    // 2. Teste de Travadinha de Navegador / Queda Brusca de FPS (`dt = 0.45s`): sem teleporte nem tunelamento!
    const cornerW = gridCellToWorld(cornerCell.gx, cornerCell.gz);
    spiderInternal.placeAtCell(cornerW.x, cornerW.z, 'FLOOR');
    spider.alertToWebTrap(playerBehindCorner, playerBehindCorner);
    const beforeHitch = spider.position.clone();
    spider.update(
      0.45,
      elapsed + 0.45,
      playerBehindCorner,
      0,
      true,
      false,
      true,
      flashDir,
      [],
      () => {}
    );
    expect(
      Math.hypot(
        spider.position.x - beforeHitch.x,
        spider.position.z - beforeHitch.z
      )
    ).toBeLessThan(0.68);
    const afterHitchCell = worldToGridCell(
      spider.position.x,
      spider.position.z
    );
    expect(
      isSolidCell(LABYRINTH_MAP, afterHitchCell.gx, afterHitchCell.gz)
    ).toBe(false);

    // 3. Teste de Retirada Pós-Abdução em Multiplayer com Observador Próximo: ZERO teleporte!
    const lairPos = webs.lairCenter.clone();
    spider.updateCinematicSequence(
      dt,
      elapsed + 1.0,
      'WEBBING_IN_LAIR',
      1.0,
      new THREE.Vector3(lairPos.x, 1.36, lairPos.z),
      lairPos,
      lairPos
    );
    const beforeRetreat = spider.position.clone();
    const watchingAlly = new THREE.Vector3(lairPos.x + 4.0, 1.6, lairPos.z);
    spider.finishAbductionRetreat([watchingAlly]);
    expect(spider.currentState).toBe('FLEE_RETREAT');
    expect(spider.position.distanceTo(beforeRetreat)).toBeLessThan(0.65);

    // 4. Expulsão segura contra paredes contíguas: nunca empurra para outro bloco sólido `#`!
    const wallW = gridCellToWorld(startArm.gx + 1, startArm.gz);
    spider.position.set(wallW.x, 1.42, wallW.z);
    spiderInternal.resolveBodyMazeCollision();
    const ejectedCell = worldToGridCell(spider.position.x, spider.position.z);
    expect(isSolidCell(LABYRINTH_MAP, ejectedCell.gx, ejectedCell.gz)).toBe(
      false
    );
  });

  it('abre, foca sem scroll, mantém HUD visível e fecha limpo o Chat de Rádio [T] sem bugar a tela nem travar o teclado', async () => {
    // Harness DOM determinístico para validar ciclo completo de foco, scroll, visibilidade do HUD e rede!
    interface MockEl {
      tagName: string;
      className: string;
      textContent: string;
      value: string;
      title: string;
      scrollTop: number;
      scrollLeft: number;
      clientWidth: number;
      clientHeight: number;
      style: Record<string, string>;
      attrs: Map<string, string>;
      children: MockEl[];
      readonly firstChild: MockEl | null;
      readonly firstElementChild: MockEl | null;
      parent: MockEl | null;
      listeners: Map<string, Array<(ev: Record<string, unknown>) => void>>;
      classList: {
        add: (...tokens: string[]) => void;
        remove: (...tokens: string[]) => void;
        toggle: (token: string, force?: boolean) => boolean;
        contains: (token: string) => boolean;
      };
      appendChild: (child: MockEl) => MockEl;
      append: (...nodes: MockEl[]) => void;
      remove: () => void;
      querySelector: (selector: string) => MockEl | null;
      addEventListener: (
        type: string,
        cb: (ev: Record<string, unknown>) => void
      ) => void;
      dispatch: (type: string, extra?: Record<string, unknown>) => void;
      focus: (opts?: { preventScroll?: boolean }) => void;
      blur: () => void;
      innerHTML: string;
    }

    const focusCalls: Array<{ preventScroll?: boolean } | undefined> = [];
    let activeEl: MockEl | null = null;
    let pointerLockedEl: unknown = { id: 'webgl-canvas' };
    let exitPointerLockCalls = 0;
    const scrollToCalls: Array<[number, number]> = [];

    const makeEl = (tag: string): MockEl => {
      const classes = new Set<string>();
      let html = '';
      const el: MockEl = {
        tagName: tag.toUpperCase(),
        get className() {
          return Array.from(classes).join(' ');
        },
        set className(val: string) {
          classes.clear();
          for (const t of val.split(/\s+/).filter(Boolean)) classes.add(t);
        },
        textContent: '',
        value: '',
        title: '',
        scrollTop: 0,
        scrollLeft: 0,
        clientWidth: 1280,
        clientHeight: 720,
        style: {},
        attrs: new Map(),
        children: [],
        get firstChild() {
          return el.children[0] ?? null;
        },
        get firstElementChild() {
          return el.children[0] ?? null;
        },
        parent: null,
        listeners: new Map(),
        classList: {
          add: (...tokens) => tokens.forEach((t) => classes.add(t)),
          remove: (...tokens) => tokens.forEach((t) => classes.delete(t)),
          toggle: (token, force) => {
            const next = force ?? !classes.has(token);
            if (next) classes.add(token);
            else classes.delete(token);
            return next;
          },
          contains: (token) => classes.has(token),
        },
        appendChild(child: MockEl) {
          child.parent = el;
          el.children.push(child);
          return child;
        },
        append(...nodes: MockEl[]) {
          for (const n of nodes) el.appendChild(n);
        },
        remove() {
          if (!el.parent) return;
          const idx = el.parent.children.indexOf(el);
          if (idx >= 0) el.parent.children.splice(idx, 1);
          el.parent = null;
        },
        querySelector(selector: string): MockEl | null {
          const m = /^\[([a-z0-9-]+)\]$/i.exec(selector.trim());
          const attrName = m ? m[1] : null;
          const visit = (node: MockEl): MockEl | null => {
            if (attrName && node.attrs.has(attrName)) return node;
            for (const c of node.children) {
              const hit = visit(c);
              if (hit) return hit;
            }
            return null;
          };
          return visit(el);
        },
        addEventListener(type, cb) {
          const arr = el.listeners.get(type) ?? [];
          arr.push(cb);
          el.listeners.set(type, arr);
        },
        dispatch(type, extra = {}) {
          const ev = {
            type,
            preventDefault: () => {},
            stopPropagation: () => {},
            ...extra,
          };
          for (const cb of el.listeners.get(type) ?? []) cb(ev);
        },
        focus(opts) {
          focusCalls.push(opts);
          // Simula navegador tentando rolar contêineres se preventScroll não estivesse ativo
          if (!opts?.preventScroll) {
            viewportEl.scrollTop = 340;
            docRootEl.scrollTop = 340;
          }
          activeEl = el;
          el.dispatch('focus');
        },
        blur() {
          if (activeEl === el) activeEl = null;
          el.dispatch('blur');
        },
        get innerHTML() {
          return html;
        },
        set innerHTML(val: string) {
          html = val;
          el.children.length = 0;
          // Extrai automaticamente todas as tags com [data-coop-*] do template do HUD!
          const tagRe = /<([a-z0-9]+)\b([^>]*)>/gi;
          let match: RegExpExecArray | null;
          while ((match = tagRe.exec(val)) !== null) {
            const attrsRaw = match[2];
            const dataAttrRe = /\b(data-coop-[a-z0-9-]+)\b/gi;
            const foundAttrs: string[] = [];
            let dm: RegExpExecArray | null;
            while ((dm = dataAttrRe.exec(attrsRaw)) !== null) {
              foundAttrs.push(dm[1]);
            }
            if (foundAttrs.length > 0) {
              const child = makeEl(match[1]);
              const clsMatch = /\bclass="([^"]*)"/i.exec(attrsRaw);
              if (clsMatch) child.className = clsMatch[1];
              for (const a of foundAttrs) child.attrs.set(a, '');
              el.appendChild(child);
            }
          }
        },
      };
      return el;
    };

    const docRootEl = makeEl('html');
    const bodyEl = makeEl('body');
    const appEl = makeEl('div');
    const viewportEl = makeEl('div');

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;

    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => makeEl(tag),
      getElementById: (id: string) => (id === 'app' ? appEl : null),
      get activeElement() {
        return activeEl;
      },
      get pointerLockElement() {
        return pointerLockedEl;
      },
      exitPointerLock: () => {
        exitPointerLockCalls++;
        pointerLockedEl = null;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      hidden: false,
      documentElement: docRootEl,
      body: bodyEl,
      fullscreenElement: null,
    };
    (globalThis as Record<string, unknown>).window = {
      innerWidth: 1280,
      innerHeight: 720,
      scrollTo: (x: number, y: number) => {
        scrollToCalls.push([x, y]);
      },
      requestAnimationFrame: (cb: FrameRequestCallback) => {
        cb(16);
        return 1;
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    try {
      clearLocalMirrorRoomsForTests();
      const lobby = new MultiplayerLobbyService({ forceLocalOnly: true });
      const hostSession = await lobby.createRoom(
        { roomName: 'Sala Rádio T', isListed: true, maxPlayers: 4 },
        { id: 'host-chat-t', name: 'CAPITÃO' }
      );
      const guestJoin = await lobby.joinRoom(
        hostSession.roomCode,
        undefined,
        { id: 'guest-chat-t', name: 'ENGENHEIRO' }
      );
      expect(guestJoin.ok).toBe(true);

      const receivedEvents: NetworkWorldEvent[] = [];
      const receivedActionPoses: NetworkPlayerPosePacket[] = [];
      const guestClient = new MultiplayerRoomClient(
        guestJoin.session!,
        {
          onRemotePlayerPose: (pkt) => receivedActionPoses.push(pkt),
          onRemotePlayerLeft: () => {},
          onSpiderSync: () => {},
          onWorldEvent: (ev) => receivedEvents.push(ev),
          onRosterUpdated: () => {},
        },
        true
      );
      guestClient.connect();

      let closedCallbackCount = 0;
      const scene = new THREE.Scene();
      const shared = createDoomSharedUniforms();
      const coordinator = new DoomMultiplayerCoordinator(
        hostSession,
        scene,
        shared,
        viewportEl as unknown as HTMLElement,
        new SoundEngine(),
        {
          createQuickItemProps: () => new DoomFlashlight(1).createThirdPersonQuickProps(),
          createWeaponProps: () => ({ shotgun: new DoomShotgunViewmodel(1).createThirdPersonWeapon(), taser: new DoomTaserViewmodel(1).createThirdPersonWeapon() }),
          onReceiveFlare: () => {},
          onRescuedByAlly: () => {},
          onAbductionInterruptedByAlly: () => {},
          onSpiderInterruptedAndFlees: () => {},
          onCaughtByAuthoritativeSpider: () => {},
          onRemoteVictimFinishedAbduction: () => {},
          onRemoteWebTrapSpawned: () => {},
          onRemoteWebTrapTriggered: () => {},
          onRemoteWebTrapCut: () => {},
          onNotifyHud: () => {},
          onRadioChatClosed: () => {
            closedCallbackCount++;
          },
          onLeaveRoomRequested: () => {},
        },
        true
      );

      // Simula sujeira de scroll antes de apertar [T]
      viewportEl.scrollTop = 180;
      appEl.scrollTop = 95;
      docRootEl.scrollTop = 210;

      // 1. Apertar [T]: abre chat, libera Pointer Lock, foca sincronamente com { preventScroll: true } e zera scroll!
      coordinator.openRadioChatInput();
      expect(coordinator.isChatTyping).toBe(true);
      expect(exitPointerLockCalls).toBe(1);
      expect(focusCalls.length).toBeGreaterThanOrEqual(1);
      expect(focusCalls[0]).toEqual({ preventScroll: true });
      expect(activeEl).toBe(coordinator.chatInputElement as unknown as MockEl);
      expect(viewportEl.scrollTop).toBe(0);
      expect(appEl.scrollTop).toBe(0);
      expect(docRootEl.scrollTop).toBe(0);
      expect(scrollToCalls.length).toBeGreaterThanOrEqual(1);

      // 2. PROTEÇÃO CRÍTICA DO HUD: mesmo se update() receber hideHud=true enquanto digita,
      // o HUD jamais pode virar display:'none' (o que antes matava o foco e travava a tela inteira!)
      const hudRoot = viewportEl.children.find((c) =>
        c.className.includes('oof-coop-hud')
      )!;
      const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
      coordinator.update(
        0.016,
        1.0,
        cam,
        {
          pos: new THREE.Vector3(0, 0, 0),
          yaw: 0,
          pitch: 0,
          speed: 0,
          bobPhase: 0,
          crouch: 0,
          flashlightOn: true,
          flashDir: new THREE.Vector3(0, 0, -1),
          health: 100,
          bleeding: false,
          ensnared: false,
          inSequence: false,
          dead: false,
          afk: false,
        },
        {
          x: 0,
          y: 1.42,
          z: 0,
          upX: 0,
          upY: 1,
          upZ: 0,
          fwdX: 0,
          fwdY: 0,
          fwdZ: 1,
          state: 'PATROL_HUNT',
          surfaceMode: 'FLOOR',
        },
        true
      );
      expect(hudRoot.style.display).toBe('flex');

      // 3. Mesmo se o input perder foco (ex: clique acidental no HUD), submitAndCloseRadioChat envia a mensagem,
      // fecha a caixa, limpa o texto e dispara onRadioChatClosed para devolver o Pointer Lock!
      activeEl = null;
      coordinator.chatInputElement.value = 'Aranha vista no corredor norte!';
      coordinator.submitAndCloseRadioChat(true);

      expect(coordinator.isChatTyping).toBe(false);
      expect(coordinator.chatInputElement.value).toBe('');
      expect(closedCallbackCount).toBe(1);
      await new Promise((r) => setTimeout(r, 35));
      if (typeof BroadcastChannel !== 'undefined') {
        expect(
          receivedEvents.some(
            (ev) =>
              ev.kind === 'chat' && ev.text === 'Aranha vista no corredor norte!'
          )
        ).toBe(true);
      }

      // 4. Abrir e fechar com closeRadioChatInput(false) (ex: clique direto no canvas 3D) fecha sem duplicar callback!
      coordinator.openRadioChatInput();
      expect(coordinator.isChatTyping).toBe(true);
      coordinator.closeRadioChatInput(false);
      expect(coordinator.isChatTyping).toBe(false);
      expect(closedCallbackCount).toBe(1);

      // 5. Captura de aliado: pede para TENTAR golpear a Aranha durante captura, mas JÁ ERA —
      //    ela NUNCA solta no caminho e só permite salvar lá no NINHO (cocoonLocked)!
      if (typeof BroadcastChannel !== 'undefined') {
        const camTest = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
        camTest.position.set(10, 1.6, 10);
        const allyWorldPos = new THREE.Vector3(11.2, 0, 10);
        const spiderWorldPos = new THREE.Vector3(11.5, 1.3, 10);

        // O pacote de deslize é opcional e deve ser limitado e interpolado pelo observador.
        const slidePose = {
          x: allyWorldPos.x, y: 0, z: allyWorldPos.z, yaw: 0, pitch: 0,
          speed: 6, bobPhase: 0, crouch: 1, slide: 2,
          flashlightOn: false, flashDirX: 0, flashDirY: 0, flashDirZ: -1,
          health: 100, bleeding: false, ensnared: false, inSequence: false, dead: false,
        };
        guestClient.broadcastPlayerPose(slidePose);
        await new Promise((r) => setTimeout(r, 35));
        const ally = (coordinator as any).allies.get('guest-chat-t');
        expect(ally.slideTarget).toBe(1);
        const tickSlide = (action: QuickItemAction | null = null) => coordinator.update(0.05, 1.5, camTest, {
          pos: new THREE.Vector3(10, 0, 10), yaw: 0, pitch: 0, speed: 0,
          bobPhase: 0, crouch: 0, quickItemAction: action, heldWeapon: 'taser', flashlightOn: false, flashDir: new THREE.Vector3(0, 0, -1),
          health: 100, bleeding: false, ensnared: false, inSequence: false, dead: false,
        }, {
          x: 0, y: 1.42, z: 0, upX: 0, upY: 1, upZ: 0,
          fwdX: 0, fwdY: 0, fwdZ: 1, state: 'PATROL_HUNT', surfaceMode: 'FLOOR',
        }, false);
        tickSlide();
        expect(ally.slide).toBeGreaterThan(0);
        expect(ally.astronaut.leftLeg.kneePivot.rotation.x).toBeGreaterThan(-1.88);
        const { slide: _slide, ...legacyPose } = slidePose;
        guestClient.broadcastPlayerPose(legacyPose);
        await new Promise((r) => setTimeout(r, 35));
        expect(ally.slideTarget).toBe(0);
        (coordinator as any).handleRemotePose({ ...slidePose, id: 'guest-chat-t', name: 'ENGENHEIRO', ts: Date.now(), slide: NaN });
        expect(ally.slideTarget).toBe(0);
        const priorSlide = ally.slide;
        tickSlide();
        expect(ally.slide).toBeLessThan(priorSlide);
        const hostFlashlight = new DoomFlashlight(1);
        hostFlashlight.triggerQuickItemAction('knife');
        tickSlide(hostFlashlight.quickItemAction);
        tickSlide(hostFlashlight.quickItemAction);
        await new Promise((r) => setTimeout(r, 35));
        expect(receivedActionPoses.some(pkt => pkt.quickItemAction?.kind === 'knife' && pkt.heldWeapon === 'taser')).toBe(true);

        // Pacotes reais transportam a ação e a arma; o aliado vê o objeto na mão.
        guestClient.broadcastPlayerPose({ ...slidePose, slide: 0, heldWeapon: 'shotgun', quickItemAction: { kind: 'knife', progress: 0.35 } });
        await new Promise((r) => setTimeout(r, 35));
        tickSlide();
        expect(ally.astronaut.thirdPersonItemGroup.visible).toBe(true);
        expect(ally.astronaut.thirdPersonItemGroup.getObjectByName('AstronautThirdPersonItem-knife').visible).toBe(true);
        expect(ally.astronaut.thirdPersonWeaponGroup.visible).toBe(false);
        // Sem novos pacotes, a ação deve terminar em vez de deixar o objeto preso na mão.
        for (let i = 0; i < 20; i++) tickSlide();
        expect(ally.astronaut.thirdPersonItemGroup.visible).toBe(false);
        expect(ally.astronaut.thirdPersonWeaponGroup.visible).toBe(true);
        // Pacote antigo não ressuscita uma ação encerrada.
        const lastItemTs = ally.lastItemPoseTs;
        (coordinator as any).handleRemotePose({ ...slidePose, id: 'guest-chat-t', name: 'ENGENHEIRO', ts: lastItemTs - 1, quickItemAction: { kind: 'knife', progress: 0.1 } });
        expect(ally.quickItemAction).toBeNull();
        // Pacotes de versões antigas apagam a arma/ação; a teia comum permite a animação de corte.
        guestClient.broadcastPlayerPose({ ...legacyPose, ensnared: true, quickItemAction: { kind: 'knife', progress: 0.2, mode: 'use' } });
        await new Promise((r) => setTimeout(r, 35));
        tickSlide();
        expect(ally.astronaut.thirdPersonItemGroup.visible).toBe(true);
        guestClient.broadcastPlayerPose({ ...legacyPose, cocoonLocked: true, ensnared: true, quickItemAction: { kind: 'knife', progress: 0.2 } });
        await new Promise((r) => setTimeout(r, 35));
        tickSlide();
        expect(ally.astronaut.thirdPersonItemGroup.visible).toBe(false);
        guestClient.broadcastPlayerPose(legacyPose);
        await new Promise((r) => setTimeout(r, 35));
        expect(ally.quickItemAction).toBeNull();
        expect(ally.heldWeapon).toBeNull();

        guestClient.broadcastPlayerPose({
          x: allyWorldPos.x,
          y: 0,
          z: allyWorldPos.z,
          yaw: 0,
          pitch: 0,
          speed: 0,
          bobPhase: 0,
          crouch: 0,
          flashlightOn: false,
          flashDirX: 0,
          flashDirY: 0,
          flashDirZ: -1,
          health: 60,
          bleeding: true,
          ensnared: false,
          inSequence: true,
          beingDragged: false,
          abductionMode: 'STRIKE_ATTACK',
          abductionProgress: 0.35,
          abductionSpiderX: spiderWorldPos.x,
          abductionSpiderY: spiderWorldPos.y,
          abductionSpiderZ: spiderWorldPos.z,
          cocoonLocked: false,
          dead: false,
        });
        await new Promise((r) => setTimeout(r, 35));

        coordinator.update(
          0.016,
          2.0,
          camTest,
          {
            pos: new THREE.Vector3(10, 0, 10),
            yaw: 0,
            pitch: 0,
            speed: 0,
            bobPhase: 0,
            crouch: 0,
            flashlightOn: true,
            flashDir: new THREE.Vector3(0, 0, -1),
            health: 100,
            bleeding: false,
            ensnared: false,
            inSequence: false,
            dead: false,
          },
          {
            x: spiderWorldPos.x,
            y: spiderWorldPos.y,
            z: spiderWorldPos.z,
            upX: 0,
            upY: 1,
            upZ: 0,
            fwdX: 0,
            fwdY: 0,
            fwdZ: -1,
            state: 'POUNCE',
            surfaceMode: 'FLOOR',
          },
          false
        );

        const captureBanner = viewportEl.children.find((c) =>
          c.className.includes('oof-coop-capture-banner')
        )!;
        expect(captureBanner).toBeDefined();
        expect(captureBanner.className).toContain('phase-capturing');
        expect(captureBanner.children[0].textContent).toContain(
          'ESTÁ SENDO CAPTURADO'
        );
        expect(captureBanner.children[1].textContent).toContain(
          'TENTE GOLPEAR A ARANHA'
        );
        expect(
          coordinator.hasTrappedAllyInRescueRange(
            new THREE.Vector3(10, 0, 10),
            spiderWorldPos,
            true
          )
        ).toBe(true);

        // Jogador tenta golpear a Aranha: NÃO liberta o amigo (JÁ ERA!) e muda o banner para phase-doomed!
        const rescuedMidCapture = coordinator.tryRescueNearbyTrappedAlly(
          new THREE.Vector3(10, 0, 10),
          spiderWorldPos,
          true
        );
        expect(rescuedMidCapture).toBe(false);
        expect(coordinator.getActiveRemoteAbduction()).not.toBeNull();

        coordinator.update(
          0.016,
          2.1,
          camTest,
          {
            pos: new THREE.Vector3(10, 0, 10),
            yaw: 0,
            pitch: 0,
            speed: 0,
            bobPhase: 0,
            crouch: 0,
            flashlightOn: true,
            flashDir: new THREE.Vector3(0, 0, -1),
            health: 100,
            bleeding: false,
            ensnared: false,
            inSequence: false,
            dead: false,
          },
          {
            x: spiderWorldPos.x,
            y: spiderWorldPos.y,
            z: spiderWorldPos.z,
            upX: 0,
            upY: 1,
            upZ: 0,
            fwdX: 0,
            fwdY: 0,
            fwdZ: -1,
            state: 'POUNCE',
            surfaceMode: 'FLOOR',
          },
          false
        );
        expect(captureBanner.className).toContain('phase-doomed');
        expect(captureBanner.children[0].textContent).toContain('JÁ ERA');
        expect(captureBanner.children[1].textContent).toContain('NINHO');

        // Agora a Aranha chegou ao NINHO e depositou o amigo no casulo (cocoonLocked: true, inSequence: false) ->
        // SOMENTE LÁ NO NINHO o resgate funciona!
        const nestPos = new THREE.Vector3(42, 0, 69);
        guestClient.broadcastPlayerPose({
          x: nestPos.x,
          y: 0,
          z: nestPos.z,
          yaw: 0,
          pitch: 0,
          speed: 0,
          bobPhase: 0,
          crouch: 0,
          flashlightOn: false,
          flashDirX: 0,
          flashDirY: 0,
          flashDirZ: -1,
          health: 22,
          bleeding: true,
          ensnared: true,
          inSequence: false,
          beingDragged: false,
          abductionMode: null,
          abductionProgress: 0,
          cocoonLocked: true,
          devourSecondsLeft: 40,
          dead: false,
        });
        await new Promise((r) => setTimeout(r, 35));

        coordinator.update(
          0.5,
          3.0,
          camTest,
          {
            pos: new THREE.Vector3(41, 0, 69),
            yaw: 0,
            pitch: 0,
            speed: 0,
            bobPhase: 0,
            crouch: 0,
            flashlightOn: true,
            flashDir: new THREE.Vector3(0, 0, -1),
            health: 100,
            bleeding: false,
            ensnared: false,
            inSequence: false,
            dead: false,
          },
          {
            x: 10,
            y: 0,
            z: 10,
            upX: 0,
            upY: 1,
            upZ: 0,
            fwdX: 0,
            fwdY: 0,
            fwdZ: -1,
            state: 'PATROL',
            surfaceMode: 'FLOOR',
          },
          false
        );
        expect(captureBanner.className).toContain('phase-nest-rescue');
        expect(captureBanner.children[0].textContent).toContain('NINHO');

        const savedAtNest = coordinator.tryRescueNearbyTrappedAlly(
          new THREE.Vector3(41, 0, 69),
          new THREE.Vector3(10, 0, 10),
          true
        );
        expect(savedAtNest).toBe(true);
        await new Promise((r) => setTimeout(r, 35));
        expect(
          receivedEvents.some((ev) => ev.kind === 'rescue_ally')
        ).toBe(true);
      }

      coordinator.destroy();
      guestClient.disconnect();
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });

  it('mantém nós DOM de itens estáveis sem cliques múltiplos no hover e aciona atalhos pela rolinha + botão esquerdo sem precisar das teclas 1, 2 e 3', () => {
    interface InvMockEl {
      tagName: string;
      id: string;
      className: string;
      textContent: string;
      title: string;
      width: number;
      height: number;
      dataset: Record<string, string>;
      style: Record<string, string>;
      attrs: Map<string, string>;
      children: InvMockEl[];
      parent: InvMockEl | null;
      listeners: Map<string, Array<(ev: Record<string, unknown>) => void>>;
      classList: {
        add: (...tokens: string[]) => void;
        remove: (...tokens: string[]) => void;
        toggle: (token: string, force?: boolean) => boolean;
        contains: (token: string) => boolean;
      };
      appendChild: (child: InvMockEl) => InvMockEl;
      remove: () => void;
      querySelector: (selector: string) => InvMockEl | null;
      querySelectorAll: (selector: string) => InvMockEl[];
      addEventListener: (
        type: string,
        cb: (ev: Record<string, unknown>) => void
      ) => void;
      dispatch: (type: string, extra?: Record<string, unknown>) => void;
      getBoundingClientRect: () => {
        x: number;
        y: number;
        left: number;
        top: number;
        width: number;
        height: number;
      };
      getContext: (kind: string) => Record<string, unknown>;
      toDataURL: () => string;
      innerHTML: string;
    }

    const matchesSingleSelector = (node: InvMockEl, sel: string): boolean => {
      const s = sel.trim();
      if (!s) return false;
      const attrValMatch = /^\[([a-z0-9-]+)="([^"]*)"\]$/i.exec(s);
      if (attrValMatch) {
        const [, attrName, expected] = attrValMatch;
        if (attrName.startsWith('data-')) {
          const camel = attrName
            .slice(5)
            .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
          if (node.dataset[camel] === expected) return true;
        }
        return node.attrs.get(attrName) === expected;
      }
      const attrOnlyMatch = /^\[([a-z0-9-]+)\]$/i.exec(s);
      if (attrOnlyMatch) {
        const attrName = attrOnlyMatch[1];
        if (attrName.startsWith('data-')) {
          const camel = attrName
            .slice(5)
            .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
          if (camel in node.dataset) return true;
        }
        return node.attrs.has(attrName);
      }
      if (s.startsWith('.')) {
        const parts = s
          .replace(/:not\([^)]*\)/g, '')
          .split('.')
          .filter(Boolean);
        return parts.every((cls) => node.classList.contains(cls));
      }
      return false;
    };

    const makeEl = (tag: string): InvMockEl => {
      const classes = new Set<string>();
      let html = '';
      const imgBuf = new Uint8ClampedArray(384 * 240 * 4);
      const ctx2d = {
        fillStyle: '#000',
        strokeStyle: '#000',
        clearRect: () => {},
        fillRect: () => {},
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        createImageData: (w: number, h: number) => ({
          data: imgBuf.subarray(0, w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: () => {},
        setTransform: () => {},
        save: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillText: () => {},
      };

      const el: InvMockEl = {
        tagName: tag.toUpperCase(),
        id: '',
        get className() {
          return Array.from(classes).join(' ');
        },
        set className(val: string) {
          classes.clear();
          for (const t of val.split(/\s+/).filter(Boolean)) classes.add(t);
        },
        textContent: '',
        title: '',
        width: 32,
        height: 32,
        dataset: {},
        style: {},
        attrs: new Map(),
        children: [],
        parent: null,
        listeners: new Map(),
        classList: {
          add: (...tokens) => tokens.forEach((t) => classes.add(t)),
          remove: (...tokens) => tokens.forEach((t) => classes.delete(t)),
          toggle: (token, force) => {
            const next = force ?? !classes.has(token);
            if (next) classes.add(token);
            else classes.delete(token);
            return next;
          },
          contains: (token) => classes.has(token),
        },
        appendChild(child: InvMockEl) {
          child.parent = el;
          el.children.push(child);
          return child;
        },
        remove() {
          if (!el.parent) return;
          const idx = el.parent.children.indexOf(el);
          if (idx >= 0) el.parent.children.splice(idx, 1);
          el.parent = null;
        },
        querySelector(selector: string): InvMockEl | null {
          return el.querySelectorAll(selector)[0] ?? null;
        },
        querySelectorAll(selector: string): InvMockEl[] {
          const groups = selector.split(',').map((g) => g.trim());
          const out: InvMockEl[] = [];
          const visit = (node: InvMockEl) => {
            for (const c of node.children) {
              if (groups.some((g) => matchesSingleSelector(c, g))) {
                out.push(c);
              }
              visit(c);
            }
          };
          visit(el);
          return out;
        },
        addEventListener(type, cb) {
          const arr = el.listeners.get(type) ?? [];
          arr.push(cb);
          el.listeners.set(type, arr);
        },
        dispatch(type, extra = {}) {
          const ev = {
            type,
            preventDefault: () => {},
            stopPropagation: () => {},
            ...extra,
          };
          for (const cb of el.listeners.get(type) ?? []) cb(ev);
        },
        getBoundingClientRect: () => ({
          x: 10,
          y: 10,
          left: 10,
          top: 10,
          width: 80,
          height: 80,
        }),
        getContext: () => ctx2d,
        toDataURL: () => 'data:image/png;base64,AA==',
        get innerHTML() {
          return html;
        },
        set innerHTML(val: string) {
          html = val;
          el.children.length = 0;
          const tagRe = /<([a-z0-9]+)\b([^>]*)>/gi;
          let match: RegExpExecArray | null;
          while ((match = tagRe.exec(val)) !== null) {
            const tagName = match[1];
            const attrsRaw = match[2];
            const clsMatch = /\bclass="([^"]*)"/i.exec(attrsRaw);
            const dataAttrRe = /\b(data-[a-z0-9-]+)(?:="([^"]*)")?/gi;
            const foundData: Array<[string, string]> = [];
            let dm: RegExpExecArray | null;
            while ((dm = dataAttrRe.exec(attrsRaw)) !== null) {
              foundData.push([dm[1], dm[2] ?? '']);
            }
            if (clsMatch || foundData.length > 0) {
              const child = makeEl(tagName);
              if (clsMatch) child.className = clsMatch[1];
              for (const [k, v] of foundData) {
                child.attrs.set(k, v);
                const camel = k
                  .slice(5)
                  .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
                child.dataset[camel] = v;
              }
              el.appendChild(child);
            }
          }
        },
      };
      return el;
    };

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;
    const viewportEl = makeEl('div');

    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => makeEl(tag),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as Record<string, unknown>).window = {
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 1,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (() => 1) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as unknown as typeof cancelAnimationFrame;

    try {
      const sound = new SoundEngine();
      let hoverSelectCalls = 0;
      let clickSelectCalls = 0;
      vi.spyOn(sound, 'playInventorySelect').mockImplementation((confirm) => {
        if (confirm) clickSelectCalls++;
        else hoverSelectCalls++;
      });

      let knifeUsedCount = 0;
      let taserToggleCount = 0;
      let healUsedCount = 0;
      let flareUsedCount = 0;

      const inv = new DoomInventory(
        viewportEl as unknown as HTMLElement,
        sound,
        {
          onToggleFlashlightFromUI: () => {},
          onUseHeal: () => {
            healUsedCount++;
            return true;
          },
          onUseBattery: () => true,
          onUseFlare: () => {
            flareUsedCount++;
            return true;
          },
          onToggleTaser: () => { taserToggleCount++; },
          onUseKnife: () => {
            knifeUsedCount++;
            return { cutWeb: true };
          },
          onCloseRequest: () => {},
          onPermanentDeathTerminate: () => {},
        }
      );

      // Coleta itens que preenchem automaticamente os atalhos [1], [2] e [3]!
      inv.addItem('rusty_knife', 1, true); // -> [1]
      inv.addItem('sterile_bandage', 2, true); // -> [2]
      inv.addItem('magnesium_flare', 1, true); // -> [3]
      expect(inv.getQuickSlots()).toEqual([
        'rusty_knife',
        'sterile_bandage',
        'magnesium_flare',
      ]);

      // ----------------------------------------------------------------------
      // PARTE 1: Estabilidade total no Hover (zero cliques repetidos a 60fps!)
      // ----------------------------------------------------------------------
      inv.setOpen(true);
      hoverSelectCalls = 0;
      clickSelectCalls = 0;

      const gridEl = viewportEl.querySelector('[data-inv-grid]')!;
      const quickRowEl = viewportEl.querySelector('[data-quick-row]')!;
      expect(gridEl.children.length).toBe(20);
      expect(quickRowEl.children.length).toBe(3);

      const knifePocketNodeBefore = gridEl.children[1];
      const quickSlot0NodeBefore = quickRowEl.children[0];

      // Passa o cursor sobre o canivete no bolso (sem clicar!)
      knifePocketNodeBefore.dispatch('mouseenter');
      expect(hoverSelectCalls).toBe(1);
      expect(clickSelectCalls).toBe(0);

      // Disparo espúrio extra de mouseenter sem mouseleave NUNCA repete som!
      knifePocketNodeBefore.dispatch('mouseenter');
      expect(hoverSelectCalls).toBe(1);

      // Simula 120 quadros (2 segundos a 60fps) de updateVitalsAndDiegeticFX enquanto o mouse repousa no item!
      for (let f = 0; f < 120; f++) {
        inv.updateVitalsAndDiegeticFX({
          health: 85 - (f % 3) * 0.1,
          sanity: 90,
          battery: 78,
          flashlightEquipped: true,
          radarActive: false,
          trappedInWeb: false,
          bleeding: false,
          crouching: false,
          beingChased: false,
        });
      }

      // Os nós DOM permanecem EXATAMENTE a mesma instância e o som de hover continua em 1 (nunca metralha cliques!)
      expect(gridEl.children[1]).toBe(knifePocketNodeBefore);
      expect(quickRowEl.children[0]).toBe(quickSlot0NodeBefore);
      expect(hoverSelectCalls).toBe(1);
      expect(clickSelectCalls).toBe(0);

      // Passar o cursor na HUB inferior também mantém o nó DOM intacto!
      inv.setOpen(false);
      const hubBarEl = viewportEl.querySelector('[data-hub-bar]')!;
      const hubQuick0Before = hubBarEl.querySelector('[data-hub-quick="0"]')!;
      hubQuick0Before.dispatch('mouseenter');
      const hubQuick0After = hubBarEl.querySelector('[data-hub-quick="0"]')!;
      expect(hubQuick0After).toBe(hubQuick0Before);
      expect(hubQuick0After.classList.contains('selected')).toBe(true);

      // ----------------------------------------------------------------------
      // PARTE 2: Rolinha do mouse + Botão Esquerdo aciona atalhos sem teclas 1, 2, 3!
      // ----------------------------------------------------------------------
      inv.clearWheelQuickSlotSelection();
      expect(inv.hasWheelSelectedQuickSlot()).toBe(false);

      // 1º giro da rolinha -> seleciona [1] Canivete oxidado
      expect(inv.cycleQuickSlotSelection(1)).toBe(0);
      expect(inv.hasWheelSelectedQuickSlot()).toBe(true);
      expect(inv.isWheelSelectionRecent()).toBe(true);

      // Clique com botão esquerdo -> usa imediatamente o Canivete sem apertar '1'!
      expect(inv.useWheelSelectedQuickSlot()).toBe(true);
      expect(knifeUsedCount).toBe(1);
      // Ferramenta reutilizável permanece armada na janela ativa para cortar outra teia se clicar de novo
      expect(inv.hasWheelSelectedQuickSlot()).toBe(true);

      // 2º giro da rolinha -> avança para [2] Rolo de gaze (×2)
      expect(inv.cycleQuickSlotSelection(1)).toBe(1);
      expect(inv.getSelectedQuickSlot()).toBe(1);

      // Clique com botão esquerdo -> aplica 1 Rolo de gaze sem apertar '2' e desarma para não desperdiçar a 2ª unidade!
      expect(inv.useWheelSelectedQuickSlot()).toBe(true);
      expect(healUsedCount).toBe(1);
      expect(inv.hasWheelSelectedQuickSlot()).toBe(false);
      expect(inv.useWheelSelectedQuickSlot()).toBe(false);
      expect(healUsedCount).toBe(1);

      // Girar para [3] Bastão de magnésio e cancelar com botão direito não consome o item!
      inv.cycleQuickSlotSelection(1); // -> [1]
      inv.cycleQuickSlotSelection(1); // -> [2]
      expect(inv.cycleQuickSlotSelection(1)).toBe(2); // -> [3]
      expect(inv.hasWheelSelectedQuickSlot()).toBe(true);
      inv.clearWheelQuickSlotSelection();
      expect(inv.hasWheelSelectedQuickSlot()).toBe(false);
      expect(flareUsedCount).toBe(0);

      // Montagem exige todas as peças e transforma os quatro itens em uma arma.
      const internals = inv as unknown as {
        slots: Array<{ def: { id: string } } | null>;
        activateSlotItem(index: number, quick: boolean): boolean;
      };
      inv.addItem(SHOTGUN_PART_IDS[0], 1, true);
      const partIndex = internals.slots.findIndex(slot => slot?.def.id === SHOTGUN_PART_IDS[0]);
      expect(internals.activateSlotItem(partIndex, false)).toBe(false);
      expect(inv.hasItem(SHOTGUN_ITEM_ID)).toBe(false);
      for (const id of SHOTGUN_PART_IDS.slice(1)) inv.addItem(id, 1, true);
      expect(canAssembleShotgun(id => inv.hasItem(id))).toBe(true);
      expect(internals.activateSlotItem(partIndex, false)).toBe(true);
      expect(inv.hasItem(SHOTGUN_ITEM_ID)).toBe(true);
      expect(SHOTGUN_PART_IDS.every(id => !inv.hasItem(id))).toBe(true);
      expect(inv.consumeItemById(SHOTGUN_AMMO_ITEM_ID)).toBe(false);
      expect(inv.addItem(SHOTGUN_AMMO_ITEM_ID, 8, true)).toBe(true);
      expect(inv.consumeItemById(SHOTGUN_AMMO_ITEM_ID)).toBe(true);
      expect(inv.getItemCount(SHOTGUN_AMMO_ITEM_ID)).toBe(7);
      expect(inv.addItem(TASER_ITEM_ID, 1, true)).toBe(true);
      expect(inv.addItem(TASER_ITEM_ID, 1, true)).toBe(false);
      const taserSlot = internals.slots.findIndex(slot => slot?.def.id === TASER_ITEM_ID);
      expect(internals.activateSlotItem(taserSlot, false)).toBe(true);
      expect(taserToggleCount).toBe(1);
      expect(inv.hasItem(TASER_ITEM_ID)).toBe(true);

      inv.destroy();
    } finally {
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCaf;
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });
});

describe('Botão de Pausa no HUD, Tela de Pausa Completa & 26 Configurações Reais', () => {
  it('define 26 opções reais (>= 20) em 5 categorias com sanitização segura, persistência em localStorage e restauração de padrões', () => {
    expect(DOOM_SETTINGS_DESCRIPTORS.length).toBe(26);
    expect(DOOM_SETTINGS_DESCRIPTORS.length).toBeGreaterThanOrEqual(20);
    expect(SETTINGS_CATEGORIES.map((c) => c.id)).toEqual([
      'video',
      'audio',
      'controls',
      'gameplay',
      'interface',
    ]);

    const seenKeys = new Set<string>();
    for (const desc of DOOM_SETTINGS_DESCRIPTORS) {
      expect(seenKeys.has(desc.key)).toBe(false);
      seenKeys.add(desc.key);
      expect(desc.key in DEFAULT_DOOM_SETTINGS).toBe(true);
      if (desc.kind === 'range') {
        const defVal = DEFAULT_DOOM_SETTINGS[desc.key] as number;
        expect(defVal).toBeGreaterThanOrEqual(desc.min);
        expect(defVal).toBeLessThanOrEqual(desc.max);
      } else if (desc.kind === 'choice') {
        const defVal = String(DEFAULT_DOOM_SETTINGS[desc.key]);
        expect(desc.choices.some((c) => c.value === defVal)).toBe(true);
      } else {
        expect(typeof DEFAULT_DOOM_SETTINGS[desc.key]).toBe('boolean');
      }
    }
    expect(seenKeys.size).toBe(Object.keys(DEFAULT_DOOM_SETTINGS).length);

    expect(resolutionPresetToHeight('180p')).toBe(180);
    expect(resolutionPresetToHeight('250p')).toBe(250);
    expect(resolutionPresetToHeight('480p')).toBe(480);
    expect(resolutionPresetToHeight('720p')).toBe(720);

    const sanitized = sanitizeDoomSettings({
      fov: 999 as unknown as number,
      masterVolume: -50 as unknown as number,
      resolutionHeight: '8k' as unknown as '250p',
      showCrosshair: 'laser' as unknown as 'dot',
      invertMouseY: true,
    });
    expect(sanitized.fov).toBe(105);
    expect(sanitized.masterVolume).toBe(0);
    expect(sanitized.resolutionHeight).toBe('250p');
    expect(sanitized.showCrosshair).toBe('dot');
    expect(sanitized.invertMouseY).toBe(true);

    const prevStorage = (globalThis as Record<string, unknown>).localStorage;
    const mem = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
      removeItem: (k: string) => mem.delete(k),
    };

    try {
      const store = new DoomSettingsStore();
      let notifications = 0;
      const unsub = store.subscribe(() => {
        notifications++;
      });

      store.set('fov', 92);
      store.set('crtScanlines', 'strong');
      store.set('crouchMode', 'toggle');
      expect(notifications).toBe(3);
      expect(store.value.fov).toBe(92);
      expect(mem.has(DOOM_SETTINGS_STORAGE_KEY)).toBe(true);

      // Recarregar de localStorage recupera exatamente as opções salvas
      const reloaded = new DoomSettingsStore();
      expect(reloaded.value.fov).toBe(92);
      expect(reloaded.value.crtScanlines).toBe('strong');
      expect(reloaded.value.crouchMode).toBe('toggle');

      store.resetToDefaults();
      expect(store.value).toEqual(DEFAULT_DOOM_SETTINGS);
      unsub();
    } finally {
      (globalThis as Record<string, unknown>).localStorage = prevStorage;
    }
  });

  it('conecta resolução interna, pós-processamento GLSL, mão dominante (destro/canhoto sem inverter normais) e head-bob diretamente na engine', () => {
    const comp = new DoomRetroCompositor(1280, 720);
    expect(comp.getResolution().height).toBe(250);

    comp.setTargetHeight(480, 1280, 720);
    expect(comp.getResolution().height).toBe(480);
    expect(comp.getResolution().width).toBe(Math.round(480 * (1280 / 720)));

    comp.setPostFXOptions({
      brightness: 1.35,
      contrast: 1.15,
      ditherMode: false,
      scanlineIntensity: 0.24,
    });
    comp.dispose();

    const fl = new DoomFlashlight(16 / 9);
    fl.toggle();
    for (let i = 0; i < 40; i++) {
      fl.update(1 / 60, i * 0.2, 5.2, () => {}, 0, 100, 0);
    }
    let rightHandX = 0;
    fl.viewScene.traverse((obj) => {
      if (obj.parent === fl.viewScene && obj.visible && Math.abs(obj.position.x) > 0.05) {
        rightHandX = obj.position.x;
      }
    });
    expect(rightHandX).toBeGreaterThan(0);

    fl.setHandedness('left');
    fl.setHeadBobMultiplier(0);
    fl.update(1 / 60, 1.5, 5.2, () => {}, 0, 100, 0);

    let leftHandX = 0;
    let anyNegativeScale = false;
    fl.viewScene.traverse((obj) => {
      if (obj.scale.x < 0 || obj.scale.y < 0 || obj.scale.z < 0) {
        anyNegativeScale = true;
      }
      if (obj.parent === fl.viewScene && obj.visible && Math.abs(obj.position.x) > 0.05) {
        leftHandX = obj.position.x;
      }
    });
    expect(leftHandX).toBeLessThan(0);
    expect(anyNegativeScale).toBe(false);
  });

  it('monta o Botão de Pausa visível no HUD, abre a Tela de Pausa com 26 opções interativas sem recriar DOM no hover e confirma Reiniciar/Sair em 2 cliques', () => {
    interface PauseMockEl {
      tagName: string;
      id: string;
      type?: string;
      title?: string;
      min?: string;
      max?: string;
      step?: string;
      value: string;
      className: string;
      textContent: string;
      dataset: Record<string, string>;
      style: Record<string, string>;
      attrs: Map<string, string>;
      children: PauseMockEl[];
      parent: PauseMockEl | null;
      listeners: Map<string, Array<(ev: unknown) => void>>;
      classList: {
        add: (...tokens: string[]) => void;
        remove: (...tokens: string[]) => void;
        toggle: (token: string, force?: boolean) => boolean;
        contains: (token: string) => boolean;
      };
      appendChild: (child: PauseMockEl) => PauseMockEl;
      remove: () => void;
      setAttribute: (k: string, v: string) => void;
      querySelector: (selector: string) => PauseMockEl | null;
      querySelectorAll: (selector: string) => PauseMockEl[];
      addEventListener: (type: string, cb: (ev: unknown) => void) => void;
      dispatch: (type: string, extra?: Record<string, unknown>) => void;
      getBoundingClientRect: () => {
        x: number;
        y: number;
        left: number;
        top: number;
        width: number;
        height: number;
      };
      getContext: () => Record<string, unknown>;
      innerHTML: string;
    }

    const ctx2d = {
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      setTransform: () => {},
      fillText: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
    };

    const matchesSingleSelector = (
      node: PauseMockEl,
      sel: string
    ): boolean => {
      if (!sel) return false;
      if (sel.startsWith('#')) return node.id === sel.slice(1);
      if (sel.startsWith('.')) {
        return sel
          .slice(1)
          .split('.')
          .every((cls) => node.classList.contains(cls));
      }
      const attrMatch = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(sel);
      if (attrMatch) {
        const [, attrName, attrVal] = attrMatch;
        if (!node.attrs.has(attrName)) return false;
        return attrVal === undefined || node.attrs.get(attrName) === attrVal;
      }
      return node.tagName.toLowerCase() === sel.toLowerCase();
    };

    const makeEl = (tag: string): PauseMockEl => {
      const classes = new Set<string>();
      let html = '';
      const el: PauseMockEl = {
        tagName: tag.toUpperCase(),
        id: '',
        value: '',
        get className() {
          return Array.from(classes).join(' ');
        },
        set className(v: string) {
          classes.clear();
          v.split(/\s+/)
            .filter(Boolean)
            .forEach((c) => classes.add(c));
        },
        textContent: '',
        dataset: {},
        style: {},
        attrs: new Map(),
        children: [],
        parent: null,
        listeners: new Map(),
        classList: {
          add: (...tokens) => tokens.forEach((t) => classes.add(t)),
          remove: (...tokens) => tokens.forEach((t) => classes.delete(t)),
          toggle: (token, force) => {
            const next = force ?? !classes.has(token);
            if (next) classes.add(token);
            else classes.delete(token);
            return next;
          },
          contains: (token) => classes.has(token),
        },
        appendChild(child: PauseMockEl) {
          child.parent = el;
          el.children.push(child);
          return child;
        },
        remove() {
          if (!el.parent) return;
          const idx = el.parent.children.indexOf(el);
          if (idx >= 0) el.parent.children.splice(idx, 1);
          el.parent = null;
        },
        setAttribute(k: string, v: string) {
          el.attrs.set(k, v);
          if (k.startsWith('data-')) {
            const camel = k
              .slice(5)
              .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            el.dataset[camel] = v;
          }
        },
        querySelector(selector: string): PauseMockEl | null {
          return el.querySelectorAll(selector)[0] ?? null;
        },
        querySelectorAll(selector: string): PauseMockEl[] {
          const groups = selector.split(',').map((g) => g.trim());
          const out: PauseMockEl[] = [];
          const visit = (node: PauseMockEl) => {
            for (const c of node.children) {
              if (groups.some((g) => matchesSingleSelector(c, g))) {
                out.push(c);
              }
              visit(c);
            }
          };
          visit(el);
          return out;
        },
        addEventListener(type, cb) {
          const arr = el.listeners.get(type) ?? [];
          arr.push(cb);
          el.listeners.set(type, arr);
        },
        dispatch(type, extra = {}) {
          const ev = {
            type,
            preventDefault: () => {},
            stopPropagation: () => {},
            ...extra,
          };
          for (const cb of el.listeners.get(type) ?? []) cb(ev);
        },
        getBoundingClientRect: () => ({
          x: 12,
          y: 12,
          left: 12,
          top: 12,
          width: 120,
          height: 36,
        }),
        getContext: () => ctx2d,
        get innerHTML() {
          return html;
        },
        set innerHTML(val: string) {
          html = val;
          el.children.length = 0;
          const tagRe = /<([a-z0-9]+)\b([^>]*)>/gi;
          let match: RegExpExecArray | null;
          while ((match = tagRe.exec(val)) !== null) {
            const tagName = match[1];
            const attrsRaw = match[2];
            const clsMatch = /\bclass="([^"]*)"/i.exec(attrsRaw);
            const dataAttrRe = /\b(data-[a-z0-9-]+)(?:="([^"]*)")?/gi;
            const foundData: Array<[string, string]> = [];
            let dm: RegExpExecArray | null;
            while ((dm = dataAttrRe.exec(attrsRaw)) !== null) {
              foundData.push([dm[1], dm[2] ?? '']);
            }
            if (clsMatch || foundData.length > 0) {
              const child = makeEl(tagName);
              if (clsMatch) child.className = clsMatch[1];
              for (const [k, v] of foundData) {
                child.setAttribute(k, v);
              }
              el.appendChild(child);
            }
          }
        },
      };
      return el;
    };

    const prevWindow = (globalThis as Record<string, unknown>).window;
    const prevDocument = (globalThis as Record<string, unknown>).document;
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCaf = globalThis.cancelAnimationFrame;

    (globalThis as Record<string, unknown>).window = {
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 1,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => makeEl(tag),
      pointerLockElement: null,
      exitPointerLock: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};

    try {
      const viewportEl = makeEl('div');
      const store = new DoomSettingsStore();

      let hoverSounds = 0;
      let pauseOpenedCount = 0;
      let resumeCount = 0;
      let restartCount = 0;
      let exitCount = 0;
      let fullscreenCount = 0;

      const mockSound = {
        playInventoryToggle: vi.fn(),
        playInventorySelect: (confirm?: boolean) => {
          if (!confirm) hoverSounds++;
        },
      };

      const pauseMenu = new DoomPauseMenu(
        viewportEl as unknown as HTMLElement,
        store,
        mockSound as never,
        {
          onPauseOpened: () => {
            pauseOpenedCount++;
          },
          onResumeRequest: () => {
            resumeCount++;
            pauseMenu.setOpen(false);
          },
          onToggleFullscreen: () => {
            fullscreenCount++;
          },
          onRestartSessionRequest: () => {
            restartCount++;
          },
          onExitToDesktopRequest: () => {
            exitCount++;
          },
        }
      );

      // Não há botão de pausa na HUD; o menu fechado não trata sozinho a tecla Esc.
      expect(viewportEl.querySelector('#doom-pause-trigger-btn')).toBeNull();
      expect(pauseMenu.open).toBe(false);
      pauseMenu.handleEscapeOrBack();
      expect(pauseMenu.open).toBe(false);
      expect(pauseOpenedCount).toBe(0);

      // O controlador do jogo abre o menu por Esc, P ou pelo inventário.
      pauseMenu.setOpen(true);
      expect(pauseMenu.open).toBe(true);
      expect(pauseOpenedCount).toBe(1);

      // 2. Navegar para Configurações exibe exatamente as 26 linhas persistentes
      const openSettingsBtn = viewportEl.querySelector(
        '[data-pause-action="open-settings"]'
      )!;
      openSettingsBtn.dispatch('click');
      expect(pauseMenu.subView).toBe('settings');

      const rowsBefore = viewportEl.querySelectorAll('.setting-row');
      expect(rowsBefore.length).toBe(26);
      const firstRowRef = rowsBefore[0];
      const firstSegBtn = firstRowRef.querySelector('.setting-seg-btn')!;
      expect(firstSegBtn).not.toBeNull();

      // Hover no botão interativo toca som apenas 1 vez; alterar valores NÃO recria nós DOM!
      const hoverCountBefore = hoverSounds;
      firstSegBtn.dispatch('mouseenter');
      firstSegBtn.dispatch('mouseenter');
      expect(hoverSounds).toBe(hoverCountBefore + 1);

      // Clicar na opção "180p" altera imediatamente o store sem recriar os elementos!
      firstSegBtn.dispatch('click');
      expect(store.value.resolutionHeight).toBe('180p');

      store.set('fov', 90);
      store.set('masterVolume', 55);
      store.set('showFpsCounter', true);
      const rowsAfter = viewportEl.querySelectorAll('.setting-row');
      expect(rowsAfter[0]).toBe(firstRowRef);
      expect(rowsAfter[0].querySelector('.setting-seg-btn')).toBe(firstSegBtn);
      expect(hoverSounds).toBe(hoverCountBefore + 1);

      // 3. Esc dentro de Configurações volta ao Menu Principal; 2º Esc retoma o jogo!
      pauseMenu.handleEscapeOrBack();
      expect(pauseMenu.open).toBe(true);
      expect(pauseMenu.subView).toBe('main');
      expect(resumeCount).toBe(0);

      pauseMenu.handleEscapeOrBack();
      expect(resumeCount).toBe(1);
      expect(pauseMenu.open).toBe(false);

      // 4. Confirmação segura em 2 cliques para Reiniciar e Sair + Tela Cheia direta
      pauseMenu.setOpen(true);
      viewportEl.querySelector('[data-pause-action="fullscreen"]')!.dispatch('click');
      expect(fullscreenCount).toBe(1);

      const restartBtn = viewportEl.querySelector('[data-pause-action="restart"]')!;
      restartBtn.dispatch('click');
      expect(restartCount).toBe(0);
      expect(restartBtn.classList.contains('confirm-armed')).toBe(true);
      restartBtn.dispatch('click');
      expect(restartCount).toBe(1);

      const exitBtn = viewportEl.querySelector('[data-pause-action="exit"]')!;
      exitBtn.dispatch('click');
      expect(exitCount).toBe(0);
      expect(exitBtn.classList.contains('confirm-armed')).toBe(true);
      exitBtn.dispatch('click');
      expect(exitCount).toBe(1);

      pauseMenu.destroy();
    } finally {
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCaf;
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
    }
  });
});

describe('Obstáculos Táticos 3D no Mapa (Barris de Ferro, Madeira, Prateleiras, Caixotes, Barricadas & Vigas Arriadas)', () => {
  it('popula o mapa com mais de 95 obstáculos 3D sólidos variados, preserva passagens livres, permite agachar sob vigas e esconder-se da Aranha', () => {
    const layoutA = createRandomArenaLayout({ worldSeed: 777123, playerSeed: 101 });
    const layoutCoopMirror = createRandomArenaLayout({ worldSeed: 777123, playerSeed: 909 });
    const layoutDifferent = createRandomArenaLayout({ worldSeed: 444999, playerSeed: 101 });

    // 1. Densidade rica (>= 95 obstáculos) e sincronia 100% idêntica por worldSeed no Co-op
    expect(layoutA.obstaclePlacements.length).toBeGreaterThanOrEqual(95);
    expect(layoutCoopMirror.obstaclePlacements).toEqual(layoutA.obstaclePlacements);
    expect(layoutDifferent.obstaclePlacements).not.toEqual(layoutA.obstaclePlacements);

    const kindsPresent = new Set(layoutA.obstaclePlacements.map((o) => o.kind));
    expect(kindsPresent.has('iron_barrel_cluster')).toBe(true);
    expect(kindsPresent.has('wooden_barrel_cluster')).toBe(true);
    expect(kindsPresent.has('metal_shelving_rack')).toBe(true);
    expect(kindsPresent.has('wooden_shelving_rack')).toBe(true);
    expect(kindsPresent.has('wooden_crate_stack')).toBe(true);
    expect(kindsPresent.has('mixed_cargo_depot')).toBe(true);
    expect(kindsPresent.has('steel_barricade')).toBe(true);
    expect(kindsPresent.has('stone_rubble_barricade')).toBe(true);
    expect(kindsPresent.has('low_crawl_obstruction')).toBe(true);

    // 2. Constrói as malhas em lote e registra colisores físicos no labirinto
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(scene, textures, shared, layoutA);
    const items = new DoomWorldItems(scene, shared);

    const obstacleColliders = maze.colliders.filter((c) => c.isObstacle);
    expect(obstacleColliders.length).toBe(
      layoutA.obstaclePlacements.length +
        layoutA.roomFurniturePlacements.length
    );

    for (const meshName of [
      'MazeObstaclesIronBarrel',
      'MazeObstaclesOakWood',
      'MazeObstaclesWood',
      'MazeObstaclesMetal',
      'MazeObstaclesDarkIron',
      'MazeObstaclesStone',
    ]) {
      const m = scene.getObjectByName(meshName) as THREE.Mesh | undefined;
      expect(m).toBeDefined();
      expect(m!.geometry.getAttribute('position').count).toBeGreaterThan(24);
    }

    // 3. Nem o Spawn do Jogador nem os 25 Itens coletáveis colidem com obstáculos
    const spawnPos = layoutA.playerSpawnPosition.clone();
    const zeroVel = new THREE.Vector3();
    resolveCylinderWorldCollisions(spawnPos, zeroVel, 0.52, 1.8, obstacleColliders);
    expect(spawnPos.distanceTo(layoutA.playerSpawnPosition)).toBeLessThan(1e-4);

    for (const pickup of items.getPickupsSnapshot()) {
      for (const col of obstacleColliders) {
        if (col.isCrawlUnder) continue;
        expect(col.box.containsPoint(pickup.position)).toBe(false);
      }
    }

    // 4. Colisão sólida real contra barris/prateleiras + agachar/deslizar sob viga arriada!
    const barrelObs = layoutA.obstaclePlacements.find(
      (o) => o.kind === 'iron_barrel_cluster'
    )!;
    const testPos = new THREE.Vector3(barrelObs.worldX, 0, barrelObs.worldZ);
    const testVel = new THREE.Vector3();
    resolveCylinderWorldCollisions(testPos, testVel, 0.52, 1.8, obstacleColliders);
    expect(
      Math.hypot(testPos.x - barrelObs.worldX, testPos.z - barrelObs.worldZ)
    ).toBeGreaterThan(0.25);

    const crawlObs = layoutA.obstaclePlacements.find(
      (o) => o.kind === 'low_crawl_obstruction'
    )!;
    const crawlCol = obstacleColliders.find((c) => c.id === crawlObs.id)!;
    expect(crawlCol.isCrawlUnder).toBe(true);

    // Em pé (1.80m): bloqueado pela viga arriada!
    const standCrawlPos = new THREE.Vector3(crawlObs.worldX, 0, crawlObs.worldZ);
    resolveCylinderWorldCollisions(standCrawlPos, new THREE.Vector3(), 0.52, 1.8, [crawlCol]);
    expect(
      Math.hypot(
        standCrawlPos.x - crawlObs.worldX,
        standCrawlPos.z - crawlObs.worldZ
      )
    ).toBeGreaterThan(0.2);

    // Agachado / dando slide (1.05m): passa 100% livre por baixo da viga!
    const crouchCrawlPos = new THREE.Vector3(crawlObs.worldX, 0, crawlObs.worldZ);
    resolveCylinderWorldCollisions(crouchCrawlPos, new THREE.Vector3(), 0.52, 1.05, [crawlCol]);
    expect(crouchCrawlPos.x).toBeCloseTo(crawlObs.worldX, 5);
    expect(crouchCrawlPos.z).toBeCloseTo(crawlObs.worldZ, 5);

    // 5. Cobertura furtiva real: agachar atrás de um obstáculo bloqueia a linha de visão da Aranha!
    const webs = new DoomSpiderWebManager(scene, shared, layoutA);
    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderChitter: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;
    const spider = new DoomSpider(
      scene,
      shared,
      maze.colliders,
      webs,
      mockSound,
      layoutA
    );
    const spiderAny = spider as unknown as {
      hasLineOfSight: (
        from: THREE.Vector3,
        to: THREE.Vector3,
        crouching: boolean
      ) => boolean;
    };

    const islandBarrel = layoutA.obstaclePlacements.find(
      (o) =>
        o.role === 'island' &&
        (o.kind === 'iron_barrel_cluster' ||
          o.kind === 'wooden_barrel_cluster' ||
          o.kind === 'wooden_crate_stack')
    )!;
    const eyeFrom = new THREE.Vector3(
      islandBarrel.worldX,
      0.85,
      islandBarrel.minZ - 0.9
    );
    const hidingPlayer = new THREE.Vector3(
      islandBarrel.worldX,
      0,
      islandBarrel.maxZ + 0.9
    );
    expect(spiderAny.hasLineOfSight(eyeFrom, hidingPlayer, true)).toBe(false);
  });
});

describe('Salas Especiais 3D (Computadores, Lab Biológico, Quartos, Enfermaria, Vegetação, Biblioteca & Reatores)', () => {
  it('constrói todas as 7 Salas Especiais FORA do mapa 29x29 como salas novas anexas, com texturas próprias (parede, chão e teto), modelagem 3D aprimorada, portas transitáveis e navegação completa', () => {
    resetThemedRoomLocks();
    expect(THEMED_ROOMS.length).toBe(7);

    // 1. Verifica que TODAS as 7 salas são mini-mapas 7x7 FORA do mapa 29x29, isoladas entre si e TRANCADAS por padrão!
    for (const r of THEMED_ROOMS) {
      expect(r.maxGx - r.minGx).toBe(6);
      expect(r.maxGz - r.minGz).toBe(6);
      expect(r.miniMap.length).toBe(7);
      for (let gz = r.minGz; gz <= r.maxGz; gz++) {
        for (let gx = r.minGx; gx <= r.maxGx; gx++) {
          const outsideCore29x29 = gx < 0 || gx > 28 || gz < 0 || gz > 28;
          expect(outsideCore29x29).toBe(true);
          expect(getThemedRoomAtCell(gx, gz)?.id).toBe(r.id);
        }
      }
      expect(isThemedRoomDoorCell(r.doorGx, r.doorGz)).toBe(true);
      expect(isThemedRoomUnlocked(r.id)).toBe(false);
      expect(isWalkableArenaCell(r.doorGx, r.doorGz)).toBe(false);
      expect(isWalkableArenaCell(r.innerGx, r.innerGz)).toBe(true);
    }

    // Verifica coordenadas externas exatas + rótulos no Radar sem quebrar os setores clássicos internos
    expect(getThemedRoomAtCell(11, -3)?.id).toBe('computer_room');
    expect(getThemedRoomAtCell(25, -3)?.id).toBe('reactor_hall');
    expect(getThemedRoomAtCell(-3, 5)?.id).toBe('biology_lab');
    expect(getThemedRoomAtCell(-3, 12)?.id).toBe('crew_quarters');
    expect(getThemedRoomAtCell(31, 12)?.id).toBe('medical_ward');
    expect(getThemedRoomAtCell(31, 20)?.id).toBe('library_room');
    expect(getThemedRoomAtCell(6, 31)?.id).toBe('vegetation_room');
    // Dentro do mapa 29x29 NÃO há mais salas especiais recortadas de corredores!
    expect(getThemedRoomAtCell(12, 1)).toBeNull();
    expect(getThemedRoomAtCell(7, 4)).toBeNull();

    expect(getSectorNameForCell(11, -3)).toBe('SALA DOS COMPUTADORES');
    expect(getSectorNameForCell(-3, 5)).toBe('LABORATÓRIO BIOLÓGICO');
    expect(getSectorNameForCell(-3, 12)).toBe('QUARTOS DA EQUIPE');
    expect(getSectorNameForCell(31, 12)).toBe('ENFERMARIA & QUARENTENA');
    expect(getSectorNameForCell(6, 31)).toBe('SALA DE VEGETAÇÃO');
    expect(getSectorNameForCell(31, 20)).toBe('BIBLIOTECA & ARQUIVOS');
    expect(getSectorNameForCell(25, -3)).toBe('SALÃO DOS REATORES');
    expect(getSectorNameForCell(2, 1)).toBe('ESCLUSA NOROESTE');
    expect(getSectorNameForCell(14, 11)).toBe('ÁTRIO CENTRAL');
    expect(getSectorNameForCell(14, 23)).toBe('GRANDE NINHO SUL');

    // 2. Determinismo 100% no Co-op e presença de todos os 20 arquétipos de móveis 3D aprimorados fora do mapa
    const worldSeed = hashArenaSeed('oof-special-rooms-suite-v1');
    const hostLayout = createRandomArenaLayout({
      worldSeed,
      playerSeed: 1001,
    });
    const guestLayout = createRandomArenaLayout({
      worldSeed,
      playerSeed: 9009,
    });

    expect(hostLayout.roomFurniturePlacements.length).toBeGreaterThanOrEqual(55);
    expect(hostLayout.roomFurniturePlacements).toEqual(
      guestLayout.roomFurniturePlacements
    );
    for (const fp of hostLayout.roomFurniturePlacements) {
      expect(fp.gx < 0 || fp.gx > 28 || fp.gz < 0 || fp.gz > 28).toBe(true);
    }

    const roomsWithFurniture = new Set(
      hostLayout.roomFurniturePlacements.map((p) => p.roomId)
    );
    for (const r of THEMED_ROOMS) {
      expect(roomsWithFurniture.has(r.id)).toBe(true);
    }

    const furnitureKinds = new Set(
      hostLayout.roomFurniturePlacements.map((p) => p.kind)
    );
    for (const expectedKind of [
      'server_rack_bank',
      'crt_workstation_desk',
      'bio_specimen_tank',
      'autopsy_surgical_table',
      'xenobio_lab_bench',
      'cryo_biohazard_cabinet',
      'astronaut_bunk_bed',
      'crew_locker_bank',
      'crew_mess_table',
      'cabin_nightstand_desk',
      'medical_gurney_bed',
      'medical_supply_cabinet',
      'vitals_monitor_cart',
      'hydroponic_tree_planter',
      'botanical_fern_trough',
      'irrigation_nutrient_tank',
      'oak_bookshelf_tall',
      'library_reading_table',
      'archive_catalog_cabinet',
      'reactor_capacitor_console',
    ] as const) {
      expect(furnitureKinds.has(expectedKind)).toBe(true);
    }

    // 3. Constrói a cena 3D completa e valida as 3 NOVAS TEXTURAS EXCLUSIVAS (parede, chão e teto) + malhas 3D
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    expect(textures.annexWall).toBeDefined();
    expect(textures.annexFloor).toBeDefined();
    expect(textures.annexCeiling).toBeDefined();
    expect(textures.annexWall).not.toBe(textures.startanWall);
    expect(textures.annexFloor).not.toBe(textures.floorTile);
    expect(textures.annexCeiling).not.toBe(textures.ceilingGrate);

    const maze = buildDoomLabyrinth(scene, textures, shared, hostLayout);
    const items = new DoomWorldItems(scene, shared, hostLayout);
    expect(maze.annexLights.length).toBe(21);

    for (const [meshName, expectedTex, expectedLocalUv] of [
      ['MazeRoom_annexWall', textures.annexWall, 1],
      ['MazeRoom_annexFloor', textures.annexFloor, 0],
      ['MazeRoom_annexCeiling', textures.annexCeiling, 0],
    ] as const) {
      const mesh = scene.getObjectByName(meshName) as THREE.Mesh | undefined;
      expect(mesh).toBeDefined();
      expect(mesh!.geometry.getAttribute('position').count).toBeGreaterThan(24);
      const mat = mesh!.material as THREE.ShaderMaterial;
      expect(mat.uniforms.uMap.value).toBe(expectedTex);
      expect(mat.uniforms.uUseLocalUv.value).toBe(expectedLocalUv);
    }

    for (const roomMeshName of [
      'MazeRoom_serverRack',
      'MazeRoom_crtScreen',
      'MazeRoom_bookshelf',
      'MazeRoom_libraryRug',
      'MazeRoom_foliage',
      'MazeRoom_mossSoil',
      'MazeRoom_bioFluid',
      'MazeRoom_labTile',
      'MazeRoom_techFloor',
      'MazeRoom_bunkFabric',
      'MazeRoom_cleanLinen',
      'MazeRoom_medicalCross',
      'MazeRoom_warmLampGlow',
    ]) {
      const mesh = scene.getObjectByName(roomMeshName) as THREE.Mesh | undefined;
      expect(mesh).toBeDefined();
      expect(mesh!.geometry.getAttribute('position').count).toBeGreaterThan(12);
    }

    // 4. Comportas começam TRANCADAS bloqueando passagem; ao destrancar cada sala com sua chave, a passagem abre 100%!
    for (const r of THEMED_ROOMS) {
      const innerWorld = gridCellToWorld(r.innerGx, r.innerGz);
      const stepDx = r.doorGx - r.innerGx;
      const stepDz = r.doorGz - r.innerGz;
      const vestWorld = gridCellToWorld(r.doorGx + stepDx, r.doorGz + stepDz);

      // Enquanto trancada, a comporta blindada bloqueia fisicamente o avanço incremental!
      expect(maze.specialRoomDoors.isUnlocked(r.id)).toBe(false);
      const blockedWalk = new THREE.Vector3(innerWorld.x, 0, innerWorld.z);
      const incX = (vestWorld.x - innerWorld.x) / 24;
      const incZ = (vestWorld.z - innerWorld.z) / 24;
      for (let s = 1; s <= 24; s++) {
        blockedWalk.x += incX;
        blockedWalk.z += incZ;
        resolveCylinderWorldCollisions(
          blockedWalk,
          new THREE.Vector3(),
          0.52,
          1.8,
          maze.colliders
        );
      }
      expect(
        Math.hypot(blockedWalk.x - vestWorld.x, blockedWalk.z - vestWorld.z)
      ).toBeGreaterThan(2.5);

      // Destranca a sala especial específica e avança a abertura pneumática das folhas da porta!
      expect(maze.specialRoomDoors.unlockRoom(r.id)).toBe(true);
      maze.specialRoomDoors.update(1.0);
      expect(isWalkableArenaCell(r.doorGx, r.doorGz)).toBe(true);

      // Agora caminhar incrementalmente desde o corredor interno atravessando o pórtico até dentro da sala é 100% livre!
      const walkPos = new THREE.Vector3(innerWorld.x, 0, innerWorld.z);
      const totalSteps = 24;
      for (let s = 1; s <= totalSteps; s++) {
        walkPos.x += (vestWorld.x - innerWorld.x) / totalSteps;
        walkPos.z += (vestWorld.z - innerWorld.z) / totalSteps;
        resolveCylinderWorldCollisions(
          walkPos,
          new THREE.Vector3(),
          0.52,
          1.8,
          maze.colliders
        );
      }
      expect(
        Math.hypot(walkPos.x - vestWorld.x, walkPos.z - vestWorld.z)
      ).toBeLessThan(0.05);

      // E a parede de fundo externa (`room-arch-*`) bloqueia qualquer tentativa de sair para o vazio!
      const archColliders = maze.colliders.filter((c) =>
        c.id.startsWith('room-arch-')
      );
      const farGx = stepDx !== 0 ? (stepDx < 0 ? r.minGx : r.maxGx) : r.doorGx;
      const farGz = stepDz !== 0 ? (stepDz < 0 ? r.minGz : r.maxGz) : r.doorGz;
      const farWorld = gridCellToWorld(farGx, farGz);
      const tryEscape = new THREE.Vector3(
        farWorld.x + stepDx * 0.8,
        0,
        farWorld.z + stepDz * 0.8
      );
      for (let s = 0; s < 16; s++) {
        tryEscape.x += stepDx * 0.08;
        tryEscape.z += stepDz * 0.08;
        resolveCylinderWorldCollisions(
          tryEscape,
          new THREE.Vector3(),
          0.52,
          1.8,
          archColliders
        );
      }
      const distFromFarCellCenter =
        (tryEscape.x - farWorld.x) * stepDx +
        (tryEscape.z - farWorld.z) * stepDz;
      // Parede externa fica a 1.50m do centro da célula final -> cilindro de raio 0.52m para exatamente em ~0.98m!
      expect(distFromFarCellCenter).toBeLessThanOrEqual(1.02);
    }

    // 5. Zero sobreposição entre móveis de sala, 25 caixotes de itens, obstáculos de corredor e spawn
    const roomKeys = new Set(
      hostLayout.roomFurniturePlacements.map((p) => `${p.gx},${p.gz}`)
    );
    for (const c of hostLayout.cratePlacements) {
      expect(roomKeys.has(`${c.gx},${c.gz}`)).toBe(false);
    }
    for (const o of hostLayout.obstaclePlacements) {
      expect(roomKeys.has(`${o.gx},${o.gz}`)).toBe(false);
    }
    expect(
      roomKeys.has(
        `${hostLayout.playerSpawnCell.gx},${hostLayout.playerSpawnCell.gz}`
      )
    ).toBe(false);

    const roomColliders = maze.colliders.filter((c) =>
      c.id.startsWith('room-prop-')
    );
    expect(roomColliders.length).toBe(hostLayout.roomFurniturePlacements.length);

    for (const pickup of items.getPickupsSnapshot()) {
      for (const col of roomColliders) {
        expect(col.box.containsPoint(pickup.position)).toBe(false);
      }
    }

    // 6. Colisão contra a Mesa de Leitura, oclusão de visão e navegação da Aranha + Ragdoll dentro das Salas Externas!
    const readingTable = hostLayout.roomFurniturePlacements.find(
      (p) => p.kind === 'library_reading_table'
    )!;
    const playerAtTable = new THREE.Vector3(
      readingTable.worldX,
      0,
      readingTable.worldZ
    );
    resolveCylinderWorldCollisions(
      playerAtTable,
      new THREE.Vector3(),
      0.52,
      1.8,
      roomColliders
    );
    expect(
      Math.hypot(
        playerAtTable.x - readingTable.worldX,
        playerAtTable.z - readingTable.worldZ
      )
    ).toBeGreaterThan(0.35);

    const webs = new DoomSpiderWebManager(scene, shared, hostLayout);
    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderChitter: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
    } as unknown as SoundEngine;
    const spider = new DoomSpider(
      scene,
      shared,
      maze.colliders,
      webs,
      mockSound,
      hostLayout
    );
    const spiderAny = spider as unknown as {
      hasLineOfSight: (
        from: THREE.Vector3,
        to: THREE.Vector3,
        crouching: boolean
      ) => boolean;
      buildGridPathTo: (tx: number, tz: number) => void;
      pathWaypoints: Array<{ x: number; z: number }>;
    };

    const serverRack = hostLayout.roomFurniturePlacements.find(
      (p) => p.kind === 'server_rack_bank' && Math.abs(Math.sin(p.yaw)) > 0.7
    )!;
    const spiderEye = new THREE.Vector3(
      serverRack.worldX,
      1.1,
      serverRack.minZ - 0.5
    );
    const crouchedBehindRack = new THREE.Vector3(
      serverRack.worldX,
      0,
      serverRack.maxZ + 0.5
    );
    expect(spiderAny.hasLineOfSight(spiderEye, crouchedBehindRack, true)).toBe(
      false
    );

    // Aranha traça rota BFS desde dentro do labirinto até o coração da Biblioteca Anexa (31, 20)!
    const libCenter = gridCellToWorld(31, 20);
    spiderAny.buildGridPathTo(libCenter.x, libCenter.z);
    expect(spiderAny.pathWaypoints.length).toBeGreaterThan(3);
    const finalWp = spiderAny.pathWaypoints[spiderAny.pathWaypoints.length - 1];
    expect(Math.hypot(finalWp.x - libCenter.x, finalWp.z - libCenter.z)).toBeLessThan(0.1);

    // E o arrasto físico em Ragdoll acha caminho desde dentro da Sala dos Computadores (11, -3) até o Ninho!
    const compWorld = gridCellToWorld(11, -3);
    const lairWorld = gridCellToWorld(hostLayout.lairCell.gx, hostLayout.lairCell.gz);
    const dragFromAnnex = computeWalkableDragPolyline(
      new THREE.Vector3(compWorld.x, 0, compWorld.z),
      new THREE.Vector3(lairWorld.x, 0, lairWorld.z)
    );
    expect(dragFromAnnex.totalLength).toBeGreaterThan(25);
    resetThemedRoomLocks();
  });
});

describe('Correção Integral de Pausa, Áudio WebAudio & Botão de Pausa no Inventário [Tab]', () => {
  it('preserva volumes 0..100% sem dupla divisão, silencia 100% da masmorra durante Pausa mantendo UI viva e abre a Pausa pelo botão dentro do [Tab]', () => {
    const makeAudioParam = (initial = 1) => {
      const param = {
        value: initial,
        cancelCalls: 0,
        targetCalls: [] as Array<{ value: number; timeConstant: number }>,
        cancelScheduledValues() {
          param.cancelCalls++;
          return param;
        },
        setValueAtTime(v: number) {
          param.value = v;
          return param;
        },
        linearRampToValueAtTime(v: number) {
          param.value = v;
          return param;
        },
        exponentialRampToValueAtTime(v: number) {
          param.value = v;
          return param;
        },
        setTargetAtTime(v: number, _time: number, timeConstant: number) {
          param.value = v;
          param.targetCalls.push({ value: v, timeConstant });
          return param;
        },
      };
      return param;
    };

    let createdOscCount = 0;
    class FakeAudioContext {
      state: AudioContextState = 'running';
      currentTime = 1.0;
      sampleRate = 44100;
      destination = {};
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      createGain() {
        return {
          gain: makeAudioParam(1),
          connect: () => {},
          disconnect: () => {},
        };
      }
      createDynamicsCompressor() {
        return {
          threshold: makeAudioParam(-15),
          knee: makeAudioParam(14),
          ratio: makeAudioParam(3.6),
          attack: makeAudioParam(0.003),
          release: makeAudioParam(0.16),
          connect: () => {},
          disconnect: () => {},
        };
      }
      createWaveShaper() {
        return {
          curve: null as Float32Array | null,
          oversample: 'none',
          connect: () => {},
          disconnect: () => {},
        };
      }
      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: makeAudioParam(1000),
          Q: makeAudioParam(1),
          gain: makeAudioParam(0),
          connect: () => {},
          disconnect: () => {},
        };
      }
      createConvolver() {
        return {
          buffer: null,
          connect: () => {},
          disconnect: () => {},
        };
      }
      createStereoPanner() {
        return {
          pan: makeAudioParam(0),
          connect: () => {},
          disconnect: () => {},
        };
      }
      createOscillator() {
        createdOscCount++;
        return {
          type: 'sine',
          frequency: makeAudioParam(440),
          detune: makeAudioParam(0),
          connect: () => {},
          disconnect: () => {},
          start: () => {},
          stop: () => {},
        };
      }
      createBuffer(_ch: number, len: number, sr: number) {
        const arr = new Float32Array(Math.max(1, len));
        return {
          sampleRate: sr,
          length: arr.length,
          getChannelData: () => arr,
        };
      }
      createBufferSource() {
        return {
          buffer: null,
          loop: false,
          playbackRate: makeAudioParam(1),
          connect: () => {},
          disconnect: () => {},
          start: () => {},
          stop: () => {},
        };
      }
    }

    interface UiMockEl {
      tagName: string;
      id: string;
      className: string;
      textContent: string;
      value?: string;
      type?: string;
      disabled?: boolean;
      dataset: Record<string, string>;
      style: Record<string, string>;
      attrs: Map<string, string>;
      children: UiMockEl[];
      parent: UiMockEl | null;
      listeners: Map<string, Array<(e: unknown) => void>>;
      classList: {
        add: (...t: string[]) => void;
        remove: (...t: string[]) => void;
        toggle: (t: string, force?: boolean) => boolean;
        contains: (t: string) => boolean;
      };
      appendChild: (c: UiMockEl) => UiMockEl;
      remove: () => void;
      contains: (other: UiMockEl | null) => boolean;
      blur: () => void;
      setAttribute: (k: string, v: string) => void;
      querySelector: (sel: string) => UiMockEl | null;
      querySelectorAll: (sel: string) => UiMockEl[];
      addEventListener: (t: string, cb: (e: unknown) => void) => void;
      dispatch: (t: string, extra?: Record<string, unknown>) => void;
      getBoundingClientRect: () => {
        x: number;
        y: number;
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
      };
      getContext: () => Record<string, unknown>;
      toDataURL: () => string;
      innerHTML: string;
    }

    const ctx2d = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      save: () => {},
      restore: () => {},
      scale: () => {},
      translate: () => {},
      setTransform: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      createImageData: (w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: () => {},
    };

    const matchesSingle = (node: UiMockEl, rawSel: string): boolean => {
      const sel = rawSel.trim().replace(/:not\(:disabled\)/g, '');
      if (!sel) return false;
      if (sel.startsWith('#')) return node.id === sel.slice(1);
      const attrMatch = /^\[([a-z0-9-]+)(?:=['"]?([^'"\]]*)['"]?)?\]$/i.exec(
        sel
      );
      if (attrMatch) {
        const [, k, expected] = attrMatch;
        if (!node.attrs.has(k)) return false;
        return expected === undefined || node.attrs.get(k) === expected;
      }
      if (sel.startsWith('.')) {
        const parts = sel.slice(1).split('.');
        return parts.every((p) => node.classList.contains(p));
      }
      return node.tagName.toLowerCase() === sel.toLowerCase();
    };

    const makeEl = (tag: string): UiMockEl => {
      const classes = new Set<string>();
      let html = '';
      const el: UiMockEl = {
        tagName: tag.toUpperCase(),
        id: '',
        get className() {
          return Array.from(classes).join(' ');
        },
        set className(v: string) {
          classes.clear();
          v.split(/\s+/)
            .filter(Boolean)
            .forEach((c) => classes.add(c));
        },
        textContent: '',
        dataset: {},
        style: {},
        attrs: new Map(),
        children: [],
        parent: null,
        listeners: new Map(),
        classList: {
          add: (...tokens) => tokens.forEach((t) => classes.add(t)),
          remove: (...tokens) => tokens.forEach((t) => classes.delete(t)),
          toggle: (token, force) => {
            const next = force ?? !classes.has(token);
            if (next) classes.add(token);
            else classes.delete(token);
            return next;
          },
          contains: (token) => classes.has(token),
        },
        appendChild(child) {
          child.parent = el;
          el.children.push(child);
          return child;
        },
        remove() {
          if (!el.parent) return;
          const idx = el.parent.children.indexOf(el);
          if (idx >= 0) el.parent.children.splice(idx, 1);
          el.parent = null;
        },
        contains(other) {
          let cur: UiMockEl | null = other;
          while (cur) {
            if (cur === el) return true;
            cur = cur.parent;
          }
          return false;
        },
        blur() {},
        setAttribute(k, v) {
          el.attrs.set(k, v);
          if (k.startsWith('data-')) {
            const camel = k
              .slice(5)
              .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            el.dataset[camel] = v;
          }
        },
        querySelector(selector) {
          return el.querySelectorAll(selector)[0] ?? null;
        },
        querySelectorAll(selector) {
          const groups = selector.split(',').map((g) => g.trim());
          const out: UiMockEl[] = [];
          const visit = (n: UiMockEl) => {
            for (const c of n.children) {
              if (groups.some((g) => matchesSingle(c, g))) out.push(c);
              visit(c);
            }
          };
          visit(el);
          return out;
        },
        addEventListener(type, cb) {
          const arr = el.listeners.get(type) ?? [];
          arr.push(cb);
          el.listeners.set(type, arr);
        },
        dispatch(type, extra = {}) {
          const ev = {
            type,
            preventDefault: () => {},
            stopPropagation: () => {},
            ...extra,
          };
          for (const cb of el.listeners.get(type) ?? []) cb(ev);
        },
        getBoundingClientRect: () => ({
          x: 20,
          y: 20,
          left: 20,
          top: 20,
          right: 140,
          bottom: 56,
          width: 120,
          height: 36,
        }),
        getContext: () => ctx2d,
        toDataURL: () => 'data:image/png;base64,AA==',
        get innerHTML() {
          return html;
        },
        set innerHTML(val: string) {
          html = val;
          el.children.length = 0;
          const tagRe = /<([a-z0-9]+)\b([^>]*)>/gi;
          let m: RegExpExecArray | null;
          while ((m = tagRe.exec(val)) !== null) {
            const tagName = m[1];
            const attrsRaw = m[2];
            const clsMatch = /\bclass="([^"]*)"/i.exec(attrsRaw);
            const idMatch = /\bid="([^"]*)"/i.exec(attrsRaw);
            const dataRe = /\b(data-[a-z0-9-]+)(?:="([^"]*)")?/gi;
            const foundData: Array<[string, string]> = [];
            let dm: RegExpExecArray | null;
            while ((dm = dataRe.exec(attrsRaw)) !== null) {
              foundData.push([dm[1], dm[2] ?? '']);
            }
            if (clsMatch || idMatch || foundData.length > 0) {
              const child = makeEl(tagName);
              if (idMatch) child.id = idMatch[1];
              if (clsMatch) child.className = clsMatch[1];
              for (const [k, v] of foundData) child.setAttribute(k, v);
              el.appendChild(child);
            }
          }
        },
      };
      return el;
    };

    const prevWin = (globalThis as Record<string, unknown>).window;
    const prevDoc = (globalThis as Record<string, unknown>).document;
    const prevRaf = globalThis.requestAnimationFrame;
    const prevCaf = globalThis.cancelAnimationFrame;

    (globalThis as Record<string, unknown>).window = {
      AudioContext: FakeAudioContext,
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 1,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => makeEl(tag),
      pointerLockElement: null,
      fullscreenElement: null,
      activeElement: null,
      exitPointerLock: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};

    try {
      const sound = new SoundEngine();
      sound.unlock();
      sound.setUserAudioSettings({
        masterVolume: 85,
        sfxVolume: 80,
        uiVolume: 75,
        reverbAmount: 65,
      });

      const g0 = sound.debugGainState;
      expect(g0.masterGain).toBeCloseTo(0.85, 2);
      expect(g0.sfxGain).toBeCloseTo(0.8, 2);
      expect(g0.uiGain).toBeCloseTo(0.75, 2);
      expect(g0.effectiveWorldDryGain).toBeCloseTo(0.8, 2);
      expect(g0.effectiveUiGain).toBeCloseTo(0.75, 2);
      expect(g0.reverbSendGain).toBeCloseTo(0.65 * 0.68, 2);
      expect(g0.effectiveReverbSendGain).toBeCloseTo(0.65 * 0.68, 2);

      // Entrar no labirinto preserva o masterVolume do usuário em vez de cravar 0.82!
      sound.enterDoomLabyrinth();
      expect(sound.debugGainState.masterGain).toBeCloseTo(0.85, 2);
      // Um único grafo procedural é reutilizado nas mudanças de sala.
      const ambient = sound as unknown as {
        ambientOscA: { frequency: { value: number; targetCalls: Array<{ value: number; timeConstant: number }> } };
        ambientNoiseGain: { gain: { value: number } };
        ambientZone: string | null;
        dungeonBus: { gain: { value: number } };
        dungeonPendingActivation: boolean;
        ctx: FakeAudioContext;
      };
      const ambientOsc = ambient.ambientOscA;
      const oscillatorCount = createdOscCount;
      sound.setDoomAmbientZone('computer_room');
      expect(ambient.ambientZone).toBe('computer_room');
      expect(ambientOsc.frequency.value).toBe(60);
      expect(ambientOsc.frequency.targetCalls.at(-1)?.timeConstant).toBe(1.2);
      const scheduledCount = ambientOsc.frequency.targetCalls.length;
      sound.setDoomAmbientZone('computer_room');
      expect(ambientOsc.frequency.targetCalls.length).toBe(scheduledCount);
      sound.setDoomAmbientZone('library_room');
      expect(ambientOsc.frequency.value).toBe(38);
      expect(ambient.ambientNoiseGain.gain.value).toBe(0.007);
      expect(createdOscCount).toBe(oscillatorCount);

      // Pausar o mundo em Solo zera 100% do barramento da masmorra e do envio de reverb,
      // bloqueia passos/aranha, mas mantém os sons de UI da Pausa vivos!
      sound.setWorldPaused(true);
      const gPaused = sound.debugGainState;
      expect(gPaused.worldPaused).toBe(true);
      expect(gPaused.effectiveWorldDryGain).toBeLessThanOrEqual(0.001);
      expect(gPaused.effectiveReverbSendGain).toBeLessThanOrEqual(0.001);
      expect(gPaused.effectiveUiGain).toBeCloseTo(0.75, 2);

      const oscBeforeFootstep = createdOscCount;
      sound.playLabyrinthFootstep(true, 'stone', true, false, false);
      expect(createdOscCount).toBe(oscBeforeFootstep);

      sound.playPauseToggle(true);
      expect(createdOscCount).toBeGreaterThan(oscBeforeFootstep);

      // Despausar restaura imediatamente os ganhos exatos do usuário!
      sound.setWorldPaused(false);
      const gResumed = sound.debugGainState;
      expect(gResumed.worldPaused).toBe(false);
      expect(gResumed.effectiveWorldDryGain).toBeCloseTo(0.8, 2);
      expect(gResumed.effectiveReverbSendGain).toBeCloseTo(0.65 * 0.68, 2);

      // Monta Inventário [Tab] + Menu de Pausa no mesmo viewport:
      // 1) Zero IDs duplicados #tui-proximity-canvas (ambos usam classe .tui-proximity-canvas)
      // 2) Clicar em "Menu de Pausa [P]" dentro do [Tab] fecha o inventário silenciosamente e abre a Pausa!
      const viewportEl = makeEl('div');
      const store = new DoomSettingsStore();
      let pauseClosedCount = 0;
      let lastResumePointerFlag: boolean | undefined;

      const pauseMenu = new DoomPauseMenu(
        viewportEl as unknown as HTMLElement,
        store,
        sound,
        {
          onPauseOpened: () => {
            sound.setWorldPaused(true);
          },
          onPauseClosed: () => {
            pauseClosedCount++;
            sound.setWorldPaused(false);
          },
          onResumeRequest: (fromPointer) => {
            lastResumePointerFlag = fromPointer;
            pauseMenu.setOpen(false);
          },
          onToggleFullscreen: () => {},
          onRestartSessionRequest: () => {},
          onExitToDesktopRequest: () => {},
        }
      );

      const inv = new DoomInventory(
        viewportEl as unknown as HTMLElement,
        sound,
        {
          onToggleFlashlightFromUI: () => {},
          onUseHeal: () => false,
          onUseBattery: () => false,
          onUseFlare: () => false,
          onUseKnife: () => ({ cutWeb: false }),
          onCloseRequest: () => {
            inv.setOpen(false);
          },
          onOpenPauseRequest: () => {
            inv.setOpen(false, true);
            pauseMenu.setOpen(true, 'main');
          },
          onPermanentDeathTerminate: () => {},
        }
      );

      expect(viewportEl.querySelectorAll('#tui-proximity-canvas').length).toBe(
        0
      );
      expect(viewportEl.querySelectorAll('.tui-proximity-canvas').length).toBe(
        2
      );

      // Abre o inventário [Tab] e clica no novo botão "Menu de Pausa [P]"!
      inv.setOpen(true);
      expect(inv.open).toBe(true);
      expect(pauseMenu.open).toBe(false);

      const tabPauseBtn = viewportEl.querySelector('[data-inv-open-pause]');
      expect(tabPauseBtn).not.toBeNull();
      tabPauseBtn!.dispatch('click');

      expect(inv.open).toBe(false);
      expect(pauseMenu.open).toBe(true);
      expect(sound.debugGainState.worldPaused).toBe(true);

      // Clicar em Retomar pelo mouse repassa fromPointerGesture = true; Esc repassa false
      const resumeBtn = viewportEl.querySelector(
        '[data-pause-action="resume"]'
      )!;
      resumeBtn.dispatch('click');
      expect(lastResumePointerFlag).toBe(true);
      expect(pauseMenu.open).toBe(false);
      expect(pauseClosedCount).toBe(1);
      expect(sound.debugGainState.worldPaused).toBe(false);

      // Botão [✕] superior da Pausa também fecha limpamente
      pauseMenu.setOpen(true);
      const closeXBtn = viewportEl.querySelector('[data-pause-close]');
      expect(closeXBtn).not.toBeNull();
      closeXBtn!.dispatch('click');
      expect(pauseMenu.open).toBe(false);
      expect(lastResumePointerFlag).toBe(true);

      // Tecla Esc no menu principal repassa fromPointerGesture = false
      pauseMenu.setOpen(true);
      pauseMenu.handleEscapeOrBack();
      expect(pauseMenu.open).toBe(false);
      expect(lastResumePointerFlag).toBe(false);

      inv.destroy();
      pauseMenu.destroy();
      sound.stopDungeonAtmosphere();
      expect(ambient.ambientZone).toBeNull();
      sound.setDoomAmbientZone('reactor_hall');
      expect(ambient.ambientZone).toBeNull();
      sound.enterDoomLabyrinth();
      const oscillatorsAfterRestart = createdOscCount;
      sound.setDoomAmbientZone('reactor_hall');
      expect(ambient.ambientOscA).toBe(ambientOsc);
      expect(createdOscCount).toBe(oscillatorsAfterRestart);
      expect(ambient.ambientZone).toBe('reactor_hall');
      sound.stopDungeonAtmosphere();
      // Reentrar com AudioContext ainda suspenso recupera o barramento assim que desbloqueia.
      ambient.ctx.state = 'suspended';
      ambient.ctx.resume = () => Promise.resolve();
      sound.enterDoomLabyrinth();
      expect(ambient.dungeonPendingActivation).toBe(true);
      ambient.ctx.state = 'running';
      sound.setDoomAmbientZone('biology_lab');
      expect(ambient.dungeonPendingActivation).toBe(false);
      expect(ambient.dungeonBus.gain.value).toBe(1);
      expect(ambient.ambientOscA).toBe(ambientOsc);
      sound.stopDungeonAtmosphere();
    } finally {
      (globalThis as Record<string, unknown>).window = prevWin;
      (globalThis as Record<string, unknown>).document = prevDoc;
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCaf;
    }
  });
});

describe('Ragdoll Verlet 3D Desmaiado, 4 Tentáculos da Aranha & Casulo de Teia Multiplayer', () => {
  it('simula queda e arrasto físico em Ragdoll pelos corredores com 4 Tentáculos 3D da Aranha e prende o jogador na Teia em Co-op até resgate', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const tex = createDoomTextures();
    const layout = createRandomArenaLayout({
      worldSeed: hashArenaSeed('RAGDOLL-TENTACLES-COOP'),
      playerSeed: 77,
    });
    const maze = buildDoomLabyrinth(scene, tex, shared, layout);
    const webs = new DoomSpiderWebManager(scene, shared, layout);

    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderChitter: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
      playWebTrapSnap: () => {},
      playWebCut: () => {},
    } as unknown as SoundEngine;

    const spider = new DoomSpider(
      scene,
      shared,
      maze.colliders,
      webs,
      mockSound,
      layout
    );
    const spiderRoot = scene.getObjectByName('EvilCrawlingSpider')!;
    // Garante que os tentáculos ficam em espaço de mundo na cena (sem alterar os 9 filhos anatômicos de spiderRoot!)
    expect(spiderRoot.children.length).toBe(9);
    const tentaclesRoot = scene.getObjectByName('SpiderCaptureTentacles');
    expect(tentaclesRoot).not.toBeNull();
    expect(tentaclesRoot!.children.length).toBe(4);

    const astronaut = new DoomAstronaut(scene, shared);

    const startPos = layout.playerSpawnPosition.clone().setY(0);
    const spiderStrikePos = new THREE.Vector3(startPos.x, 1.38, startPos.z - 1.15);

    const ragdoll = new AstronautRagdoll();
    ragdoll.spawnFromStandingAndCollapse(startPos, 0, spiderStrikePos);
    expect(ragdoll.isActive).toBe(true);

    // 1. Queda física de nocaute + captura pelos 4 Tentáculos da Aranha
    for (let i = 0; i < 20; i++) {
      const u = (i + 1) / 20;
      ragdoll.stepKnockoutCollapse(0.05, spiderStrikePos, u, maze.colliders);
      astronaut.applyRagdollPose(ragdoll, false);
      spider.updateCinematicSequence(
        0.05,
        i * 0.05,
        'STRIKE_ATTACK',
        u,
        spiderStrikePos,
        startPos,
        ragdoll.pelvisPos,
        ragdoll.getTentacleAttachmentPoints()
      );
    }

    expect(astronaut.root.visible).toBe(true);
    expect(tentaclesRoot!.visible).toBe(true);
    for (const p of ragdoll.particles) {
      expect(Number.isFinite(p.pos.x)).toBe(true);
      expect(Number.isFinite(p.pos.y)).toBe(true);
      expect(Number.isFinite(p.pos.z)).toBe(true);
      expect(p.pos.y).toBeGreaterThan(0.02);
    }

    // 2. Arrasto pelos corredores reais até o Ninho de Teia + câmera segura contra paredes
    const dragPath = computeWalkableDragPolyline(startPos, webs.lairCenter);
    expect(dragPath.points.length).toBeGreaterThanOrEqual(2);
    expect(dragPath.totalLength).toBeGreaterThan(1.0);

    const pathPt = new THREE.Vector3();
    const pathTan = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();

    for (let step = 0; step <= 12; step++) {
      const u = step / 12;
      sampleDragPolyline(dragPath, u * dragPath.totalLength, pathPt, pathTan);
      const spPos = new THREE.Vector3(
        pathPt.x + pathTan.x * 1.65,
        1.38,
        pathPt.z + pathTan.z * 1.65
      );
      ragdoll.stepTentacleDrag(0.06, spPos, pathPt, 0.8, maze.colliders);
      astronaut.applyRagdollPose(ragdoll, u > 0.5);
      spider.updateCinematicSequence(
        0.06,
        1 + step * 0.06,
        'DRAGGING_TO_WEB',
        u,
        spPos,
        pathPt,
        ragdoll.pelvisPos,
        ragdoll.getTentacleAttachmentPoints()
      );
      computeCollisionSafeRagdollCamera(
        ragdoll,
        spPos,
        maze.colliders,
        camPos,
        lookTarget
      );
      expect(Number.isFinite(camPos.x)).toBe(true);
      expect(Number.isFinite(camPos.y)).toBe(true);
      expect(Number.isFinite(camPos.z)).toBe(true);
    }

    // 3. Ergendo e prendendo o Ragdoll na Teia do Ninho + retração limpa dos tentáculos ao sair
    const spiderOverLair = new THREE.Vector3(
      webs.lairCenter.x + webs.dragDirection.x * 1.15,
      1.36,
      webs.lairCenter.z + webs.dragDirection.z * 1.15
    );
    ragdoll.stepWebPlacementLift(
      0.08,
      webs.lairCenter,
      spiderOverLair,
      0.85,
      maze.colliders
    );
    spider.updateCinematicSequence(
      0.08,
      2.2,
      'WEBBING_IN_LAIR',
      0.85,
      spiderOverLair,
      webs.lairCenter,
      ragdoll.pelvisPos,
      ragdoll.getTentacleAttachmentPoints()
    );
    expect(tentaclesRoot!.visible).toBe(true);

    spider.ensureExitedCinematic([startPos]);
    expect(tentaclesRoot!.visible).toBe(false);

    // 4. Em Multiplayer Co-op, o jogador preso na Teia do Ninho fica 100% imobilizado até um aliado salvá-lo!
    webs.placePlayerInWakingLairWeb(true);
    expect(webs.isPlayerEnsnared).toBe(true);
    expect(webs.isLockedInMultiplayerCocoon).toBe(true);

    const lockedStep = webs.update(
      0.1,
      webs.lairCenter,
      true,
      true,
      mockSound,
      () => {}
    );
    expect(lockedStep.speedMultiplier).toBe(0);
    expect(
      webs.slashWebWithKnife(
        webs.lairCenter,
        new THREE.Vector3(0, 0, -1),
        mockSound
      ).cutActiveSnare
    ).toBe(false);
    expect(webs.isLockedInMultiplayerCocoon).toBe(true);

    // Quando um amigo corta a teia (clearEnsnarement), o jogador é libertado imediatamente!
    webs.clearEnsnarement();
    expect(webs.isLockedInMultiplayerCocoon).toBe(false);
    expect(webs.isPlayerEnsnared).toBe(false);
    const freedStep = webs.update(
      0.1,
      webs.lairCenter,
      false,
      false,
      mockSound,
      () => {}
    );
    expect(freedStep.speedMultiplier).toBeGreaterThan(0.95);
  });

  it('mapeia UVs locais métricas e cilíndricas sem esticar nem projetar textura de parede nos obstáculos 3D', () => {
    const textures = createDoomTextures();
    expect(textures.cratePlanks).toBeDefined();
    expect(textures.cratePlanks.image.width).toBe(128);
    expect(textures.cratePlanks.image.height).toBe(128);

    // 1. weatheredWood não deve ter cintas pretas assadas nas extremidades X (tiling contínuo!)
    const woodData = textures.weatheredWood.image.data as Uint8Array;
    let edgeSum = 0;
    let edgeCount = 0;
    let midSum = 0;
    let midCount = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const idx = (y * 128 + x) * 4;
        const lum = (woodData[idx] + woodData[idx + 1] + woodData[idx + 2]) / 3;
        if (x < 7 || x >= 121) {
          edgeSum += lum;
          edgeCount++;
        } else if (x >= 48 && x < 80) {
          midSum += lum;
          midCount++;
        }
      }
    }
    const edgeAvg = edgeSum / edgeCount;
    const midAvg = midSum / midCount;
    expect(Math.abs(edgeAvg - midAvg)).toBeLessThan(12);

    // 2. applyMetricBoxUvs elimina esticamento em vigas finas/altas e respeita alignLongAxis
    const postGeo = new THREE.BoxGeometry(0.06, 2.1, 0.06);
    applyMetricBoxUvs(postGeo, 0.06, 2.1, 0.06, {
      metersPerTile: 0.9,
      alignLongAxis: true,
    });
    const postUv = postGeo.getAttribute('uv');
    let maxPostU = 0;
    let maxPostV = 0;
    for (let i = 0; i < postUv.count; i++) {
      maxPostU = Math.max(maxPostU, postUv.getX(i));
      maxPostV = Math.max(maxPostV, postUv.getY(i));
    }
    // Com alignLongAxis = true, os veios correm ao longo dos 2.1m (U ~ 2.33) e a espessura 0.06m usa V ~ 0.067
    expect(maxPostU).toBeCloseTo(2.1 / 0.9, 3);
    expect(maxPostV).toBeCloseTo(0.06 / 0.9, 3);

    const crateInnerGeo = new THREE.BoxGeometry(0.7, 0.75, 0.62);
    applyMetricBoxUvs(crateInnerGeo, 0.7, 0.75, 0.62, {
      metersPerTile: 0.72,
      alignLongAxis: false,
    });
    const crateUv = crateInnerGeo.getAttribute('uv');
    let maxCrateV = 0;
    for (let i = 0; i < crateUv.count; i++) {
      maxCrateV = Math.max(maxCrateV, crateUv.getY(i));
    }
    expect(maxCrateV).toBeCloseTo(0.75 / 0.72, 3);

    // 3. applyMetricCylinderUvs envolve cascos abertos sem costuras e projeta tampas planares sem pinçamento
    const drumShell = new THREE.CylinderGeometry(0.265, 0.265, 0.92, 12, 1, true);
    applyMetricCylinderUvs(drumShell, 0.265, 0.265, 0.92, {
      openEnded: true,
      uRepeat: 1,
      vMin: 0,
      vMax: 1,
    });
    const shellUv = drumShell.getAttribute('uv');
    let shellMaxU = 0;
    let shellMaxV = 0;
    for (let i = 0; i < shellUv.count; i++) {
      shellMaxU = Math.max(shellMaxU, shellUv.getX(i));
      shellMaxV = Math.max(shellMaxV, shellUv.getY(i));
    }
    expect(shellMaxU).toBeCloseTo(1, 3);
    expect(shellMaxV).toBeCloseTo(1, 3);

    // 4. Todas as 7 malhas consolidadas de obstáculos do labirinto usam uUseLocalUv = 1 e UVs finitas
    const scene = new THREE.Scene();
    const sharedUniforms = createDoomSharedUniforms();
    const maze = buildDoomLabyrinth(scene, textures, sharedUniforms);
    expect(maze.arenaLayout.obstaclePlacements.length).toBe(138);

    const obstacleMeshNames = [
      'MazeObstaclesIronBarrel',
      'MazeObstaclesOakWood',
      'MazeObstaclesCrateWood',
      'MazeObstaclesWood',
      'MazeObstaclesMetal',
      'MazeObstaclesDarkIron',
      'MazeObstaclesStone',
    ];

    for (const name of obstacleMeshNames) {
      const mesh = scene.getObjectByName(name) as THREE.Mesh | undefined;
      expect(mesh).toBeDefined();
      const mat = mesh!.material as THREE.ShaderMaterial;
      expect(mat.uniforms.uUseLocalUv.value).toBe(1);

      const pos = mesh!.geometry.getAttribute('position');
      const uv = mesh!.geometry.getAttribute('uv');
      expect(pos.count).toBeGreaterThan(24);
      expect(uv.count).toBe(pos.count);
      for (let i = 0; i < uv.count; i++) {
        expect(Number.isFinite(uv.getX(i))).toBe(true);
        expect(Number.isFinite(uv.getY(i))).toBe(true);
      }
    }

    // 5. Mobiliário estrutural das salas temáticas também usa UVs métricas sem esticamento 0..1
    for (const roomMeshName of [
      'MazeRoom_oakWood',
      'MazeRoom_weatheredWood',
      'MazeRoom_metalTrim',
      'MazeRoom_darkIron',
    ]) {
      const mesh = scene.getObjectByName(roomMeshName) as THREE.Mesh | undefined;
      expect(mesh).toBeDefined();
      const mat = mesh!.material as THREE.ShaderMaterial;
      expect(mat.uniforms.uUseLocalUv.value).toBe(1);
      const uv = mesh!.geometry.getAttribute('uv');
      let maxU = 0;
      for (let i = 0; i < uv.count; i++) {
        maxU = Math.max(maxU, uv.getX(i));
      }
      expect(maxU).toBeGreaterThan(1.5);
    }

    const stoneRoomMesh = scene.getObjectByName('MazeRoom_stone') as
      | THREE.Mesh
      | undefined;
    expect(stoneRoomMesh).toBeDefined();
    expect(
      (stoneRoomMesh!.material as THREE.ShaderMaterial).uniforms.uUseLocalUv
        .value
    ).toBe(1);
    const stoneUv = stoneRoomMesh!.geometry.getAttribute('uv');
    let maxStoneU = 0;
    let minPositiveStoneV = Infinity;
    for (let i = 0; i < stoneUv.count; i++) {
      maxStoneU = Math.max(maxStoneU, stoneUv.getX(i));
      const vy = stoneUv.getY(i);
      if (vy > 0.001) {
        minPositiveStoneV = Math.min(minPositiveStoneV, vy);
      }
    }
    expect(maxStoneU).toBeCloseTo(1.44 / 1.45, 3);
    expect(minPositiveStoneV).toBeCloseTo(0.16 / 1.45, 3);
  });

  it('garante zero objetos virados ao contrário nas paredes Leste/Oeste, zero barril afundando na estante, cantoneiras niveladas e zero interpenetração entre tambores/pedras', () => {
    const layout = createRandomArenaLayout({
      worldSeed: hashArenaSeed('oof-geometry-orientation-audit-v1'),
      playerSeed: 2026,
    });

    // 1. TODOS os obstáculos de parede ('wall') apontam a frente (+Z rotacionado por yaw) PARA DENTRO do corredor (nunca contra a parede!)
    let westWallObsCount = 0;
    let eastWallObsCount = 0;
    for (const obs of layout.obstaclePlacements) {
      if (obs.role !== 'wall') continue;
      const cellCenter = gridCellToWorld(obs.gx, obs.gz);
      const toCorridorX = cellCenter.x - obs.worldX;
      const toCorridorZ = cellCenter.z - obs.worldZ;
      // Em Three.js rotateY(yaw), o vetor frontal local (0, 0, +1) vira (sin(yaw), 0, cos(yaw))
      const frontX = Math.sin(obs.yaw);
      const frontZ = Math.cos(obs.yaw);
      if (Math.abs(frontX) > 0.9) {
        if (frontX > 0) westWallObsCount++;
        else eastWallObsCount++;
      }
      // Produto escalar com o deslocamento até o centro do corredor deve ser estritamente positivo!
      expect(frontX * toCorridorX + frontZ * toCorridorZ).toBeGreaterThan(0.2);
    }
    expect(westWallObsCount).toBeGreaterThan(3);
    expect(eastWallObsCount).toBeGreaterThan(3);

    // 2. TODAS as mobílias encostadas nas paredes N/S/L/O das 7 Salas Especiais apontam a frente (+Z) para o interior da sala!
    let westOrEastRoomProps = 0;
    for (const fp of layout.roomFurniturePlacements) {
      const cellCenter = gridCellToWorld(fp.gx, fp.gz);
      const dx = cellCenter.x - fp.worldX;
      const dz = cellCenter.z - fp.worldZ;
      if (Math.hypot(dx, dz) < 0.05) continue; // Ilha 'CENTER'
      const frontX = Math.sin(fp.yaw);
      const frontZ = Math.cos(fp.yaw);
      if (Math.abs(frontX) > 0.9) westOrEastRoomProps++;
      expect(frontX * dx + frontZ * dz).toBeGreaterThan(0.15);
    }
    expect(westOrEastRoomProps).toBeGreaterThanOrEqual(12);

    // 3. Estante rústica de madeira ('wooden_shelving_rack'): barril de carvalho apoiado EM CIMA da prateleira (y >= 0.245, jamais atravessando até o chão!)
    const shared = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const shelfGroup = new THREE.Group();
    const shelfSample: ObstaclePlacement = {
      id: 'audit-wood-shelf',
      kind: 'wooden_shelving_rack',
      role: 'wall',
      gx: 5,
      gz: 20,
      worldX: 0,
      worldZ: 0,
      yaw: 0,
      variant: 0,
      minX: -0.73,
      maxX: 0.73,
      minY: 0,
      maxY: 2.1,
      minZ: -0.34,
      maxZ: 0.34,
    };
    buildDoomMapObstacles(shelfGroup, [shelfSample], textures, shared, []);
    const shelfOak = shelfGroup.getObjectByName('MazeObstaclesOakWood') as THREE.Mesh;
    expect(shelfOak).toBeDefined();
    const shelfOakPos = shelfOak.geometry.getAttribute('position');
    let minShelfBarrelY = Infinity;
    for (let i = 0; i < shelfOakPos.count; i++) {
      minShelfBarrelY = Math.min(minShelfBarrelY, shelfOakPos.getY(i));
    }
    expect(minShelfBarrelY).toBeGreaterThanOrEqual(0.245);

    // 4. Barricada de pedras ('stone_rubble_barricade'): blocos de pedra à esquerda e tonel de madeira à direita totalmente disjuntos em X!
    const rubbleGroup = new THREE.Group();
    const rubbleSample: ObstaclePlacement = {
      ...shelfSample,
      id: 'audit-stone-rubble',
      kind: 'stone_rubble_barricade',
    };
    buildDoomMapObstacles(rubbleGroup, [rubbleSample], textures, shared, []);
    const rubbleStonePos = (
      rubbleGroup.getObjectByName('MazeObstaclesStone') as THREE.Mesh
    ).geometry.getAttribute('position');
    const rubbleBarrelPos = (
      rubbleGroup.getObjectByName('MazeObstaclesOakWood') as THREE.Mesh
    ).geometry.getAttribute('position');
    let maxStoneX = -Infinity;
    for (let i = 0; i < rubbleStonePos.count; i++) {
      maxStoneX = Math.max(maxStoneX, rubbleStonePos.getX(i));
    }
    let minBarrelX = Infinity;
    for (let i = 0; i < rubbleBarrelPos.count; i++) {
      minBarrelX = Math.min(minBarrelX, rubbleBarrelPos.getX(i));
    }
    expect(maxStoneX).toBeLessThan(minBarrelX - 0.08);

    // 5. Dupla de tonéis de madeira ('wooden_barrel_cluster' variant 0): tonel tombado à esquerda não invade o tonel em pé à direita!
    const barrelDuoGroup = new THREE.Group();
    const barrelDuoSample: ObstaclePlacement = {
      ...shelfSample,
      id: 'audit-wood-barrel-duo',
      kind: 'wooden_barrel_cluster',
      variant: 0,
    };
    buildDoomMapObstacles(barrelDuoGroup, [barrelDuoSample], textures, shared, []);
    const duoWoodCapPos = (
      barrelDuoGroup.getObjectByName('MazeObstaclesWood') as THREE.Mesh
    ).geometry.getAttribute('position');
    // O tampo direito do tonel tombado fica em x < 0.08, enquanto o bojo esquerdo do tonel em pé (cx=0.36, r=0.265) começa em x ~ 0.095!
    let maxFallenCapX = -Infinity;
    for (let i = 0; i < duoWoodCapPos.count; i++) {
      const y = duoWoodCapPos.getY(i);
      const x = duoWoodCapPos.getX(i);
      // Filtra apenas tampos do tonel tombado (x < 0.12 e y > 0.08)
      if (x < 0.12 && y > 0.08) {
        maxFallenCapX = Math.max(maxFallenCapX, x);
      }
    }
    expect(maxFallenCapX).toBeLessThan(0.08);

    // 6. Tambores de ferro + galão frontal ('iron_barrel_cluster' variant 1): galão não invade o raio de nenhum dos dois tambores!
    const ironClusterGroup = new THREE.Group();
    const ironClusterSample: ObstaclePlacement = {
      ...shelfSample,
      id: 'audit-iron-barrel-jerrycan',
      kind: 'iron_barrel_cluster',
      variant: 1,
    };
    buildDoomMapObstacles(ironClusterGroup, [ironClusterSample], textures, shared, []);
    const jerrycanPos = (
      ironClusterGroup.getObjectByName('MazeObstaclesMetal') as THREE.Mesh
    ).geometry.getAttribute('position');
    for (let i = 0; i < jerrycanPos.count; i++) {
      const vx = jerrycanPos.getX(i);
      const vy = jerrycanPos.getY(i);
      const vz = jerrycanPos.getZ(i);
      if (vy > 0.4) continue; // Ignora os dois pequenos bujões no topo dos tambores (y ~ 0.90)
      const distLeftDrum = Math.hypot(vx - -0.34, vz - -0.07);
      const distRightDrum = Math.hypot(vx - 0.34, vz - -0.07);
      expect(distLeftDrum).toBeGreaterThan(0.258);
      expect(distRightDrum).toBeGreaterThan(0.248);
    }
  });
});

describe('Salas Especiais 7x7 Isoladas c/ Chaves, Rádio VHF de Longa Distância & Motor de Voz 8-Bit Aprimorado', () => {
  it('isola as 7 Salas Especiais em mini-mapas 7x7 independentes com divisórias internas, ícones de porta sem Z-fighting e 7 chaves exclusivas nas caixas', () => {
    resetThemedRoomLocks();

    // 1. Nenhuma Sala Especial se conecta ou encosta em outra (distância mínima >= 2 células entre quaisquer duas)
    for (let i = 0; i < THEMED_ROOMS.length; i++) {
      const a = THEMED_ROOMS[i];
      let internalWallCount = 0;
      for (let gz = a.minGz; gz <= a.maxGz; gz++) {
        for (let gx = a.minGx; gx <= a.maxGx; gx++) {
          const tile = getThemedRoomMiniMapTile(gx, gz);
          if (tile === '#' || tile === 'C') {
            internalWallCount++;
            expect(isWalkableArenaCell(gx, gz)).toBe(false);
          }
        }
      }
      expect(internalWallCount).toBeGreaterThanOrEqual(8);

      const matchedByKey = getThemedRoomByKeyItemId(a.keyItemId);
      expect(matchedByKey?.id).toBe(a.id);

      for (let j = i + 1; j < THEMED_ROOMS.length; j++) {
        const b = THEMED_ROOMS[j];
        const gapX = Math.max(0, Math.max(a.minGx - b.maxGx, b.minGx - a.maxGx));
        const gapZ = Math.max(0, Math.max(a.minGz - b.maxGz, b.minGz - a.maxGz));
        expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(2);
      }
    }

    // 2. Todas as 7 chaves exclusivas + o Rádio Comunicador VHF nascem garantidamente nas 25 caixas do labirinto!
    const layout = createRandomArenaLayout({
      worldSeed: hashArenaSeed('oof-keys-and-walkie-v1'),
      playerSeed: 77,
      isMultiplayer: true,
    });
    expect(layout.cratePlacements.length).toBe(25);
    const lootIds = new Set(
      layout.cratePlacements.map((c) => c.itemId).filter(Boolean)
    );
    expect(lootIds.has('field_walkie_talkie')).toBe(true);
    for (const r of THEMED_ROOMS) {
      expect(lootIds.has(r.keyItemId)).toBe(true);
    }

    // 3. Texturas dedicadas de ícone de porta (128x40) e placa de mini-mapa 7x7 (64x64) geram pixels válidos
    for (const r of THEMED_ROOMS) {
      const doorTex = createSpecialRoomDoorIconTexture(
        r.id,
        r.doorCode,
        r.accentHex
      );
      expect(doorTex.image.width).toBe(128);
      expect(doorTex.image.height).toBe(40);

      const mapTex = createSpecialRoomMiniMapTexture(r.miniMap, 'N', r.accentHex);
      expect(mapTex.image.width).toBe(64);
      expect(mapTex.image.height).toBe(64);
      doorTex.dispose();
      mapTex.dispose();
    }

    // 4. Destrancar 1 sala específica mantém todas as outras 6 trancadas!
    expect(unlockThemedRoom('biology_lab')).toBe(true);
    expect(isThemedRoomUnlocked('biology_lab')).toBe(true);
    expect(isThemedRoomUnlocked('computer_room')).toBe(false);
    expect(isThemedRoomUnlocked('reactor_hall')).toBe(false);
    resetThemedRoomLocks();
  });

  it('habilita o Rádio Comunicador VHF (field_walkie_talkie) para falar com amigos a longa distância através de todo o labirinto', () => {
    // Sem rádio: aliado a 65 metros e atrás de 6 paredes fica 100% inaudível
    const noRadioFar = computeProximityVoiceAcousticParams(65.0, 6, 'none');
    expect(noRadioFar.audible).toBe(false);
    expect(noRadioFar.gain).toBe(0);
    expect(noRadioFar.viaRadio).toBe(false);

    // Com Rádio VHF (simplex ou duplex): voz chega clara de qualquer canto ou Sala Especial!
    const simplexFar = computeProximityVoiceAcousticParams(65.0, 6, 'simplex');
    expect(simplexFar.audible).toBe(true);
    expect(simplexFar.viaRadio).toBe(true);
    expect(simplexFar.gain).toBeCloseTo(0.78, 2);
    expect(simplexFar.lowpassHz).toBe(2600);

    const duplexFar = computeProximityVoiceAcousticParams(85.0, 9, 'duplex');
    expect(duplexFar.audible).toBe(true);
    expect(duplexFar.viaRadio).toBe(true);
    expect(duplexFar.gain).toBeCloseTo(0.88, 2);
    expect(duplexFar.lowpassHz).toBe(2950);

    // De perto sem paredes (1.5m), a voz presencial direta prevalece sobre o rádio (gain 1.0 > 0.88)
    const closeDirect = computeProximityVoiceAcousticParams(1.5, 0, 'duplex');
    expect(closeDirect.audible).toBe(true);
    expect(closeDirect.viaRadio).toBe(false);
    expect(closeDirect.gain).toBeCloseTo(1.0, 3);

    // Verifica catálogo do Rádio Comunicador VHF + prop 3D em 1ª pessoa + todas as 7 chaves
    expect(ITEM_CATALOG.field_walkie_talkie).toBeDefined();
    expect(ITEM_CATALOG.field_walkie_talkie.kind).toBe('walkie');
    for (const r of THEMED_ROOMS) {
      expect(ITEM_CATALOG[r.keyItemId]).toBeDefined();
      expect(ITEM_CATALOG[r.keyItemId].kind).toBe('key');
    }

    const fl = new DoomFlashlight(16 / 9);
    fl.triggerQuickItemAction('walkie');
    expect(fl.isLeftArmAnimating).toBe(true);
    fl.update(0.12, 0, 0, () => {});
    expect(fl.isLeftArmAnimating).toBe(true);
  });

  it('aprimora o efeito de voz 8-bit eliminando 100% duplicações de pacotes e cortes bruscos no meio da fala', () => {
    // 1. Gate Vocal com Histerese + Hangover: pausas naturais entre sílabas (250ms) NUNCA cortam a voz!
    let gate = createInitialVoiceGateState();
    expect(gate.gateOpen).toBe(false);

    // Jogador começa a falar normalmente em modo OPEN (nível 0.18 por 120ms)
    for (let i = 0; i < 6; i++) {
      gate = stepVoiceGateState(gate, 0.18, 0.02, true, false);
    }
    expect(gate.gateOpen).toBe(true);

    // Queda momentânea de energia entre sílabas/respiração por 260ms -> gate permanece 100% ABERTO (sem picotar!)
    for (let i = 0; i < 13; i++) {
      gate = stepVoiceGateState(gate, 0.0, 0.02, true, false);
      expect(gate.gateOpen).toBe(true);
    }

    // Jogador retoma a próxima palavra -> continua aberto sem corte algum!
    gate = stepVoiceGateState(gate, 0.16, 0.02, true, false);
    expect(gate.gateOpen).toBe(true);

    // Após silêncio real prolongado (> 550ms), fecha suavemente
    for (let i = 0; i < 35; i++) {
      gate = stepVoiceGateState(gate, 0.0, 0.02, true, false);
    }
    expect(gate.gateOpen).toBe(false);

    // Em Push-to-Talk ([B] segurado), até um sussurro baixinho (0.02) abre e sustenta por >500ms!
    let pttGate = createInitialVoiceGateState();
    for (let i = 0; i < 5; i++) {
      pttGate = stepVoiceGateState(pttGate, 0.022, 0.02, true, true);
    }
    expect(pttGate.gateOpen).toBe(true);

    // 2. RelaySeqDeduplicator bloqueia 100% pacotes duplicados (BroadcastChannel + Supabase Realtime)
    const dedup = new RelaySeqDeduplicator(64);
    expect(dedup.accept(1)).toBe(true);
    expect(dedup.accept(1)).toBe(false); // Cópia duplicada rejeitada!
    expect(dedup.accept(2)).toBe(true);
    expect(dedup.accept(2)).toBe(false); // Cópia duplicada rejeitada!
    expect(dedup.accept(30)).toBe(true);
    expect(dedup.accept(2)).toBe(false); // Pacote atrasado descartado (>24 atrás)

    // 3. Curva do Processador Retro 8-Bit EVA Comm: silêncio absoluto na zona morta + simetria + sem NaN
    const curve = buildRetro8BitQuantizerCurve(56, 1.18, 2048);
    expect(curve.length).toBe(2048);
    const midIdx = Math.floor(curve.length / 2);
    expect(curve[midIdx]).toBe(0);
    expect(Math.abs(curve[0] + curve[curve.length - 1])).toBeLessThan(1e-5);
    for (let i = 1; i < curve.length; i++) {
      expect(Number.isFinite(curve[i])).toBe(true);
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] - 1e-6);
    }

    // 4. Downsampler anti-aliasing + micro-fade cosseno sem cliques nas bordas
    const src48k = new Float32Array(2048);
    for (let i = 0; i < src48k.length; i++) {
      src48k[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000) * 0.6;
    }
    const down8k = downsamplePcmWithAntiAlias(src48k, 48_000, 8_512);
    expect(down8k.length).toBeGreaterThan(340);
    applyChunkMicroFade(down8k, 8_512, 0.003);
    expect(down8k[0]).toBe(0);
    expect(Math.abs(down8k[down8k.length - 1])).toBeLessThan(0.05);
  });

  it('impede voz duplicada WebRTC+Relay, descarta chunks repetidos e reutiliza transceiver sem bugar o microfone dos amigos', async () => {
    const prevWin = (globalThis as Record<string, unknown>).window;
    const prevRtc = (globalThis as Record<string, unknown>).RTCPeerConnection;

    let startedBufferCount = 0;
    let stoppedBufferCount = 0;
    let addTrackCalls = 0;
    let replaceTrackCalls = 0;
    let createdPc: {
      iceConnectionState: string;
      connectionState: string;
      oniceconnectionstatechange?: () => void;
      ontrack?: (ev: unknown) => void;
    } | null = null;

    const makeParam = (v = 0) => ({
      value: v,
      setValueAtTime: vi.fn((nv: number) => {
        v = nv;
      }),
      setTargetAtTime: vi.fn((nv: number) => {
        v = nv;
      }),
    });

    class MockAudioCtx {
      state = 'running';
      currentTime = 1.0;
      sampleRate = 48_000;
      destination = {};
      listener = {
        positionX: makeParam(0),
        positionY: makeParam(0),
        positionZ: makeParam(0),
        forwardX: makeParam(0),
        forwardY: makeParam(0),
        forwardZ: makeParam(-1),
        upX: makeParam(0),
        upY: makeParam(1),
        upZ: makeParam(0),
      };
      resume = vi.fn(() => Promise.resolve());
      close = vi.fn(() => Promise.resolve());
      createGain() {
        return { gain: makeParam(0), connect: vi.fn(), disconnect: vi.fn() };
      }
      createBiquadFilter() {
        return {
          type: 'lowpass',
          frequency: makeParam(1000),
          Q: makeParam(1),
          gain: makeParam(0),
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      createWaveShaper() {
        return {
          curve: null as Float32Array | null,
          oversample: 'none',
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      createDynamicsCompressor() {
        return {
          threshold: makeParam(-18),
          knee: makeParam(12),
          ratio: makeParam(4),
          attack: makeParam(0.003),
          release: makeParam(0.15),
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      createPanner() {
        return {
          panningModel: 'HRTF',
          distanceModel: 'linear',
          refDistance: 1,
          maxDistance: 10000,
          rolloffFactor: 0,
          coneInnerAngle: 360,
          coneOuterAngle: 360,
          positionX: makeParam(0),
          positionY: makeParam(0),
          positionZ: makeParam(0),
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      createAnalyser() {
        return {
          fftSize: 512,
          smoothingTimeConstant: 0.4,
          getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0.08)),
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
      }
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createMediaStreamDestination() {
        return {
          stream: {
            getAudioTracks: () => [{ kind: 'audio', enabled: true, stop: vi.fn() }],
          },
        };
      }
      createBuffer(_ch: number, len: number, rate: number) {
        const data = new Float32Array(len);
        return {
          duration: len / rate,
          getChannelData: () => data,
        };
      }
      createBufferSource() {
        const node = {
          buffer: null as unknown,
          onended: null as (() => void) | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(() => {
            startedBufferCount++;
          }),
          stop: vi.fn(() => {
            stoppedBufferCount++;
          }),
        };
        return node;
      }
    }

    class MockRTCPeerConnection {
      signalingState = 'stable';
      iceConnectionState = 'checking';
      connectionState = 'connecting';
      oniceconnectionstatechange?: () => void;
      onconnectionstatechange?: () => void;
      ontrack?: (ev: unknown) => void;
      private readonly transceivers: Array<{
        direction: string;
        receiver: { track: { kind: string } };
        sender: { track: null | { kind: string }; replaceTrack: (t: unknown) => Promise<void> };
      }> = [];
      constructor() {
        createdPc = this;
      }
      addTransceiver(kind: string, init?: { direction?: string }) {
        const tr = {
          direction: init?.direction ?? 'sendrecv',
          receiver: { track: { kind } },
          sender: {
            track: null,
            replaceTrack: vi.fn(async () => {
              replaceTrackCalls++;
            }),
          },
        };
        this.transceivers.push(tr);
        return tr;
      }
      getTransceivers() {
        return this.transceivers;
      }
      addTrack() {
        addTrackCalls++;
      }
      close() {}
    }

    const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    (globalThis as Record<string, unknown>).window = {
      AudioContext: MockAudioCtx,
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => ({
            getTracks: () => [{ kind: 'audio', enabled: true, stop: vi.fn() }],
            getAudioTracks: () => [{ kind: 'audio', enabled: true, stop: vi.fn() }],
          })),
        },
      },
    });
    (globalThis as Record<string, unknown>).RTCPeerConnection = MockRTCPeerConnection;

    try {
      const mgr = new ProximityVoiceChatManager({
        localPlayerId: 'player-a',
        sendSignal: () => {},
        sendRelayChunk: () => {},
      });

      // Inicializa peer ANTES de ligar o microfone local (caso real que antes duplicava trilha com addTrack!)
      mgr.update(
        0.016,
        new THREE.Vector3(4.5, 1.6, 4.5),
        0,
        0,
        [{ id: 'player-b', pos: new THREE.Vector3(6.0, 0, 4.5), dead: false }],
        false
      );

      // Envia chunk seq=1 DUAS vezes (simulando BroadcastChannel + Supabase entregando o mesmo pacote)
      const sampleWave = new Float32Array(320).fill(0.25);
      const b64 = encodePcmToMuLawBase64(sampleWave);
      mgr.handleIncomingRelayChunk({
        fromId: 'player-b',
        seq: 1,
        sampleRate: 8512,
        muLawB64: b64,
      });
      mgr.handleIncomingRelayChunk({
        fromId: 'player-b',
        seq: 1,
        sampleRate: 8512,
        muLawB64: b64,
      });
      // Tocou EXATAMENTE 1 vez (cópia duplicada descartada!)
      expect(startedBufferCount).toBe(1);

      // Agora o canal WebRTC conecta: corta imediatamente a fila de Relay e ignora novos chunks de Relay!
      expect(createdPc).not.toBeNull();
      createdPc!.iceConnectionState = 'connected';
      createdPc!.ontrack?.({
        track: { kind: 'audio', readyState: 'live' },
        streams: [{}],
      });
      createdPc!.oniceconnectionstatechange?.();
      expect(stoppedBufferCount).toBe(1);

      mgr.handleIncomingRelayChunk({
        fromId: 'player-b',
        seq: 2,
        sampleRate: 8512,
        muLawB64: b64,
      });
      // Nenhum novo chunk de Relay é tocado enquanto WebRTC está ativo (ZERO voz duplicada!)
      expect(startedBufferCount).toBe(1);

      // Jogador A ativa o microfone agora -> usa replaceTrack no transceiver existente (0 chamadas a addTrack!)
      const ok = await mgr.ensureMicrophoneInitialized();
      expect(ok).toBe(true);
      expect(replaceTrackCalls).toBe(1);
      expect(addTrackCalls).toBe(0);

      mgr.destroy();
    } finally {
      (globalThis as Record<string, unknown>).window = prevWin;
      if (navDesc) {
        Object.defineProperty(globalThis, 'navigator', navDesc);
      }
      (globalThis as Record<string, unknown>).RTCPeerConnection = prevRtc;
    }
  });
});






describe('Sistema de Danças do Astronauta & Câmera em 3ª Pessoa', () => {
  it('oferece múltiplas coreografias distintas com catálogo completo e navegável', () => {
    expect(DOOM_DANCES.length).toBeGreaterThanOrEqual(5);
    const ids = DOOM_DANCES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const dance of DOOM_DANCES) {
      expect(dance.label.length).toBeGreaterThan(2);
      expect(dance.bpm).toBeGreaterThan(40);
      expect(dance.bpm).toBeLessThan(220);
      expect(isDoomDanceId(dance.id)).toBe(true);
      expect(getDoomDanceDefinition(dance.id).id).toBe(dance.id);
      expect(getDoomDanceIndex(dance.id)).toBeGreaterThanOrEqual(1);
    }
    expect(isDoomDanceId('danca_inexistente')).toBe(false);

    // Navegação circular do catálogo
    let cursor: DoomDanceId = DOOM_DANCES[0].id;
    for (let i = 0; i < DOOM_DANCES.length; i++) {
      cursor = getNextDoomDanceId(cursor);
    }
    expect(cursor).toBe(DOOM_DANCES[0].id);
    expect(getNextDoomDanceId(null)).toBe(DOOM_DANCES[0].id);
  });

  it('gera poses articuladas finitas e determinísticas para todas as danças (sincronização Co-op)', () => {
    for (const dance of DOOM_DANCES) {
      const a = computeDoomDancePose(dance.id, 3.37);
      const b = computeDoomDancePose(dance.id, 3.37);
      expect(a).toEqual(b);

      for (let t = 0; t < 6; t += 1 / 30) {
        const pose = computeDoomDancePose(dance.id, t);
        const values = [
          pose.bodyYaw,
          pose.bodyLift,
          pose.hipsYaw,
          pose.hipsRoll,
          pose.torsoPitch,
          pose.torsoYaw,
          pose.torsoRoll,
          pose.headPitch,
          pose.headYaw,
          pose.headRoll,
          pose.leftArm.shoulder.x,
          pose.leftArm.shoulder.y,
          pose.leftArm.shoulder.z,
          pose.leftArm.elbow,
          pose.leftArm.wrist,
          pose.rightArm.shoulder.x,
          pose.rightArm.shoulder.y,
          pose.rightArm.shoulder.z,
          pose.rightArm.elbow,
          pose.rightArm.wrist,
          pose.leftLeg.hip.x,
          pose.leftLeg.hip.y,
          pose.leftLeg.hip.z,
          pose.leftLeg.knee,
          pose.leftLeg.ankle,
          pose.rightLeg.hip.x,
          pose.rightLeg.hip.y,
          pose.rightLeg.hip.z,
          pose.rightLeg.knee,
          pose.rightLeg.ankle,
        ];
        for (const v of values) {
          expect(Number.isFinite(v)).toBe(true);
          expect(Math.abs(v)).toBeLessThan(6.5);
        }
        // Nunca levanta o corpo abaixo do piso (o "bounce" só pode ser >= 0)
        expect(pose.bodyLift).toBeGreaterThanOrEqual(0);
        // Limite de inclinação da cabeça: preserva a costura da gola do capuz
        expect(Math.abs(pose.headPitch)).toBeLessThanOrEqual(0.26);
        expect(Math.abs(pose.headRoll)).toBeLessThanOrEqual(0.24);
      }
    }
  });

  it('mantém os sinais independentes dos braços e movimentos legíveis no traje real', () => {
    const scene = new THREE.Scene();
    const astronaut = new DoomAstronaut(scene, createDoomSharedUniforms());
    const position = new THREE.Vector3();
    const pose = computeDoomDancePose('spin', 0.3);
    astronaut.applyDancePose(pose, position, 0);
    expect(astronaut.leftArm.shoulderPivot.rotation.z).toBeCloseTo(pose.leftArm.shoulder.z);
    expect(astronaut.rightArm.shoulderPivot.rotation.z).toBeCloseTo(pose.rightArm.shoulder.z);
    expect(astronaut.leftArm.shoulderPivot.rotation.z).toBeLessThan(0);
    expect(astronaut.rightArm.shoulderPivot.rotation.z).toBeGreaterThan(0);

    // Um ciclo de corrida a cada duas batidas, com passos alternados.
    const halfCycle = 60 / getDoomDanceDefinition('jog').bpm;
    const jogA = computeDoomDancePose('jog', halfCycle * 0.5);
    const jogB = computeDoomDancePose('jog', halfCycle * 1.5);
    expect(jogA.leftLeg.hip.x).toBeGreaterThan(0.5);
    expect(jogB.leftLeg.hip.x).toBeLessThan(-0.5);
    expect(jogA.rightLeg.hip.x).toBeLessThan(-0.5);

    // Floss: balanço no mesmo sentido, mas cada manga permanece fora do tronco.
    const neutral = computeDoomDancePose('floss', 0);
    const floss = computeDoomDancePose('floss', 60 / getDoomDanceDefinition('floss').bpm * 0.5);
    expect(floss.leftArm.shoulder.z).toBeLessThan(0);
    expect(floss.rightArm.shoulder.z).toBeGreaterThan(0);
    expect(floss.leftArm.shoulder.z - neutral.leftArm.shoulder.z).toBeLessThan(0);
    expect(floss.rightArm.shoulder.z - neutral.rightArm.shoulder.z).toBeLessThan(0);
  });

  it('não abre o seletor nem inicia uma dança durante a captura', () => {
    const setOpen = vi.fn();
    const game = Object.assign(Object.create(DoomGameApp.prototype), {
      engaged: true, disposed: false, activeSequence: 'ABDUCTION_TO_WEB', danceId: null,
      danceMenu: { isOpen: false, setOpen }, pauseMenu: { open: false },
      inventory: { open: false, gameOverVisible: false },
    }) as unknown as { openDanceMenu(): void; startDance(id: DoomDanceId): void; danceId: DoomDanceId | null };
    game.openDanceMenu();
    game.startDance('samba');
    expect(setOpen).not.toHaveBeenCalled();
    expect(game.danceId).toBeNull();
  });

  it('mantém as duas galochas ENCAIXADAS no piso durante todas as coreografias (sem afundar no chão)', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const astronaut = new DoomAstronaut(scene, shared);
    const worldPos = new THREE.Vector3(3.5, 0, -6.25);

    const collectBootWorldY = (): number => {
      astronaut.root.updateMatrixWorld(true);
      let lowest = Infinity;
      astronaut.root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (!mesh.name && !mesh.parent) return;
        const parentName = mesh.parent?.name ?? '';
        if (!parentName.startsWith('AstronautLeftBoot') && !parentName.startsWith('AstronautRightBoot')) {
          return;
        }
        const bbox = mesh.geometry.boundingBox;
        if (!bbox) return;
        for (let c = 0; c < 8; c++) {
          const v = new THREE.Vector3(
            c & 1 ? bbox.max.x : bbox.min.x,
            c & 2 ? bbox.max.y : bbox.min.y,
            c & 4 ? bbox.max.z : bbox.min.z
          ).applyMatrix4(mesh.matrixWorld);
          if (v.y < lowest) lowest = v.y;
        }
      });
      return lowest;
    };

    for (const dance of DOOM_DANCES) {
      for (let t = 0; t < 4; t += 1 / 24) {
        const pose = computeDoomDancePose(dance.id, t);
        astronaut.applyDancePose(pose, worldPos, 0.7);
        const lowest = collectBootWorldY();
        // A galocha mais baixa encosta no piso (tolerância de 1mm) e NUNCA afunda
        expect(lowest).toBeGreaterThan(-0.0015);
        expect(lowest).toBeLessThan(0.02);
      }
    }
  });

  it('aciona a pose de dança em 3ª pessoa (corpo visível, lanterna 3D e teia ocultas)', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const astronaut = new DoomAstronaut(scene, shared);
    const worldPos = new THREE.Vector3(0, 0, 0);

    astronaut.updateFirstPersonBody(worldPos, 0, 0, 0, 0, false, false);
    expect(astronaut.root.visible).toBe(false);

    const pose = computeDoomDancePose('samba', 1.25);
    astronaut.applyDancePose(pose, worldPos, Math.PI * 0.25);

    expect(astronaut.root.visible).toBe(true);
    expect(astronaut.headGroup.visible).toBe(true);
    expect(astronaut.plssBackpack.visible).toBe(true);
    expect(astronaut.upperChestGroup.visible).toBe(true);
    expect(astronaut.leftArm.root.visible).toBe(true);
    expect(astronaut.rightArm.root.visible).toBe(true);
    expect(astronaut.thirdPersonFlashlightGroup.visible).toBe(false);
    expect(astronaut.thirdPersonWebCocoonGroup.visible).toBe(false);
    expect(astronaut.isFirstPersonMode).toBe(false);
    expect(astronaut.root.rotation.y).toBeCloseTo(Math.PI * 0.25, 4);
  });

  it('marca a batida da coreografia de forma monotônica para o som percussivo', () => {
    for (const dance of DOOM_DANCES) {
      let prev = -1;
      for (let t = 0; t < 3; t += 0.05) {
        const beat = getDoomDanceBeatIndex(dance.id, t);
        expect(beat).toBeGreaterThanOrEqual(prev);
        prev = beat;
      }
      expect(getDoomDanceBeatIndex(dance.id, 0)).toBe(0);
    }
  });
});

describe('Correção do Canal VHF do Rádio Comunicador (voz de rádio não vaza com o rádio desligado)', () => {
  it('só abre o canal de rádio para quem tem o próprio rádio LIGADO', () => {
    // Rádio do jogador DESLIGADO: nenhum enlace de rádio em nenhuma hipótese
    expect(computeRadioVoiceLinkMode(false, false)).toBe('none');
    expect(computeRadioVoiceLinkMode(false, true)).toBe('none');

    // Rádio do jogador LIGADO: escuta o canal (simplex) ou conversa (duplex)
    expect(computeRadioVoiceLinkMode(true, false)).toBe('simplex');
    expect(computeRadioVoiceLinkMode(true, true)).toBe('duplex');
  });

  it('NÃO reproduz voz de rádio de longa distância quando o rádio local está desligado', () => {
    // Aliado com o rádio LIGADO a 65m: com o meu rádio desligado a voz é
    // inaudível (só o AR conta, e o alcance normal é ~22m)
    const radioOff = computeProximityVoiceAcousticParams(
      65.0,
      6,
      computeRadioVoiceLinkMode(false, true)
    );
    expect(radioOff.audible).toBe(false);
    expect(radioOff.viaRadio).toBe(false);
    expect(radioOff.gain).toBe(0);

    // Com o meu rádio LIGADO a mesma voz chega clara pelo canal VHF
    const radioOn = computeProximityVoiceAcousticParams(
      65.0,
      6,
      computeRadioVoiceLinkMode(true, true)
    );
    expect(radioOn.audible).toBe(true);
    expect(radioOn.viaRadio).toBe(true);
    expect(radioOn.gain).toBeCloseTo(0.88, 2);
    expect(radioOn.lowpassHz).toBe(2950);

    // Rádio ligado + aliado sem rádio = escuta o canal em simplex (0.78 / 2600Hz)
    const simplex = computeProximityVoiceAcousticParams(
      65.0,
      6,
      computeRadioVoiceLinkMode(true, false)
    );
    expect(simplex.audible).toBe(true);
    expect(simplex.viaRadio).toBe(true);
    expect(simplex.gain).toBeCloseTo(0.78, 2);
    expect(simplex.lowpassHz).toBe(2600);
  });

  it('mantém a voz de PROXIMIDADE normal quando o rádio está desligado (sem efeito de rádio)', () => {
    const perto = computeProximityVoiceAcousticParams(
      1.5,
      0,
      computeRadioVoiceLinkMode(false, false)
    );
    expect(perto.audible).toBe(true);
    expect(perto.viaRadio).toBe(false);
    expect(perto.gain).toBeGreaterThan(0.9);
    expect(perto.lowpassHz).toBe(16_500);

    // Longa distância com o rádio desligado: a voz some de vez
    const longe = computeProximityVoiceAcousticParams(
      65.0,
      6,
      computeRadioVoiceLinkMode(false, true)
    );
    expect(longe.audible).toBe(false);
    expect(longe.gain).toBe(0);
  });
});


describe('Shotgun: peças, munição e aranha', () => {
  it('garante as quatro peças únicas em salas diferentes e cartuchos nos caixotes', () => {
    for (const seed of [1, 42, 500, 9011, 75012]) {
      const layout = createRandomArenaLayout({ worldSeed: seed, playerSeed: seed });
      expect(layout.cratePlacements).toHaveLength(25);
      expect(layout.cratePlacements.filter(p => SHOTGUN_PART_IDS.some(id => id === p.itemId))).toHaveLength(0);
      const pieces = layout.shotgunRoomPlacements;
      expect(pieces).toHaveLength(4);
      expect(new Set(pieces.map(p => p.itemId)).size).toBe(4);
      expect(new Set(pieces.map(p => p.roomId)).size).toBe(4);
      for (const p of pieces) {
        expect(getThemedRoomAtCell(p.gx, p.gz)?.id).toBe(p.roomId);
        expect(getThemedRoomMiniMapTile(p.gx, p.gz)).toBe('.');
      }
      expect(createRandomArenaLayout({ worldSeed: seed, playerSeed: seed + 100 }).shotgunRoomPlacements).toEqual(pieces);
      expect(layout.cratePlacements.filter(p => p.itemId === SHOTGUN_AMMO_ITEM_ID).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('coleta uma caixa de cartuchos como oito tiros e não duplica ao recolher novamente', () => {
    const scene = new THREE.Scene();
    const layout = createRandomArenaLayout({ worldSeed: 42, playerSeed: 42 });
    const items = new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
    const pickup = items.getPickupsSnapshot().find(p => p.itemId === SHOTGUN_AMMO_ITEM_ID)!;
    expect(pickup).toBeDefined();
    const addItem = vi.fn(() => true);
    const inventory = { addItem } as unknown as DoomInventory;
    const camera = pickup.position.clone();
    const lookAt = new THREE.Vector3(0, 0, -1);
    // Fechada: encostar no caixote não entrega mais nada.
    items.updateAndCheckPickups(0.016, 1, pickup.position, camera, lookAt, false, inventory);
    expect(addItem).not.toHaveBeenCalled();
    items.updateAndCheckPickups(0.016, 1, pickup.position, camera, lookAt, true, inventory);
    for (let frame = 0; frame < 40; frame++) {
      items.updateAndCheckPickups(0.016, 2, pickup.position, camera, lookAt, false, inventory);
    }
    expect(addItem).toHaveBeenCalledWith(SHOTGUN_AMMO_ITEM_ID, 8, false);
    const calls = addItem.mock.calls.length;
    items.updateAndCheckPickups(0.016, 2, pickup.position, camera, new THREE.Vector3(0, 0, -1), false, inventory);
    expect(addItem.mock.calls.length).toBe(calls);
  });

  it('testa mira, oclusão, distância, dano e viewmodel sem inventar projéteis através de paredes', () => {
    const origin = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(0, 0, -1);
    const target = new THREE.Vector3(0, 1, -6);
    expect(shotgunImpactDistance(origin, direction, target, [])).toBeCloseTo(4.95);
    expect(shotgunImpactDistance(origin, direction, target, [new THREE.Box3(new THREE.Vector3(-1, 0, -3), new THREE.Vector3(1, 3, -2))])).toBeNull();
    expect(shotgunImpactDistance(origin, direction, new THREE.Vector3(10, 1, -6), [])).toBeNull();
    expect(shotgunImpactDistance(origin, direction, new THREE.Vector3(0, 1, -40), [])).toBeNull();
    expect(computeShotgunBlastDamage(2)).toBeGreaterThan(computeShotgunBlastDamage(12));
    expect(computeShotgunBlastDamage(30)).toBe(0);
    const model = new DoomShotgunViewmodel(16 / 9);
    model.equip(); model.update(0.05, 0, 0); expect(model.isVisibleInView).toBe(true);
    model.fire(); expect(model.isFiring).toBe(true); model.dispose();
  });

  it('não interrompe o sequestro com tiros e replica a destruição para o cliente', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const layout = createRandomArenaLayout({ worldSeed: 123, playerSeed: 123 });
    const webs = new DoomSpiderWebManager(scene, shared, layout);
    const sound = { playSpiderScream: () => {}, playSpiderFootstep: () => {}, playSpiderChitter: () => {} } as unknown as SoundEngine;
    const host = new DoomSpider(scene, shared, [], webs, sound, layout);
    const guest = new DoomSpider(scene, shared, [], webs, sound, layout);
    const victim = new THREE.Vector3(0, 0, 0), position = new THREE.Vector3(0, 1.4, 2);
    host.updateCinematicSequence(0.016, 1, 'DRAGGING_TO_WEB', 0.5, position, victim, victim);
    expect(host.applyShotgunDamage(500)).toBe(false);
    expect(host.currentState).toBe('CINEMATIC_SEQUENCE');
    host.relocateAwayAfterAbduction();
    expect(host.applyShotgunDamage(60)).toBe(true);
    expect(host.isDead).toBe(false);
    expect(host.getNetworkSnapshot().shotgunHealth).toBe(40);
    host.applyShotgunDamage(40);
    expect(host.isDead).toBe(true);
    host.commandReturnToDevourVictim(victim);
    host.alertToWebTrap(victim, victim);
    host.finishAbductionRetreat();
    expect(host.isDead).toBe(true);
    guest.applyRemoteNetworkState(0.016, 2, host.getNetworkSnapshot(), victim, 0, () => { throw Error('dead spider caught player'); });
    expect(guest.isDead).toBe(true);
    expect(guest.getNetworkSnapshot().shotgunHealth).toBe(0);
  });
});


describe('Taser de contenção da aranha', () => {
  it('é distribuído uma vez por mapa, sem retirar peças, munição ou caixotes', () => {
    for (const seed of [1, 42, 500, 9011, 75012]) {
      const layout = createRandomArenaLayout({ worldSeed: seed, playerSeed: seed });
      expect(layout.cratePlacements).toHaveLength(25);
      expect(layout.shotgunRoomPlacements).toHaveLength(4);
      expect(layout.cratePlacements.filter(p => p.itemId === SHOTGUN_AMMO_ITEM_ID).length).toBeGreaterThanOrEqual(2);
      for (const id of ['industrial_battery', 'sterile_bandage', 'magnesium_flare', 'old_morphine'])
        expect(layout.cratePlacements.some(p => p.itemId === id)).toBe(true);
      const scene = new THREE.Scene();
      const items = new DoomWorldItems(scene, createDoomSharedUniforms(), layout);
      const tasers = items.getPickupsSnapshot().filter(p => p.itemId === TASER_ITEM_ID);
      expect(tasers).toHaveLength(1);
      const taserMesh = scene.getObjectByName('WorldTaser');
      const shellsMesh = scene.getObjectByName('WorldTaserShells');
      expect(taserMesh).toBeDefined();
      expect(shellsMesh).toBeDefined();
      scene.updateMatrixWorld(true);
      expect(new THREE.Box3().setFromObject(taserMesh!).intersectsBox(new THREE.Box3().setFromObject(shellsMesh!))).toBe(false);
      const otherLayout = createRandomArenaLayout({ worldSeed: seed, playerSeed: seed + 1 });
      const coopItems = new DoomWorldItems(new THREE.Scene(), createDoomSharedUniforms(), otherLayout);
      expect(coopItems.getPickupsSnapshot().find(p => p.itemId === TASER_ITEM_ID)?.position.toArray()).toEqual(tasers[0].position.toArray());
      expect(items.getUncollectedEquipmentSignals()).toHaveLength(29);
      const rejectTaserInventory = { addItem: (id: string) => id !== TASER_ITEM_ID } as unknown as DoomInventory;
      const taserCamera = tasers[0].position.clone().add(new THREE.Vector3(0.35, 0.9, 0.35));
      const taserLook = tasers[0].position.clone().sub(taserCamera).normalize();
      items.updateAndCheckPickups(0.016, 1, tasers[0].position, taserCamera, taserLook, true, rejectTaserInventory);
      for (let frame = 0; frame < 40; frame++) {
        items.updateAndCheckPickups(0.016, 1, tasers[0].position, taserCamera, taserLook, false, rejectTaserInventory);
      }
      expect(items.getUncollectedEquipmentSignals().some(signal => signal.id === tasers[0].id)).toBe(true);
    }
  });

  it('tem alcance limitado, respeita paredes, pode errar e tem modelo 3D', () => {
    const origin = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(0, 0, -1);
    expect(taserImpactDistance(origin, direction, new THREE.Vector3(0, 1, -6), [])).toBeCloseTo(4.95);
    expect(taserImpactDistance(origin, direction, new THREE.Vector3(0, 1, -(TASER_RANGE + 2)), [])).toBeNull();
    expect(taserImpactDistance(origin, direction, new THREE.Vector3(4, 1, -6), [])).toBeNull();
    expect(taserImpactDistance(origin, direction, new THREE.Vector3(0, 1, -6), [new THREE.Box3(new THREE.Vector3(-1, 0, -3), new THREE.Vector3(1, 3, -2))])).toBeNull();
    expect(taserImpactDistance(origin, new THREE.Vector3(), new THREE.Vector3(0, 1, -6), [])).toBeNull();
    expect(TASER_RECHARGE_SECONDS).toBeGreaterThan(TASER_STUN_SECONDS);
    expect(advanceTaserRecharge(TASER_RECHARGE_SECONDS, 0)).toBe(TASER_RECHARGE_SECONDS);
    expect(advanceTaserRecharge(TASER_RECHARGE_SECONDS, 3)).toBe(6);
    expect(advanceTaserRecharge(2, 3)).toBe(0);
    expect(advanceTaserRecharge(2, -3)).toBe(2);
    const model = new DoomTaserViewmodel(16 / 9);
    model.equip(); model.update(0.05, 0, 0); expect(model.isVisibleInView).toBe(true);
    model.fire();
    expect(model.viewScene.children.some(child => child.visible)).toBe(true);
    model.stow();
    for (let i = 0; i < 30; i++) model.update(0.05, 0, 0);
    expect(model.isVisibleInView).toBe(false);
    model.dispose();
  });

  it('imobiliza sem causar dano, não ataca, retoma a IA e sincroniza a duração para outro host', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const layout = createRandomArenaLayout({ worldSeed: 8181, playerSeed: 8181 });
    const webs = new DoomSpiderWebManager(scene, shared, layout);
    const sound = { playSpiderScream: () => {}, playSpiderFootstep: () => {}, playSpiderChitter: () => {} } as unknown as SoundEngine;
    const host = new DoomSpider(scene, shared, [], webs, sound, layout);
    const guest = new DoomSpider(scene, shared, [], webs, sound, layout);
    const victim = host.position.clone().setY(0);
    const position = host.position.clone();
    const caught = vi.fn();
    expect(host.applyTaserStun()).toBe(true);
    expect(host.isStunned).toBe(true);
    expect(host.getNetworkSnapshot().shotgunHealth).toBe(100);
    expect(host.applyShotgunDamage(20)).toBe(true);
    expect(host.getNetworkSnapshot().shotgunHealth).toBe(80);
    expect(host.isStunned).toBe(true);
    expect(scene.getObjectByName('SpiderTaserArcs')?.visible).toBe(true);
    host.commandReturnToDevourVictim(victim);
    host.alertToWebTrap(victim, victim);
    host.finishAbductionRetreat();
    host.interruptAbductionAndFlee(victim);
    expect(host.isStunned).toBe(true);
    for (let frame = 0; frame < 30; frame++)
      host.update(0.05, frame * 0.05, victim, 0, true, false, false, new THREE.Vector3(0, 0, -1), [], caught);
    expect(host.position.distanceTo(position)).toBeLessThan(0.00001);
    expect(caught).not.toHaveBeenCalled();
    expect(host.getNetworkSnapshot().stunRemaining).toBeCloseTo(3.5);
    guest.applyRemoteNetworkState(0.016, 2, host.getNetworkSnapshot(), victim, 0, caught);
    expect(guest.isStunned).toBe(true);
    expect(guest.getNetworkSnapshot().stunRemaining).toBeCloseTo(3.5);
    // O cliente promovido a host continua o tempo recebido, em vez de se soltar cedo.
    for (let frame = 0; frame < 72; frame++)
      guest.update(0.05, 2 + frame * 0.05, victim, 0, false, false, false, new THREE.Vector3(0, 0, -1), [], caught);
    expect(guest.isStunned).toBe(false);
    expect(guest.isDead).toBe(false);
    expect(caught).not.toHaveBeenCalled();
  });

  it('não solta um jogador capturado, nem atordoa uma aranha morta', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const layout = createRandomArenaLayout({ worldSeed: 123, playerSeed: 123 });
    const webs = new DoomSpiderWebManager(scene, shared, layout);
    const sound = { playSpiderScream: () => {} } as unknown as SoundEngine;
    const spider = new DoomSpider(scene, shared, [], webs, sound, layout);
    const victim = new THREE.Vector3(0, 0, 0), position = new THREE.Vector3(0, 1.4, 2);
    spider.updateCinematicSequence(0.016, 1, 'DRAGGING_TO_WEB', 0.5, position, victim, victim);
    expect(spider.applyTaserStun()).toBe(false);
    expect(spider.currentState).toBe('CINEMATIC_SEQUENCE');
    expect(spider.getNetworkSnapshot().cinematicMode).toBe('DRAGGING_TO_WEB');
    spider.relocateAwayAfterAbduction();
    spider.applyShotgunDamage(1000);
    expect(spider.applyTaserStun()).toBe(false);
    expect(spider.isDead).toBe(true);
  });

  it('alterna as duas armas e respeita a recarga também quando o disparo erra', () => {
    const taser = {
      isEquipped: false,
      equip() { this.isEquipped = true; },
      stow() { this.isEquipped = false; },
      fire: vi.fn(),
    };
    const shotgun = {
      isEquipped: true,
      equip() { this.isEquipped = true; },
      stow() { this.isEquipped = false; },
    };
    const sound = { playTaserDischarge: vi.fn() };
    const inventory = { open: false, gameOverVisible: false, hasItem: () => true, wakeShortcutsHub: vi.fn(), getItemCount: () => 4 };
    // A lanterna lateral é guardada quando a shotgun ocupa as duas mãos.
    const flashlight = { isEquipped: true, forceStowImmediate: vi.fn() };
    const game = Object.assign(Object.create(DoomGameApp.prototype), {
      taser, shotgun, sound, inventory, flashlight, engaged: true,
      pauseMenu: { open: false }, danceMenu: { isOpen: false }, danceId: null,
      activeSequence: 'NONE', multiplayer: null, taserRechargeRemaining: 0,
      camera: new THREE.PerspectiveCamera(), stopDance: vi.fn(), updateTaserHud: vi.fn(),
      applyTaserHit: vi.fn(() => false),
    }) as unknown as { toggleTaser(): void; fireTaser(): void; toggleShotgun(): void; taserRechargeRemaining: number; activeSequence: string };
    game.toggleTaser();
    expect(taser.isEquipped).toBe(true);
    expect(shotgun.isEquipped).toBe(false);
    game.fireTaser();
    expect(taser.fire).toHaveBeenCalledTimes(1);
    expect(game.taserRechargeRemaining).toBe(TASER_RECHARGE_SECONDS);
    game.fireTaser();
    expect(taser.fire).toHaveBeenCalledTimes(1);
    game.taserRechargeRemaining = advanceTaserRecharge(game.taserRechargeRemaining, TASER_RECHARGE_SECONDS);
    game.fireTaser();
    expect(taser.fire).toHaveBeenCalledTimes(2);
    game.toggleShotgun();
    expect(taser.isEquipped).toBe(false);
    expect(shotgun.isEquipped).toBe(true);
    expect(flashlight.forceStowImmediate).toHaveBeenCalled();
    game.activeSequence = 'DRAGGING_TO_WEB';
    game.toggleTaser();
    expect(taser.isEquipped).toBe(false);
    expect(sound.playTaserDischarge).toHaveBeenCalledTimes(2);
  });

  it('o host valida posição, direção e intervalo das descargas recebidas', () => {
    const onTaserShot = vi.fn();
    const coordinator = Object.assign(Object.create(DoomMultiplayerCoordinator.prototype), {
      client: { isHost: true }, session: { localPlayerId: 'host' },
      allies: new Map([['guest', { currentPos: new THREE.Vector3(0, 0, 0), dead: false, inSequence: false }]]),
      remoteTaserLastShot: new Map<string, number>(), hooks: { onTaserShot },
    }) as unknown as { handleWorldEvent(event: object): void; remoteTaserLastShot: Map<string, number> };
    const shot = { kind: 'taser_shot', senderId: 'guest', x: 0, y: 1.5, z: 0, dx: 0, dy: 0, dz: -1, ts: 1 };
    coordinator.handleWorldEvent({ ...shot, x: 20 });
    coordinator.handleWorldEvent({ ...shot, dz: 10 });
    expect(onTaserShot).not.toHaveBeenCalled();
    coordinator.handleWorldEvent(shot);
    expect(onTaserShot).toHaveBeenCalledTimes(1);
    coordinator.handleWorldEvent(shot);
    expect(onTaserShot).toHaveBeenCalledTimes(1);
    coordinator.remoteTaserLastShot.set('guest', performance.now() - TASER_RECHARGE_SECONDS * 1000);
    coordinator.handleWorldEvent(shot);
    expect(onTaserShot).toHaveBeenCalledTimes(2);
  });
});

describe('Boca da aranha: presas íntegras e articulação', () => {
  it('usa duas malhas únicas fechadas, afiladas e com normais finitas', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const layout = createRandomArenaLayout({ worldSeed: 517, playerSeed: 517 });
    const webs = new DoomSpiderWebManager(scene, shared, layout);
    const spider = new DoomSpider(scene, shared, [], webs, {} as SoundEngine, layout);
    expect(spider).toBeDefined();

    for (const side of ['Left', 'Right']) {
      const fang = scene.getObjectByName(`Spider${side}Fang`) as THREE.Mesh;
      const base = scene.getObjectByName(`Spider${side}Chelicera`) as THREE.Mesh;
      expect(fang).toBeDefined();
      expect(base).toBeDefined();
      expect(fang.parent).toBe(base.parent);
      const pos = fang.geometry.getAttribute('position');
      const normal = fang.geometry.getAttribute('normal');
      const index = fang.geometry.getIndex()!;
      expect(pos.count).toBe(24 * 12 + 2);
      expect(normal.count).toBe(pos.count);
      const edges = new Map<string, number>();
      for (let i = 0; i < index.count; i += 3) {
        const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        expect(new Set(triangle).size).toBe(3);
        for (let k = 0; k < 3; k++) {
          const a = triangle[k], b = triangle[(k + 1) % 3];
          const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
      expect([...edges.values()].every(count => count === 2)).toBe(true);
      for (let i = 0; i < pos.count; i++) {
        expect([pos.getX(i), pos.getY(i), pos.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)].every(Number.isFinite)).toBe(true);
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4);
      }
      // A ponta fecha a malha, cada anel diminui de raio e a raiz está dentro do paturon.
      let lastRadius = Infinity;
      for (let ring = 0; ring < 24; ring++) {
        const center = new THREE.Vector3();
        for (let j = 0; j < 12; j++) center.add(new THREE.Vector3().fromBufferAttribute(pos, ring * 12 + j));
        center.multiplyScalar(1 / 12);
        const radius = center.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, ring * 12));
        expect(radius).toBeLessThan(lastRadius);
        lastRadius = radius;
      }
      const root = new THREE.Vector3().fromBufferAttribute(pos, 24 * 12)
        .sub(base.position).divide(base.scale);
      expect(root.length()).toBeLessThan(0.098);
      for (let d = 0; d < 3; d++) {
        const tooth = scene.getObjectByName(`Spider${side}MouthTooth${d}`) as THREE.Mesh;
        const toothRoot = new THREE.Vector3(0, -0.0225, 0).applyQuaternion(tooth.quaternion)
          .add(tooth.position).sub(base.position).divide(base.scale);
        expect(toothRoot.length()).toBeLessThan(0.098);
      }
    }
  });

  it('mantém as presas separadas e simétricas ao morder, tecer e capturar', () => {
    const scene = new THREE.Scene();
    const shared = createDoomSharedUniforms();
    const layout = createRandomArenaLayout({ worldSeed: 518, playerSeed: 518 });
    const webs = new DoomSpiderWebManager(scene, shared, layout);
    const sound = { playSpiderScream: () => {}, playSpiderFootstep: () => {}, playSpiderChitter: () => {} } as unknown as SoundEngine;
    const spider = new DoomSpider(scene, shared, [], webs, sound, layout);
    const left = scene.getObjectByName('SpiderLeftFang') as THREE.Mesh;
    const right = scene.getObjectByName('SpiderRightFang') as THREE.Mesh;
    const victim = new THREE.Vector3(0, 0, -2);
    const position = new THREE.Vector3(0, 1.4, 0);
    const boundsInBody = (mesh: THREE.Mesh) => {
      const pivot = mesh.parent!;
      pivot.updateMatrix();
      mesh.updateMatrix();
      const local = mesh.matrix.clone().premultiply(pivot.matrix);
      const p = mesh.geometry.getAttribute('position');
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < p.count; i++) {
        const x = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(local).x;
        min = Math.min(min, x); max = Math.max(max, x);
      }
      return { min, max };
    };
    for (const mode of ['STRIKE_ATTACK', 'DRAGGING_TO_WEB', 'WEBBING_IN_LAIR', 'FATAL_EXECUTION'] as const) {
      for (let frame = 0; frame < 30; frame++) {
        spider.updateCinematicSequence(0.016, frame * 0.037, mode, frame / 30, position, victim, victim);
        const l = boundsInBody(left), r = boundsInBody(right);
        expect(l.max).toBeLessThan(r.min - 0.005);
        expect(l.min).toBeCloseTo(-r.max, 2);
        expect(l.max).toBeCloseTo(-r.min, 2);
        expect(spider.currentState).toBe('CINEMATIC_SEQUENCE');
      }
    }
  });
});

describe('Objetos das salas especiais: abajures, telas e espécime', () => {
  function fixture(kind: 'cabin_nightstand_desk' | 'library_reading_table' | 'crt_workstation_desk' | 'bio_specimen_tank') {
    const scene = new THREE.Group();
    const placement = {
      id: 'test-piece', roomId: 'crew_quarters' as const, kind,
      gx: 0, gz: 0, worldX: 0, worldZ: 0, yaw: 0,
      minX: -1, maxX: 1, minY: 0, maxY: 3, minZ: -1, maxZ: 1,
    };
    const controller = buildDoomThemedRooms(scene, [placement], createDoomTextures(), createDoomSharedUniforms(), []).specialRoomDoors;
    return { scene, controller };
  }

  it('constrói cúpulas abertas e difusores separados e mantém as cadeiras apoiadas', () => {
    for (const [kind, shadeName, minY, maxY] of [
      ['cabin_nightstand_desk', 'MazeRoom_lampShade', 1.07, 1.25],
      ['library_reading_table', 'MazeRoom_bankerShade', 1.10, 1.195],
    ] as const) {
      const { scene, controller } = fixture(kind);
      const shade = scene.getObjectByName(shadeName) as THREE.Mesh;
      const glow = scene.getObjectByName('MazeRoom_warmLampGlow') as THREE.Mesh;
      expect(shade).toBeDefined();
      expect(glow).toBeDefined();
      expect((shade.material as THREE.ShaderMaterial).side).toBe(THREE.DoubleSide);
      const bounds = new THREE.Box3().setFromBufferAttribute(shade.geometry.getAttribute('position') as THREE.BufferAttribute);
      expect(bounds.min.y).toBeCloseTo(minY, 3);
      expect(bounds.max.y).toBeCloseTo(maxY, 3);
      // Casca aberta: 16 faces laterais sem as tampas que ocultavam o difusor.
      expect(shade.geometry.index!.count).toBe(kind === 'library_reading_table' ? 16 * 6 * 2 : 16 * 6);
      const wood = scene.getObjectByName('MazeRoom_weatheredWood') as THREE.Mesh;
      const vertices = wood.geometry.getAttribute('position');
      const hasVertex = (x: number, y: number, z: number) => {
        for (let i = 0; i < vertices.count; i++) {
          if (Math.abs(vertices.getX(i) - x) < 0.0001 &&
              Math.abs(vertices.getY(i) - y) < 0.0001 &&
              Math.abs(vertices.getZ(i) - z) < 0.0001) return true;
        }
        return false;
      };
      if (kind === 'cabin_nightstand_desk') {
        for (const x of [-0.34, -0.02]) for (const z of [0.09, 0.35]) {
          expect(hasVertex(x - 0.02, 0, z - 0.02)).toBe(true);
          expect(hasVertex(x - 0.02, 0.415, z - 0.02)).toBe(true);
        }
      } else {
        for (const chairX of [-0.36, 0.36]) for (const side of [-1, 1]) {
          for (const dx of [-0.17, 0.17]) for (const z of [0.28, 0.56]) {
            expect(hasVertex(chairX + dx - 0.025, 0, side * z - 0.025)).toBe(true);
          }
        }
      }
      controller.dispose();
    }
  });

  it('anima somente os visores eletrônicos com relógio estável, sem alterar luzes ou portas', () => {
    const { scene, controller } = fixture('crt_workstation_desk');
    const screen = scene.getObjectByName('MazeRoom_computerScreen') as THREE.Mesh;
    const light = scene.getObjectByName('MazeRoom_crtScreen') as THREE.Mesh;
    const material = screen.material as THREE.ShaderMaterial;
    expect(material).not.toBe(light.material);
    expect(material.fragmentShader).toContain('uComputerTime');
    expect(material.fragmentShader).toContain('graphUv');
    expect(material.uniforms.uComputerTime.value).toBe(0);
    controller.update(1.25);
    expect(material.uniforms.uComputerTime.value).toBeCloseTo(1.25);
    controller.update(-1);
    controller.update(NaN);
    expect(material.uniforms.uComputerTime.value).toBeCloseTo(1.25);
    controller.update(400);
    expect(material.uniforms.uComputerTime.value).toBeCloseTo(1.25);
    expect((light.material as THREE.ShaderMaterial).uniforms.uComputerTime).toBeUndefined();
    expect(controller.doors.every(door => !door.unlocked && door.openProgress === 0)).toBe(true);
    controller.dispose();
  });

  it('usa vidro transparente sem escrita de profundidade no tanque biológico', () => {
    const { scene, controller } = fixture('bio_specimen_tank');
    const glass = scene.getObjectByName('MazeRoom_specimenGlass') as THREE.Mesh;
    const material = glass.material as THREE.ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.fragmentShader).toContain('0.26');
    controller.dispose();
  });
});
