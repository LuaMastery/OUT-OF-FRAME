import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG } from '../src/doom/DoomInventory';
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
});
