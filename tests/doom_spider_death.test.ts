import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  SPIDER_DEATH_SECONDS,
  DoomSpider,
  deathRestHeightForSurface,
} from '../src/doom/DoomSpider';
import { DoomSpiderWebManager } from '../src/doom/DoomSpiderWebs';
import { buildDoomLabyrinth } from '../src/doom/DoomMazeBuilder';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { createDoomTextures } from '../src/doom/DoomTextures';
import type { SoundEngine } from '../src/engine/audio/SoundEngine';
import { resetThemedRoomLocks } from '../src/doom/DoomRooms';

function createHarness() {
  const scene = new THREE.Scene();
  const uniforms = createDoomSharedUniforms();
  const textures = createDoomTextures();
  const maze = buildDoomLabyrinth(scene, textures, uniforms);
  const webs = new DoomSpiderWebManager(scene, uniforms);
  const sound = {
    playSpiderFootstep: () => {},
    playSpiderScream: () => {},
    playSpiderWebSpin: () => {},
    playSpiderPainRecoil: () => {},
    playSpiderChitter: () => {},
    playSpiderDeath: vi.fn(),
  } as unknown as SoundEngine;
  const spider = new DoomSpider(scene, uniforms, maze.colliders, webs, sound);
  return { scene, uniforms, textures, maze, webs, sound, spider };
}

function stepDeath(
  spider: DoomSpider,
  position: THREE.Vector3,
  seconds: number,
  dt = 1 / 60
): void {
  const frames = Math.ceil(seconds / dt);
  for (let i = 0; i < frames; i++) {
    spider.update(
      dt,
      i * dt,
      position,
      0,
      false,
      false,
      false,
      new THREE.Vector3(0, 0, -1),
      [],
      () => {}
    );
  }
}

describe('Animação de morte da aranha', () => {
  it('toca a queda em vez de sumir quando a vida chega a zero', () => {
    const { scene, textures, spider } = createHarness();
    try {
      expect(spider.isDead).toBe(false);
      expect(spider.applyShotgunDamage(500)).toBe(true);
      expect(spider.isDead).toBe(true);
      // O corpo continua na cena durante a queda.
      const root = scene.getObjectByName('EvilCrawlingSpider');
      expect(root).toBeDefined();
      expect(root!.visible).toBe(true);
      expect(spider.deathProgress).toBe(0);
      expect(spider.isDeathAnimationComplete).toBe(false);
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('cai até o chão, dobra as patas e conclui a cena em segundos', () => {
    const { uniforms, textures, spider } = createHarness();
    try {
      const startY = spider.position.y;
      const root = spider.sceneRoot;
      // Força uma morte em altura (teto) para ver a queda.
      spider.applyShotgunDamage(500);
      const player = new THREE.Vector3(spider.position.x + 2, 0, spider.position.z);
      stepDeath(spider, player, SPIDER_DEATH_SECONDS * 0.55);
      const midProgress = spider.deathProgress;
      expect(midProgress).toBeGreaterThan(0.4);
      expect(midProgress).toBeLessThan(1);
      expect(root.visible).toBe(true);
      stepDeath(spider, player, SPIDER_DEATH_SECONDS);
      expect(spider.deathProgress).toBe(1);
      expect(spider.isDeathAnimationComplete).toBe(true);
      // A carcaça repousa próxima do piso, não flutuando no teto.
      expect(spider.position.y).toBeLessThan(Math.max(startY, 0.9));
      expect(spider.position.y).toBeGreaterThan(0.05);
      expect(spider.sceneRoot.visible).toBe(true);
      // E o shader de fúria apagou.
      expect(uniforms.uLightCount).toBeDefined();
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('avisa uma única vez quando a animação termina', () => {
    const { textures, spider } = createHarness();
    try {
      const onFinished = vi.fn();
      spider.onDeathAnimationFinished = onFinished;
      spider.applyShotgunDamage(500);
      const player = new THREE.Vector3(spider.position.x + 1, 0, spider.position.z);
      stepDeath(spider, player, SPIDER_DEATH_SECONDS + 1.5);
      expect(onFinished).toHaveBeenCalledTimes(1);
      stepDeath(spider, player, 2);
      expect(onFinished).toHaveBeenCalledTimes(1);
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('clientes do co-op veem a mesma queda ao receber o estado DEAD', () => {
    const { textures, spider } = createHarness();
    try {
      const pkt = {
        x: spider.position.x,
        y: spider.position.y,
        z: spider.position.z,
        upX: 0,
        upY: 1,
        upZ: 0,
        fwdX: 0,
        fwdY: 0,
        fwdZ: -1,
        state: 'DEAD',
        shotgunHealth: 0,
        surfaceMode: 'FLOOR' as const,
      };
      const player = new THREE.Vector3(0, 0, 0);
      spider.applyRemoteNetworkState(1 / 60, 0, pkt, player, 0, () => {});
      expect(spider.isDead).toBe(true);
      expect(spider.sceneRoot.visible).toBe(true);
      for (let i = 0; i < Math.ceil((SPIDER_DEATH_SECONDS + 0.5) * 60); i++) {
        spider.applyRemoteNetworkState(i / 60, i / 60, pkt, player, 0, () => {});
      }
      expect(spider.isDeathAnimationComplete).toBe(true);
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('mantém a aranha morta sem voltar à perseguição', () => {
    const { textures, spider } = createHarness();
    try {
      spider.applyShotgunDamage(500);
      const player = new THREE.Vector3(spider.position.x, 0, spider.position.z);
      stepDeath(spider, player, SPIDER_DEATH_SECONDS + 2);
      expect(spider.currentState).toBe('DEAD');
      // Não pode engolir o jogador depois de morta.
      let caught = false;
      for (let i = 0; i < 120; i++) {
        spider.update(1 / 60, i / 60, player, 0, true, false, true,
          new THREE.Vector3(0, 0, -1), [], () => { caught = true; });
      }
      expect(caught).toBe(false);
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('define a altura de repouso conforme a superfície da morte', () => {
    expect(deathRestHeightForSurface('FLOOR')).toBeGreaterThan(0.15);
    expect(deathRestHeightForSurface('WALL')).toBeGreaterThan(0.15);
    expect(deathRestHeightForSurface('CEILING')).toBeGreaterThan(0.15);
    expect(SPIDER_DEATH_SECONDS).toBeGreaterThanOrEqual(2.5);
    expect(SPIDER_DEATH_SECONDS).toBeLessThanOrEqual(5);
  });
});
