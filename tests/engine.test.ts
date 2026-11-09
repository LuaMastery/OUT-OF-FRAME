import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defineComponent, World } from '../src/engine/ecs/World';
import {
  captureTransformToFrame,
  extractWorldSubFrustum,
  reprojectTransformFromFrame,
} from '../src/engine/math/SubFrustum';
import { sweepSegmentVsBox, sweepSegmentVsSphere } from '../src/engine/physics/SpatialSweep';
import {
  LOCKED_KEYBOARD_CODES,
  shouldPreventBrowserShortcut,
} from '../src/engine/input/BrowserShortcutGuard';
import { ChronoKernel } from '../src/engine/time/ChronoKernel';

const CompA = defineComponent<{ value: number }>('TestA');
const CompStasis = defineComponent<{ frozen: boolean }>('TestStasis');

describe('ECS Geracional & Máscaras de Bits', () => {
  it('invalida handles antigos após reciclagem de slot e filtra por withoutMask', () => {
    const world = new World(8);
    const e1 = world.createEntity();
    world.add(e1, CompA, { value: 42 });

    expect(world.isAlive(e1)).toBe(true);
    expect(world.query(CompA.bit)).toEqual([e1]);

    // Suspende por máscara de exclusão (mesma técnica do PocketStasis)
    world.add(e1, CompStasis, { frozen: true });
    expect(world.query(CompA.bit, CompStasis.bit)).toEqual([]);

    // Destrói e recicla slot: handle e1 antigo não pode ser válido para e2!
    world.destroyEntity(e1);
    const e2 = world.createEntity();
    expect(world.isAlive(e1)).toBe(false);
    expect(world.isAlive(e2)).toBe(true);
    expect(e2).not.toBe(e1);
  });
});

describe('ChronoKernel Dual-Clock', () => {
  it('acumula passos determinísticos proporcionais ao timeScale', () => {
    const kernel = new ChronoKernel({
      fixedSimStep: 1 / 120,
      idleTimeScale: 0.025,
      activeTimeScale: 1.0,
    });

    let stepsIdle = 0;
    // 20 quadros imóveis a 60Hz (~0.33s real -> ~0.0083s simulado -> ~1 passo fixo)
    for (let i = 0; i < 20; i++) {
      kernel.tick(1 / 60, 0, 0, () => {
        stepsIdle++;
      });
    }
    expect(stepsIdle).toBeGreaterThanOrEqual(0);
    expect(stepsIdle).toBeLessThanOrEqual(2);

    // 20 quadros correndo (motionFactor = 1.0) -> muito mais passos simulados!
    let stepsMoving = 0;
    for (let i = 0; i < 20; i++) {
      kernel.tick(1 / 60, 1.0, 0, () => {
        stepsMoving++;
      });
    }
    expect(stepsMoving).toBeGreaterThan(25);
  });
});

describe('SubFrustum & Transformação Espacial SE(3)', () => {
  it('preserva posição relativa na reprojeção normal e reverte projéteis no modo Negativo Invertido', () => {
    const camPos1 = new THREE.Vector3(0, 1.7, 10);
    const camQuat1 = new THREE.Quaternion(); // olhando para -Z

    // Projétil a 5m na frente da câmera, vindo NA DIREÇÃO do rosto (+Z a 20 m/s)
    const bulletPos = new THREE.Vector3(-1.0, 1.7, 5);
    const bulletVel = new THREE.Vector3(0, 0, 20);

    const captured = captureTransformToFrame(
      camPos1,
      camQuat1,
      bulletPos,
      new THREE.Quaternion(),
      bulletVel,
      new THREE.Vector3()
    );

    expect(captured.localPosition.z).toBeCloseTo(-5);
    expect(captured.localVelocity.z).toBeCloseTo(20);

    // Jogador gira 90 graus para a esquerda (+Y = PI/2 -> agora olha para -X) e ativa Negativo Invertido!
    const camPos2 = new THREE.Vector3(0, 1.7, 10);
    const camQuat2 = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2
    );

    const pasted = reprojectTransformFromFrame(
      camPos2,
      camQuat2,
      captured,
      'inverted'
    );

    // Deve aparecer 5m à frente do novo olhar (-X) e disparar PARA FORA (-X a -20 m/s)!
    expect(pasted.worldPosition.x).toBeCloseTo(-5);
    expect(pasted.worldVelocity.x).toBeCloseTo(-20);
    expect(Math.abs(pasted.worldVelocity.z)).toBeLessThan(1e-5);
  });

  it('extrai planos do sub-frustum contendo objetos centrais e rejeitando objetos fora do recorte', () => {
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
    cam.position.set(0, 1.7, 0);
    cam.lookAt(0, 1.7, -10);

    const sub = extractWorldSubFrustum(cam, 0.5, 25);
    expect(sub.intersectsSphere(new THREE.Sphere(new THREE.Vector3(0, 1.7, -8), 0.3))).toBe(
      true
    );
    // Objeto muito à direita (fora dos 36% centrais da tela) não entra na moldura
    expect(sub.intersectsSphere(new THREE.Sphere(new THREE.Vector3(9, 1.7, -8), 0.3))).toBe(
      false
    );
  });
});

describe('SpatialSweep CCD', () => {
  it('detecta interseção contínua de segmento rápido contra parede fina sem tunneling', () => {
    const thinWall = new THREE.Box3(
      new THREE.Vector3(-2, 0, -0.05),
      new THREE.Vector3(2, 3, 0.05)
    );
    const hit = sweepSegmentVsBox(
      new THREE.Vector3(0, 1.5, 5),
      new THREE.Vector3(0, 1.5, -5),
      thinWall,
      0.1
    );
    expect(hit).not.toBeNull();
    expect(hit!.normal.z).toBe(1);
    expect(hit!.t).toBeGreaterThan(0.45);
    expect(hit!.t).toBeLessThan(0.55);

    const sphereHit = sweepSegmentVsSphere(
      new THREE.Vector3(0, 1, 4),
      new THREE.Vector3(0, 1, -4),
      new THREE.Vector3(0, 1, 0),
      0.5
    );
    expect(sphereHit).not.toBeNull();
  });
});

describe('BrowserShortcutGuard (Proteção contra Ctrl+W)', () => {
  it('inclui ControlLeft/Right e KeyW na lista de Keyboard Lock e bloqueia combinações críticas do navegador', () => {
    expect(LOCKED_KEYBOARD_CODES).toContain('Escape');
    expect(LOCKED_KEYBOARD_CODES).toContain('KeyW');
    expect(LOCKED_KEYBOARD_CODES).toContain('ControlLeft');
    expect(LOCKED_KEYBOARD_CODES).toContain('ControlRight');
    expect(LOCKED_KEYBOARD_CODES).toContain('Digit1');
    expect(LOCKED_KEYBOARD_CODES).toContain('Digit2');
    expect(LOCKED_KEYBOARD_CODES).toContain('Digit3');

    expect(
      shouldPreventBrowserShortcut({ code: 'KeyW', key: 'w', ctrlKey: true })
    ).toBe(true);
    expect(
      shouldPreventBrowserShortcut({ code: 'Digit1', key: '1', ctrlKey: true })
    ).toBe(true);
    expect(
      shouldPreventBrowserShortcut({ code: 'Digit2', key: '2', ctrlKey: true })
    ).toBe(true);
    expect(
      shouldPreventBrowserShortcut({ code: 'Digit3', key: '3', ctrlKey: true })
    ).toBe(true);
    expect(
      shouldPreventBrowserShortcut({ code: 'KeyS', key: 's', ctrlKey: true })
    ).toBe(true);
    expect(
      shouldPreventBrowserShortcut({ code: 'KeyD', key: 'd', ctrlKey: true })
    ).toBe(true);
    expect(
      shouldPreventBrowserShortcut({ code: 'KeyF', key: 'f', ctrlKey: true })
    ).toBe(true);
    expect(
      shouldPreventBrowserShortcut({ code: 'KeyW', key: 'w', metaKey: true })
    ).toBe(true);
  });
});
