import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createAstronautMaterials,
  DoomAstronaut,
} from '../src/doom/DoomAstronaut';
import { DoomFlashlight, QuickHandheldKind } from '../src/doom/DoomFlashlight';
import {
  createInitialSlideState,
  stepPlayerSlideState,
} from '../src/doom/DoomGameApp';
import {
  computeShortcutsHubState,
  ITEM_CATALOG,
  QUICK_SLOT_COUNT,
  renderFirstPersonWebOverlay,
} from '../src/doom/DoomInventory';
import {
  buildDoomLabyrinth,
  evaluateDoomLightFlicker,
  gridCellToWorld,
  isSolidCell,
  isStoneSectorWorld,
  LABYRINTH_MAP,
  LAIR_GRID_CELL,
  syncLightPanelEmissionAttribute,
  syncNearestDoomLightsToUniforms,
  WALL_HEIGHT,
  worldToGridCell,
} from '../src/doom/DoomMazeBuilder';
import {
  DoomRadar,
  getSectorNameForCell,
  RADAR_CANVAS_SIZE,
  renderRadarMinimapCanvas,
} from '../src/doom/DoomRadar';
import {
  createDoomSharedUniforms,
  MAX_DOOM_LIGHTS,
} from '../src/doom/DoomShader';
import { DoomSpider } from '../src/doom/DoomSpider';
import { DoomSpiderWebManager } from '../src/doom/DoomSpiderWebs';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import { SoundEngine } from '../src/engine/audio/SoundEngine';
import {
  clearLocalMirrorRoomsForTests,
  formatRoomCodeDisplay,
  MultiplayerLobbyService,
  normalizeRoomCode,
} from '../src/multiplayer/MultiplayerService';
import { BINARY_MENU_ITEMS } from '../src/terminal/TerminalBoot';

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

    // Modelo 3D completo com capacete/viseira dourada, mochila PLSS, tronco, pernas e ambos os braços EVA
    expect(astronaut.headGroup.name).toBe('AstronautHelmet');
    expect(astronaut.plssBackpack.name).toBe('AstronautPLSSBackpack');

    let totalAstronautMeshes = 0;
    astronaut.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) totalAstronautMeshes++;
    });
    expect(totalAstronautMeshes).toBeGreaterThan(75);

    // Ambos os braços do Astronauta são explicitamente marcados como braços ativos de gameplay
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
    }
    // Braço esquerdo possui manômetro analógico no pulso
    expect(astronaut.leftArm.gaugeNeedleMesh).not.toBeNull();

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

    // Modo 3ª pessoa restaura capacete, mochila PLSS e ambos os braços EVA completos para aliados Multiplayer
    astronaut.setFirstPersonMode(false);
    expect(astronaut.root.visible).toBe(true);
    expect(astronaut.headGroup.visible).toBe(true);
    expect(astronaut.headGroup.children.length).toBeGreaterThanOrEqual(16);
    expect(astronaut.plssBackpack.visible).toBe(true);
    expect(astronaut.plssBackpack.children.length).toBeGreaterThanOrEqual(36);
    expect(astronaut.plssBackpack.visible).toBe(true);
    expect(astronaut.leftArm.root.visible).toBe(true);
    expect(astronaut.rightArm.root.visible).toBe(true);

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
    const lairWorld = gridCellToWorld(LAIR_GRID_CELL.gx, LAIR_GRID_CELL.gz);
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

    // 3) Transição acústica precisa entre setores industriais Norte e Catacumbas Sul
    expect(
      isStoneSectorWorld(maze.spawnPosition.x, maze.spawnPosition.z)
    ).toBe(false);
    expect(isStoneSectorWorld(lairWorld.x, lairWorld.z)).toBe(true);

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
    const fwd = new THREE.Vector3(0, 0, -1);
    for (let gz = 1; gz < 28; gz++) {
      for (let gx = 1; gx < 28; gx++) {
        if (isSolidCell(LABYRINTH_MAP, gx, gz)) continue;
        const w = gridCellToWorld(gx, gz);
        items.updateAndCheckPickups(
          0.016,
          0,
          new THREE.Vector3(w.x, 0, w.z),
          new THREE.Vector3(w.x, 1.72, w.z),
          fwd,
          false,
          invMock as never
        );
      }
    }
    expect(collectedCount).toBe(25);
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
    expect(initialSignals.length).toBe(25);
    for (const sig of initialSignals) {
      const cell = worldToGridCell(sig.probableX, sig.probableZ);
      expect(isSolidCell(LABYRINTH_MAP, cell.gx, cell.gz)).toBe(false);
      expect(sig.uncertaintyRadiusM).toBeGreaterThan(1.0);
    }

    // 2) Ao caminhar até (5, 1) no corredor inicial, o jogador encontra e ativa o Radar Topográfico!
    const radar = new DoomRadar(null);
    expect(radar.hasRadar).toBe(false);
    expect(radar.isActive).toBe(false);

    const radarCellWorld = gridCellToWorld(5, 1);
    let radarPicked = false;
    items.updateAndCheckPickups(
      0.016,
      0,
      new THREE.Vector3(radarCellWorld.x + 0.12, 0, radarCellWorld.z + 0.54),
      new THREE.Vector3(radarCellWorld.x + 0.12, 1.72, radarCellWorld.z + 0.54),
      new THREE.Vector3(1, 0, 0),
      false,
      { addItem: () => true } as never,
      (itemId) => {
        if (itemId === 'field_radar') {
          radarPicked = true;
          radar.unlockAndActivate();
        }
      }
    );

    expect(radarPicked).toBe(true);
    expect(radar.hasRadar).toBe(true);
    expect(radar.isActive).toBe(true);

    // O item coletado deixa de emitir sinal provável no radar (25 -> 24)
    const remainingSignals = items.getUncollectedEquipmentSignals();
    expect(remainingSignals.length).toBe(24);

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
    explored[1 * 29 + 5] = 1;
    renderRadarMinimapCanvas(mockCtx, {
      playerX: radarCellWorld.x,
      playerZ: radarCellWorld.z,
      playerYaw: -Math.PI * 0.5,
      elapsedSec: 2.5,
      mode: 'FULL',
      exploredMask: explored,
      signals: remainingSignals,
    });

    // Verifica que os 24 anéis prováveis + feixe + cone direcional foram desenhados, além do núcleo branco na posição exata do jogador!
    expect(arcCalls).toBeGreaterThanOrEqual(26);
    const expectedPxX = Math.round(
      ((radarCellWorld.x + (29 * 3) / 2) / (29 * 3)) * RADAR_CANVAS_SIZE
    );
    const expectedPxY = Math.round(
      ((radarCellWorld.z + (29 * 3) / 2) / (29 * 3)) * RADAR_CANVAS_SIZE
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
    expect(BINARY_MENU_ITEMS).toEqual(['INICIAR', 'MULTIPLAYER', 'SAIR']);

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

    for (let gz = 2; gz < LABYRINTH_MAP.length - 3 && !foundCorner; gz++) {
      for (let gx = 2; gx < LABYRINTH_MAP[gz].length - 3 && !foundCorner; gx++) {
        // Corredor horizontal (gx-2, gz) -> (gx, gz) que dobra para (gx, gz+2) com parede sólida em (gx-1, gz+1)
        if (
          !isSolidCell(LABYRINTH_MAP, gx - 2, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx - 1, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx, gz) &&
          !isSolidCell(LABYRINTH_MAP, gx, gz + 1) &&
          !isSolidCell(LABYRINTH_MAP, gx, gz + 2) &&
          isSolidCell(LABYRINTH_MAP, gx - 1, gz + 1) &&
          isSolidCell(LABYRINTH_MAP, gx - 1, gz + 2)
        ) {
          cellA = gridCellToWorld(gx - 2, gz);
          cornerB = gridCellToWorld(gx, gz);
          hideC = gridCellToWorld(gx, gz + 2);
          foundCorner = true;
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
});
