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

describe('Labirinto, Armadilhas de Teia & Aranha Procedural (Evil Crawler)', () => {
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

  it('anda devagar em patrulha, dispara em alta velocidade ao encontrar o jogador e gera malha IK válida sem NaN', () => {
    const scene = new THREE.Scene();
    const uniforms = createDoomSharedUniforms();
    const textures = createDoomTextures();
    const maze = buildDoomLabyrinth(scene, textures, uniforms);
    const webs = new DoomSpiderWebManager(scene, uniforms);

    const mockSound = {
      playSpiderFootstep: () => {},
      playSpiderScream: () => {},
      playSpiderWebSpin: () => {},
      playSpiderCaptureImpact: () => {},
      playStruggleEffort: () => {},
      playItemUse: () => {},
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
        false,
        false,
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
        false,
        false,
        [],
        () => {}
      );
    }
    const chaseDist = Math.hypot(
      spider.position.x - chaseStart.x,
      spider.position.z - chaseStart.z
    );
    expect(chaseDist).toBeGreaterThan(stalkDist * 2.5);

    // Verifica que todas as malhas de patas tubulares possuem coordenadas finitas (sem NaN)
    const spiderRoot = scene.getObjectByName('EvilCrawlingSpider')!;
    let checkedVertices = 0;
    spiderRoot.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const pos = obj.geometry.getAttribute('position');
        for (let k = 0; k < pos.count; k++) {
          expect(Number.isFinite(pos.getX(k))).toBe(true);
          expect(Number.isFinite(pos.getY(k))).toBe(true);
          expect(Number.isFinite(pos.getZ(k))).toBe(true);
          checkedVertices++;
        }
      }
    });
    expect(checkedVertices).toBeGreaterThan(700);
  });
});
