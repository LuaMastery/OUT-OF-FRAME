import { describe, expect, it } from 'vitest';
import {
  computeWebDanger,
  createIdleWebStrugglePose,
  WebStruggleInput,
  WebStruggleState,
} from '../src/doom/DoomWebStruggle';

const baseInput = (over: Partial<WebStruggleInput> = {}): WebStruggleInput => ({
  ensnared: true,
  strugglePressed: false,
  struggleHeld: false,
  hasKnife: false,
  danger01: 0,
  dt: 1 / 60,
  ...over,
});

/** Roda a máquina por `seconds` e devolve a pose final. */
function run(
  state: WebStruggleState,
  seconds: number,
  input: Partial<WebStruggleInput> = {}
) {
  let pose = state.current;
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    pose = state.step(baseInput(input));
  }
  return pose;
}

describe('Luta do operador preso na teia', () => {
  it('imobiliza e solta com rampa, nunca estalando', () => {
    const state = new WebStruggleState();
    expect(state.current.bound01).toBe(0);

    // O bote da teia prende rápido...
    expect(state.step(baseInput()).bound01).toBeGreaterThan(0.1);
    const bound = run(state, 0.6);
    expect(bound.bound01).toBeGreaterThan(0.95);

    // ... e a libertação desacelera o corpo em vez de cortar a pose.
    const freeing = state.step(baseInput({ ensnared: false }));
    expect(freeing.bound01).toBeLessThan(1);
    expect(freeing.bound01).toBeGreaterThan(0.5);
    const freed = run(state, 1.4, { ensnared: false });
    expect(freed.bound01).toBe(0);
  });

  it('transforma cada apertada num puxão que bate e volta', () => {
    const state = new WebStruggleState();
    run(state, 0.6);

    // Um único pulso: arranca para cima, ultrapassa e volta ao repouso.
    let peak = 0;
    let rebound = 0;
    for (let i = 0; i < 90; i++) {
      const pose = state.step(
        baseInput({ strugglePressed: i === 0, struggleHeld: i === 0 })
      );
      peak = Math.max(peak, pose.yank);
      if (i > 12) rebound = Math.min(rebound, pose.yank);
    }
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(1.15);
    expect(rebound).toBeLessThan(0); // a seda devolve o corpo
    expect(Math.abs(state.current.yank)).toBeLessThan(0.02);
  });

  it('dá puxões mais fortes com a faca e mais fracos com fadiga', () => {
    const fresh = new WebStruggleState();
    run(fresh, 0.6);
    const knife = new WebStruggleState();
    run(knife, 0.6);

    let barePeak = 0;
    for (let i = 0; i < 40; i++) {
      barePeak = Math.max(
        barePeak,
        fresh.step(baseInput({ strugglePressed: i === 0, struggleHeld: i === 0 })).yank
      );
    }
    let knifePeak = 0;
    for (let i = 0; i < 40; i++) {
      knifePeak = Math.max(
        knifePeak,
        knife.step(
          baseInput({ strugglePressed: i === 0, struggleHeld: i === 0, hasKnife: true })
        ).yank
      );
    }
    expect(knifePeak).toBeGreaterThan(barePeak);

    // Lutando muito tempo: a fadiga corta a força do puxão.
    const tired = new WebStruggleState();
    run(tired, 0.6);
    run(tired, 12, { struggleHeld: true, danger01: 1 });
    expect(tired.current.fatigue01).toBeGreaterThan(0.6);
    let tiredPeak = 0;
    for (let i = 0; i < 40; i++) {
      tiredPeak = Math.max(
        tiredPeak,
        tired.step(baseInput({ strugglePressed: i === 0, struggleHeld: i === 0 })).yank
      );
    }
    expect(tiredPeak).toBeLessThan(barePeak * 0.85);
  });

  it('fica quase imóvel sem perigo e se debate quando a Aranha se aproxima', () => {
    const calm = new WebStruggleState();
    run(calm, 0.6, { danger01: 0 });
    const calmTremor = run(calm, 6, { danger01: 0 }).tremor;

    const panic = new WebStruggleState();
    run(panic, 0.6, { danger01: 0 });
    // 6 s lutando com a Aranha em cima: fôlego e tremor muito maiores.
    const panicPose = run(panic, 6, { danger01: 1, struggleHeld: true });
    expect(Math.abs(calmTremor)).toBeLessThan(0.06);
    expect(Math.abs(panicPose.tremor)).toBeGreaterThan(Math.abs(calmTremor) * 3);
    expect(panicPose.agitation01).toBeGreaterThan(0.85);
    expect(panicPose.panic01).toBeGreaterThan(0.5);
  });

  it('ofega mais rápido conforme o esforço e o perigo', () => {
    const calm = new WebStruggleState();
    run(calm, 0.6, { danger01: 0 });
    const frantic = new WebStruggleState();
    run(frantic, 0.6, { danger01: 0 });

    const countZeroCrossings = (
      state: WebStruggleState,
      input: Partial<WebStruggleInput>
    ): number => {
      let crossings = 0;
      let prev = state.step(baseInput(input)).breath;
      for (let i = 0; i < 240; i++) {
        const cur = state.step(baseInput(input)).breath;
        if (prev <= 0 !== cur <= 0) crossings++;
        prev = cur;
      }
      return crossings;
    };

    const calmRate = countZeroCrossings(calm, { danger01: 0 });
    const franticRate = countZeroCrossings(frantic, {
      danger01: 1,
      struggleHeld: true,
    });
    expect(franticRate).toBeGreaterThan(calmRate);
  });

  it('é determinístico: a mesma sequência produz a mesma pose', () => {
    const a = new WebStruggleState();
    const b = new WebStruggleState();
    let poseA = a.current;
    let poseB = b.current;
    for (let i = 0; i < 300; i++) {
      const input = baseInput({
        strugglePressed: i % 17 === 0,
        struggleHeld: i % 17 < 4,
        danger01: (i % 90) / 90,
        dt: 1 / 60,
      });
      poseA = a.step(input);
      poseB = b.step(input);
    }
    expect(poseB.yank).toBeCloseTo(poseA.yank, 12);
    expect(poseB.breath).toBeCloseTo(poseA.breath, 12);
    expect(poseB.fatigue01).toBeCloseTo(poseA.fatigue01, 12);
  });

  it('zera tudo no reset', () => {
    const state = new WebStruggleState();
    run(state, 4, { danger01: 1, struggleHeld: true });
    expect(state.current.fatigue01).toBeGreaterThan(0);
    state.reset();
    const idle = createIdleWebStrugglePose();
    for (const key of Object.keys(idle) as Array<keyof typeof idle>) {
      expect(state.current[key]).toBe(idle[key]);
    }
  });

  it('converte a situação tática em perigo crescente', () => {
    const far = computeWebDanger({
      spiderDistance: 14,
      spiderHunting: false,
      devourSecondsLeft: 0,
      devourMaxSeconds: 0,
    });
    const nearPatrol = computeWebDanger({
      spiderDistance: 2.4,
      spiderHunting: false,
      devourSecondsLeft: 0,
      devourMaxSeconds: 0,
    });
    const hunting = computeWebDanger({
      spiderDistance: 2.4,
      spiderHunting: true,
      devourSecondsLeft: 0,
      devourMaxSeconds: 0,
    });
    const almostEaten = computeWebDanger({
      spiderDistance: 14,
      spiderHunting: false,
      devourSecondsLeft: 1,
      devourMaxSeconds: 45,
    });

    expect(far).toBeLessThan(0.05);
    expect(nearPatrol).toBeGreaterThan(far);
    expect(hunting).toBeGreaterThan(nearPatrol);
    expect(hunting).toBeCloseTo(0.911, 2);
    expect(almostEaten).toBeGreaterThan(0.95);
    expect(almostEaten).toBeLessThanOrEqual(1);
  });
});
