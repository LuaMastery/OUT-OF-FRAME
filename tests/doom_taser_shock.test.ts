import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DoomTaserViewmodel,
  buildTaserArcSegments,
  taserImpactDistance,
  TASER_RANGE,
} from '../src/doom/DoomTaser';
import { DoomSpider } from '../src/doom/DoomSpider';
import { DoomSpiderWebManager } from '../src/doom/DoomSpiderWebs';
import { buildDoomLabyrinth } from '../src/doom/DoomMazeBuilder';
import { createDoomSharedUniforms } from '../src/doom/DoomShader';
import { createDoomTextures } from '../src/doom/DoomTextures';
import { resetThemedRoomLocks } from '../src/doom/DoomRooms';
import type { SoundEngine } from '../src/engine/audio/SoundEngine';

/** Conta peças do modelo e coleta nomes, para checar a riqueza da modelagem. */
function describeModel(root: THREE.Object3D) {
  const names: string[] = [];
  let meshes = 0;
  let vertices = 0;
  root.traverse((child) => {
    if (child.name) names.push(child.name);
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      meshes += 1;
      const position = mesh.geometry.getAttribute('position');
      if (position) vertices += position.count;
    }
  });
  return { names, meshes, vertices };
}

function createSpiderHarness() {
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
    playSpiderDeath: () => {},
  } as unknown as SoundEngine;
  return {
    uniforms,
    textures,
    spider: new DoomSpider(scene, uniforms, maze.colliders, webs, sound),
  };
}

describe('Modelagem 3D do Taser', () => {
  it('tem silhueta detalhada em vez do bloco simples anterior', () => {
    const taser = new DoomTaserViewmodel(16 / 9);
    const model = describeModel(taser.viewScene);
    try {
      // A versão antiga tinha ~10 caixas; agora há peças esculpidas de verdade.
      expect(model.meshes).toBeGreaterThan(30);
      expect(model.vertices).toBeGreaterThan(600);
      // Peças identificáveis para manutenção e terceira pessoa.
      expect(model.names).toContain('TaserViewmodelHand');
      expect(model.names).toContain('TaserBody');
      expect(model.names).toContain('TaserChargeLed');
      expect(model.names).toContain('TaserArcCore');
      expect(model.names).toContain('TaserArcGlow');
    } finally {
      taser.dispose();
    }
  });

  it('mantém a arma escondida até equipar e visível no uso', () => {
    const taser = new DoomTaserViewmodel(16 / 9);
    try {
      expect(taser.isEquipped).toBe(false);
      expect(taser.isVisibleInView).toBe(false);
      taser.equip();
      for (let i = 0; i < 40; i++) taser.update(1 / 60, i * 0.1, 0);
      expect(taser.isVisibleInView).toBe(true);
      taser.stow();
      for (let i = 0; i < 80; i++) taser.update(1 / 60, 0, 0);
      expect(taser.isVisibleInView).toBe(false);
    } finally {
      taser.dispose();
    }
  });

  it('solta um arco elétrico que se redesenha e apaga depois do disparo', () => {
    const taser = new DoomTaserViewmodel(16 / 9);
    try {
      taser.equip();
      for (let i = 0; i < 20; i++) taser.update(1 / 60, 0, 0);
      expect(taser.arcVisible).toBe(false);
      taser.fire();
      expect(taser.isDischarging).toBe(true);
      expect(taser.arcVisible).toBe(true);
      const before = JSON.stringify(
        (taser.viewScene.getObjectByName('TaserArcCore') as THREE.Line).geometry.getAttribute('position').array
      );
      taser.update(1 / 60, 0, 0);
      const after = JSON.stringify(
        (taser.viewScene.getObjectByName('TaserArcCore') as THREE.Line).geometry.getAttribute('position').array
      );
      expect(after).not.toBe(before);
      for (let i = 0; i < 40; i++) taser.update(1 / 60, 0, 0);
      expect(taser.arcVisible).toBe(false);
      expect(taser.isDischarging).toBe(false);
    } finally {
      taser.dispose();
    }
  });

  it('gera arcos com zigue-zague entre os eletrodos', () => {
    const from = new THREE.Vector3(-0.03, 0.008, -0.392);
    const to = new THREE.Vector3(0.03, 0.008, -0.392);
    const points = buildTaserArcSegments(from, to, 42);
    expect(points.length).toBeGreaterThanOrEqual(6);
    expect(points[0].distanceTo(from)).toBeLessThan(1e-6);
    expect(points[points.length - 1].distanceTo(to)).toBeLessThan(1e-6);
    // Nem todos os pontos ficam na linha reta.
    const offAxis = points.slice(1, -1).some((p) => Math.abs(p.y - from.y) > 1e-4);
    expect(offAxis).toBe(true);
  });

  it('versão de terceira pessoa não carrega a mão nem o arco ligado', () => {
    const taser = new DoomTaserViewmodel(16 / 9);
    try {
      const third = taser.createThirdPersonWeapon();
      expect(third.getObjectByName('TaserViewmodelHand')).toBeUndefined();
      const arc = third.getObjectByName('TaserArcCore') as THREE.Line | undefined;
      expect(arc?.visible ?? false).toBe(false);
      expect(third.visible).toBe(true);
      const model = describeModel(third);
      expect(model.meshes).toBeGreaterThan(25);
    } finally {
      taser.dispose();
    }
  });

  it('mede o alcance e respeita as paredes do labirinto', () => {
    const origin = new THREE.Vector3(0, 1.5, 0);
    const target = new THREE.Vector3(0, 0.5, -3);
    const dir = new THREE.Vector3(0, 0, -1);
    expect(taserImpactDistance(origin, dir, target, [])).toBeGreaterThan(0);
    // Alvo atrás de uma parede não é atingido.
    const wall = new THREE.Box3(new THREE.Vector3(-3, 0, -1.4), new THREE.Vector3(3, 3, -1.2));
    expect(taserImpactDistance(origin, dir, target, [wall])).toBeNull();
    // Alvo fora do alcance.
    const far = new THREE.Vector3(0, 0.5, -(TASER_RANGE + 4));
    expect(taserImpactDistance(origin, dir, far, [])).toBeNull();
  });
});

describe('Animação de choque da aranha', () => {
  it('entra em convulsão ao levar o taser: arcos ligados e brilho azul', () => {
    const { spider, uniforms, textures } = createSpiderHarness();
    try {
      const arcs = findShockRig(spider);
      expect(arcs).toBeDefined();
      expect(arcs!.visible).toBe(false);
      expect(spider.applyTaserStun()).toBe(true);
      expect(spider.isStunned).toBe(true);
      const player = new THREE.Vector3(spider.position.x + 3, 0, spider.position.z);
      for (let i = 0; i < 12; i++) {
        spider.update(1 / 60, i / 60, player, 0, false, false, false,
          new THREE.Vector3(0, 0, -1), [], () => {});
      }
      expect(arcs!.visible).toBe(true);
      // Shader de choque aceso no material da quitina.
      const chitin = findMaterial(spider, 'uShockGlow');
      expect(chitin).toBeDefined();
      expect(chitin!.uniforms.uShockGlow.value).toBeGreaterThan(0.1);
      expect(uniforms.uLightCount).toBeDefined();
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('relaxa e volta a caçar quando a carga acaba', () => {
    const { spider, textures } = createSpiderHarness();
    try {
      const arcs = findShockRig(spider);
      spider.applyTaserStun();
      const player = new THREE.Vector3(spider.position.x + 3, 0, spider.position.z);
      const frames = Math.ceil((5 + 0.5) * 60);
      for (let i = 0; i < frames; i++) {
        spider.update(1 / 60, i / 60, player, 0, false, false, false,
          new THREE.Vector3(0, 0, -1), [], () => {});
      }
      expect(spider.isStunned).toBe(false);
      // Ela retoma a caça (o estado volta a ser um comportamento ativo, não o atordoamento).
      expect(['STALK_PATROL', 'FRENZY_CHASE']).toContain(spider.currentState);
      expect(arcs!.visible).toBe(false);
      const chitin = findMaterial(spider, 'uShockGlow');
      expect(chitin!.uniforms.uShockGlow.value).toBe(0);
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('não atordoa aranha morta nem em cena de captura', () => {
    const { spider, textures } = createSpiderHarness();
    try {
      spider.applyShotgunDamage(9999);
      expect(spider.applyTaserStun()).toBe(false);
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });

  it('clientes do co-op reproduzem o choque recebido do host', () => {
    const { spider, textures } = createSpiderHarness();
    try {
      const arcs = findShockRig(spider);
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
        state: 'STUNNED',
        shotgunHealth: 100,
        stunRemaining: 4.5,
        surfaceMode: 'FLOOR' as const,
      };
      const player = new THREE.Vector3(0, 0, 0);
      for (let i = 0; i < 10; i++) {
        spider.applyRemoteNetworkState(1 / 60, i / 60, pkt, player, 0, () => {});
      }
      expect(arcs!.visible).toBe(true);
      const chitin = findMaterial(spider, 'uShockGlow');
      expect(chitin!.uniforms.uShockGlow.value).toBeGreaterThan(0.1);
      // Sem estado de atordoamento, o efeito desliga.
      spider.applyRemoteNetworkState(1 / 60, 1, { ...pkt, state: 'STALK_PATROL', stunRemaining: 0 }, player, 0, () => {});
      expect(chitin!.uniforms.uShockGlow.value).toBe(0);
    } finally {
      Object.values(textures).forEach((t) => t.dispose());
      resetThemedRoomLocks();
    }
  });
});

/** Localiza o rig de arcos dentro do corpo da aranha (uso interno do teste). */
function findShockRig(spider: DoomSpider): { visible: boolean } | undefined {
  const internal = spider as unknown as { stunArcs?: { visible: boolean } };
  return internal.stunArcs;
}

/** Localiza o material de quitina pela uniforme de choque. */
function findMaterial(
  spider: DoomSpider,
  uniformName: string
): { uniforms: Record<string, { value: number }> } | undefined {
  const internal = spider as unknown as {
    chitinMat?: { uniforms: Record<string, { value: number }> };
  };
  const material = internal.chitinMat;
  return material && uniformName in material.uniforms ? material : undefined;
}
