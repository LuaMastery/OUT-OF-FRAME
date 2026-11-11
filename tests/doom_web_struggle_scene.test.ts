import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DoomAstronaut } from '../src/doom/DoomAstronaut';
import { DoomFlashlight } from '../src/doom/DoomFlashlight';
import { buildDoomLabyrinth } from '../src/doom/DoomMazeBuilder';
import { createRandomArenaLayout } from '../src/doom/DoomArenaRandomizer';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { DoomSpiderWebManager } from '../src/doom/DoomSpiderWebs';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { resetThemedRoomLocks } from '../src/doom/DoomRooms';
import { WebStruggleState } from '../src/doom/DoomWebStruggle';
import type { SoundEngine } from '../src/engine/audio/SoundEngine';

const silentSound = {
  playWebTrapSnap: () => {},
  playWebCut: () => {},
} as unknown as SoundEngine;

function makeWebs() {
  resetThemedRoomLocks();
  const scene = new THREE.Scene();
  const uniforms = createDoomSharedUniforms();
  const textures = createDoomTextures();
  buildDoomLabyrinth(scene, textures, uniforms);
  const layout = createRandomArenaLayout({ worldSeed: 42, playerSeed: 7 });
  return new DoomSpiderWebManager(scene, uniforms, layout);
}

/** Preso numa armadilha de corredor, com o jogador em cima dela. */
function ensnare(webs: DoomSpiderWebManager) {
  const spot = new THREE.Vector3(
    webs.lairCenter.x + 0.4,
    0,
    webs.lairCenter.z + 0.4
  );
  const trap = webs.spawnWebTrap(spot.x, spot.z, true) ?? webs.getActiveTraps()[0];
  spot.set(trap.position.x, 0, trap.position.z);
  webs.update(0.016, spot, false, false, silentSound, () => {});
  return spot;
}

describe('Luta na teia: cenas 3D e viewmodel', () => {
  it('faz os fios ao redor do corpo vibrarem com o esforço', () => {
    const webs = makeWebs();
    const player = ensnare(webs);
    expect(webs.isPlayerEnsnared).toBe(true);

    const tether = (webs as unknown as {
      playerSnareTetherGroup: THREE.Group;
    }).playerSnareTetherGroup;
    const strand = (): THREE.Vector3 =>
      (tether.children[0].children[1] as THREE.Mesh).position.clone();

    const measureDrift = (
      state: WebStruggleState,
      danger01: number,
      mashing: boolean
    ): number => {
      let previous = strand();
      let drift = 0;
      for (let i = 0; i < 40; i++) {
        const pose = state.step({
          ensnared: true,
          strugglePressed: mashing && i % 12 === 0,
          struggleHeld: mashing && i % 12 < 5,
          hasKnife: mashing,
          danger01,
          dt: 1 / 60,
        });
        webs.update(1 / 60, player, false, false, silentSound, () => {}, pose);
        const current = strand();
        drift = Math.max(drift, current.distanceTo(previous));
        previous = current;
      }
      return drift;
    };

    const calm = measureDrift(new WebStruggleState(), 0, false);
    const fighting = measureDrift(new WebStruggleState(), 1, true);
    // Parado e sem perigo a seda quase não se mexe; lutando ela chicoteia.
    expect(calm).toBeLessThan(0.0006);
    expect(fighting).toBeGreaterThan(calm * 8);
  });

  it('debate o traje em 3ª pessoa cada vez mais conforme o perigo', () => {
    const scene = new THREE.Scene();
    const astro = new DoomAstronaut(scene, createDoomSharedUniforms());
    const origin = new THREE.Vector3();

    const headRange = (danger01: number, mashing: boolean): number => {
      const state = new WebStruggleState();
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < 150; i++) {
        const pose = state.step({
          ensnared: true,
          strugglePressed: mashing && i % 10 === 0,
          struggleHeld: mashing && i % 10 < 4,
          hasKnife: mashing,
          danger01,
          dt: 1 / 60,
        });
        astro.updateThirdPersonAlly(
          origin, 0, 0, i * 0.05, 0, 0, false, true, false, false, null, 1 / 60, 0, pose
        );
        min = Math.min(min, astro.headGroup.rotation.x);
        max = Math.max(max, astro.headGroup.rotation.x);
      }
      return max - min;
    };

    const calm = headRange(0, false);
    const panic = headRange(1, true);
    expect(panic).toBeGreaterThan(calm * 1.8);
    // Sem pose (chamada antiga) o traje continua na pose estática de antes.
    astro.updateThirdPersonAlly(
      origin, 0, 0, 1, 0, 0, false, true, false, false, null, 1 / 60, 0, null
    );
    expect(astro.bodyPivot.rotation.y).toBeCloseTo(Math.sin(2.4) * 0.03 * 0.3, 6);
    expect(astro.getMarkedArms().left.shoulderPivot.rotation.y).toBeCloseTo(0.36, 6);
  });

  it('mostra o braço esquerdo lutando em 1ª pessoa e o esconde ao se soltar', () => {
    const flashlight = new DoomFlashlight(16 / 9);
    const viewScene = (flashlight as unknown as { viewScene: THREE.Scene }).viewScene;
    const state = new WebStruggleState();

    const armChainVisible = (): boolean => {
      const arm = viewScene.getObjectByName('AstronautLeftArm');
      if (!arm) return false;
      let node: THREE.Object3D | null = arm;
      while (node && node !== viewScene) {
        if (!node.visible) return false;
        node = node.parent;
      }
      return true;
    };

    expect(armChainVisible()).toBe(false);

    const advance = (ensnared: boolean, danger01: number, mashing: boolean) => {
      for (let i = 0; i < 90; i++) {
        const pose = state.step({
          ensnared,
          strugglePressed: mashing && i % 14 === 0,
          struggleHeld: mashing && i % 14 < 5,
          hasKnife: true,
          danger01,
          dt: 1 / 60,
        });
        flashlight.setWebStruggle(pose);
        flashlight.update(1 / 60, 0, 0, () => {}, 0, 100, 0);
      }
    };

    advance(true, 0.9, true);
    expect(armChainVisible()).toBe(true);

    advance(false, 0, false);
    expect(armChainVisible()).toBe(false);
  });

  it('arrasta a lanterna para baixo enquanto os braços estão presos', () => {
    const flashlight = new DoomFlashlight(16 / 9);
    flashlight.toggle(); // empunha a lanterna (atalho F)
    const viewScene = (flashlight as unknown as { viewScene: THREE.Scene }).viewScene;
    const lanternRoot = viewScene.getObjectByName('FlashlightViewmodelRoot')!;
    const state = new WebStruggleState();

    const settle = (ensnared: boolean) => {
      let pose = state.current;
      for (let i = 0; i < 120; i++) {
        pose = state.step({
          ensnared,
          strugglePressed: false,
          struggleHeld: false,
          hasKnife: false,
          danger01: 0,
          dt: 1 / 60,
        });
        flashlight.setWebStruggle(pose);
        flashlight.update(1 / 60, 0, 0, () => {}, 0, 100, 0);
      }
      return pose;
    };

    const freeBound = settle(false).bound01;
    const freeY = lanternRoot.position.y;
    const boundBound = settle(true).bound01;
    expect(freeBound).toBe(0);
    expect(boundBound).toBeGreaterThan(0.95);
    // A seda puxa o antebraço (e a lanterna) para baixo e para o tronco.
    expect(lanternRoot.position.y).toBeLessThan(freeY - 0.05);
  });
});
