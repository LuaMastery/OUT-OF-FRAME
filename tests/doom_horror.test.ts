import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DoomFlashlight } from '../src/doom/DoomFlashlight';
import {
  ITEM_CATALOG,
  QUICK_SLOT_COUNT,
  renderFirstPersonWebOverlay,
} from '../src/doom/DoomInventory';
import {
  buildDoomLabyrinth,
  gridCellToWorld,
  isSolidCell,
  LABYRINTH_MAP,
  worldToGridCell,
} from '../src/doom/DoomMazeBuilder';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { DoomSpider } from '../src/doom/DoomSpider';
import { DoomSpiderWebManager } from '../src/doom/DoomSpiderWebs';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { DoomWorldItems } from '../src/doom/DoomWorldItems';
import { SoundEngine } from '../src/engine/audio/SoundEngine';

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
    expect(built.lights.length).toBeGreaterThan(8);

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
});
