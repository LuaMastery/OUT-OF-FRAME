import { describe, expect, it } from 'vitest';
import { DoomSettingsStore } from '../src/doom/DoomSettings';
import {
  CPU_FIRST_LADDER,
  DoomPerfGovernor,
  GPU_FIRST_LADDER,
  PERF_MAX_STEP,
  PerfLevers,
  resolvePerfLevers,
  snapFrameCapToVsync,
  snapRefreshHz,
} from '../src/doom/DoomPerfGovernor';

const BASE: PerfLevers = {
  renderScalePercent: 100,
  maxDynamicLights: 28,
  contactShadowHz: 30,
  viewmodelShadowMap: true,
  radarHz: 24,
  lightRankMs: 0,
};

/** Relógio e alimentação simulados: o governador nunca vê o tempo real. */
class Harness {
  private clock = 0;
  readonly gov: DoomPerfGovernor;

  constructor() {
    this.gov = new DoomPerfGovernor(BASE, {
      targetFps: 60,
      aggressiveness: 'balanced',
      enabled: true,
    });
  }

  feed(frames: number, frameMs: number, cpuMs: number): void {
    for (let i = 0; i < frames; i++) {
      this.clock += frameMs;
      this.gov.update({ frameMs, cpuMs, nowMs: this.clock });
    }
  }

  /**
   * Alimenta até a condição ser satisfeita e para imediatamente — sem isto o
   * governador continuaria descendo e o teste mediria um degrau mais fundo do
   * que quer observar.
   */
  feedUntil(
    predicate: (step: number) => boolean,
    maxFrames: number,
    frameMs: number,
    cpuMs: number
  ): boolean {
    for (let i = 0; i < maxFrames; i++) {
      this.clock += frameMs;
      this.gov.update({ frameMs, cpuMs, nowMs: this.clock });
      if (predicate(this.gov.currentStep)) return true;
    }
    return false;
  }

  get now(): number {
    return this.clock;
  }
}

describe('escada de qualidade', () => {
  it('degrau zero devolve exatamente o que o jogador escolheu', () => {
    expect(resolvePerfLevers(BASE, 0)).toEqual(BASE);
  });

  it('cada degrau só piora, nunca melhora nada', () => {
    let previous = resolvePerfLevers(BASE, 0);
    for (let step = 1; step <= PERF_MAX_STEP; step++) {
      const next = resolvePerfLevers(BASE, step);
      expect(next.renderScalePercent).toBeLessThanOrEqual(
        previous.renderScalePercent
      );
      expect(next.maxDynamicLights).toBeLessThanOrEqual(
        previous.maxDynamicLights
      );
      expect(next.contactShadowHz).toBeLessThanOrEqual(
        previous.contactShadowHz
      );
      expect(next.radarHz).toBeLessThanOrEqual(previous.radarHz);
      expect(next.lightRankMs).toBeGreaterThanOrEqual(previous.lightRankMs);
      // Sombra real só pode desligar, nunca religar num degrau pior.
      if (!previous.viewmodelShadowMap) {
        expect(next.viewmodelShadowMap).toBe(false);
      }
      previous = next;
    }
  });

  it('o último degrau ainda deixa o jogo jogável', () => {
    const worst = resolvePerfLevers(BASE, PERF_MAX_STEP);
    expect(worst.renderScalePercent).toBeGreaterThanOrEqual(45);
    expect(worst.maxDynamicLights).toBeGreaterThanOrEqual(6);
    expect(worst.maxDynamicLights).toBeLessThanOrEqual(48);
    expect(worst.radarHz).toBeGreaterThan(0);
  });

  it('respeita o piso e o teto mesmo com uma base absurda', () => {
    const absurd = resolvePerfLevers(
      { ...BASE, renderScalePercent: 160, maxDynamicLights: 48 },
      0
    );
    expect(absurd.renderScalePercent).toBeLessThanOrEqual(160);
    expect(absurd.maxDynamicLights).toBeLessThanOrEqual(48);

    const tiny = resolvePerfLevers(
      { ...BASE, renderScalePercent: 50, maxDynamicLights: 8 },
      PERF_MAX_STEP
    );
    expect(tiny.renderScalePercent).toBeGreaterThanOrEqual(45);
    expect(tiny.maxDynamicLights).toBeGreaterThanOrEqual(6);
  });

  it('as duas escadas têm o mesmo comprimento', () => {
    expect(CPU_FIRST_LADDER.length).toBe(GPU_FIRST_LADDER.length);
    expect(PERF_MAX_STEP).toBe(GPU_FIRST_LADDER.length);
  });
});

describe('estimativa da taxa do monitor', () => {
  it('arredonda para taxas conhecidas', () => {
    expect(snapRefreshHz(59.8)).toBe(60);
    expect(snapRefreshHz(143.5)).toBe(144);
    expect(snapRefreshHz(121)).toBe(120);
  });

  it('mantém valores fora da tabela por perto', () => {
    expect(snapRefreshHz(0)).toBe(60);
    expect(snapRefreshHz(-5)).toBe(60);
  });
});

describe('governador inteligente', () => {
  it('reduz a qualidade quando os quadros ficam lentos de forma sustentada', () => {
    const h = new Harness();
    expect(h.gov.currentStep).toBe(0);

    h.feed(600, 40, 8);

    expect(h.gov.currentStep).toBeGreaterThan(0);
    expect(h.gov.currentLevers.renderScalePercent).toBeLessThan(100);
  });

  it('ignora um soluço isolado no meio de quadros bons', () => {
    const h = new Harness();
    h.feed(300, 14, 4);
    expect(h.gov.currentStep).toBe(0);

    // Um quadro de 200 ms (compilação de shader, GC, aba voltando) no meio de
    // uma sequência saudável não pode derrubar a qualidade.
    h.feed(1, 200, 10);
    h.feed(200, 14, 4);

    expect(h.gov.currentStep).toBe(0);
  });

  it('recupera a qualidade quando o aperto passa', () => {
    const h = new Harness();
    h.feed(600, 40, 8);
    const bottom = h.gov.currentStep;
    expect(bottom).toBeGreaterThan(0);

    h.feed(1200, 9, 3);
    expect(h.gov.currentStep).toBeLessThan(bottom);
  });

  it('nunca passa do piso nem do teto', () => {
    const h = new Harness();
    h.feed(4000, 120, 10);
    expect(h.gov.currentStep).toBeLessThanOrEqual(PERF_MAX_STEP);

    h.feed(4000, 4, 1);
    expect(h.gov.currentStep).toBeGreaterThanOrEqual(0);
  });

  it('desligado, não mexe em nada e diz que está desligado', () => {
    const h = new Harness();
    h.gov.setOptions({ enabled: false });
    h.feed(600, 60, 30);

    expect(h.gov.currentStep).toBe(0);
    expect(h.gov.currentLevers).toEqual(BASE);
    expect(h.gov.update({ frameMs: 60, cpuMs: 30, nowMs: 99_999 }).status).toBe(
      'off'
    );
  });
});

describe('descoberta do gargalo', () => {
  it('GPU pesada: corta resolução antes das luzes', () => {
    const h = new Harness();
    // Quadro de 40 ms com só 5 ms de JavaScript: a placa de vídeo é quem não
    // dá conta, então a resolução tem que cair primeiro.
    expect(h.feedUntil((step) => step >= 1, 600, 40, 5)).toBe(true);

    const levers = h.gov.currentLevers;
    expect(h.gov.currentStep).toBe(1);
    expect(levers.renderScalePercent).toBeLessThan(100);
    // As luzes ficam intactas no primeiro degrau da escada de GPU.
    expect(levers.maxDynamicLights).toBe(BASE.maxDynamicLights);
  });

  it('CPU pesada: corta luzes antes da resolução', () => {
    const h = new Harness();
    // Mesmo quadro de 40 ms, mas com 34 ms de JavaScript: quem sofre é o
    // processador, então diminuir resolução não resolveria nada.
    expect(h.feedUntil((step) => step >= 1, 600, 40, 34)).toBe(true);

    const levers = h.gov.currentLevers;
    expect(h.gov.currentStep).toBe(1);
    expect(levers.maxDynamicLights).toBeLessThan(BASE.maxDynamicLights);
    // A resolução fica intacta no primeiro degrau da escada de CPU.
    expect(levers.renderScalePercent).toBe(BASE.renderScalePercent);
  });
});

describe('aprendizado do teto da máquina', () => {
  it('para de insistir num degrau que o hardware não aguenta', () => {
    const h = new Harness();

    // Ciclos de "aperta, alivia". Depois de duas quedas rápidas em cima da
    // mesma subida, o degrau vira teto e não é mais tentado.
    for (let cycle = 0; cycle < 4; cycle++) {
      h.feedUntil((step) => step >= 1, 400, 60, 12); // aperto: cai um degrau
      h.feedUntil((step) => step === 0, 2500, 9, 3); // alívio: sobe de volta
    }

    expect(h.gov.learnedCeiling).toBeGreaterThan(0);

    // Mesmo com muito fôlego, não volta para o degrau que já provou ser demais.
    h.feed(3000, 9, 3);
    expect(h.gov.currentStep).toBeGreaterThanOrEqual(h.gov.learnedCeiling);
  });
});

describe('pacotes de desempenho', () => {
  it('escolher um pacote escreve o conjunto inteiro de uma vez', () => {
    const store = new DoomSettingsStore();
    store.set('perfPreset', 'eco');
    const eco = store.value;

    expect(eco.perfPreset).toBe('eco');
    expect(eco.targetFps).toBe(30);
    expect(eco.renderScalePercent).toBe(75);
    expect(eco.maxDynamicLights).toBe(12);
    expect(eco.viewmodelShadowQuality).toBe('off');
    expect(eco.contactShadowRate).toBe(0);
  });

  it('os pacotes ficam mais pesados na ordem eco < equilibrado < qualidade', () => {
    const eco = new DoomSettingsStore();
    eco.set('perfPreset', 'eco');
    const balanced = new DoomSettingsStore();
    balanced.set('perfPreset', 'balanced');
    const quality = new DoomSettingsStore();
    quality.set('perfPreset', 'quality');

    expect(eco.value.renderScalePercent).toBeLessThan(
      balanced.value.renderScalePercent
    );
    expect(balanced.value.renderScalePercent).toBeLessThan(
      quality.value.renderScalePercent
    );
    expect(eco.value.maxDynamicLights).toBeLessThan(
      balanced.value.maxDynamicLights
    );
    expect(balanced.value.maxDynamicLights).toBeLessThan(
      quality.value.maxDynamicLights
    );
  });

  it('ajustar uma opção por conta própria marca o pacote como personalizado', () => {
    const store = new DoomSettingsStore();
    store.set('perfPreset', 'quality');
    expect(store.value.perfPreset).toBe('quality');

    store.set('maxDynamicLights', 20);
    expect(store.value.maxDynamicLights).toBe(20);
    expect(store.value.perfPreset).toBe('custom');
  });

  it('opções fora do pacote não mexem no selo do preset', () => {
    const store = new DoomSettingsStore();
    store.set('perfPreset', 'eco');
    store.set('masterVolume', 55);
    expect(store.value.perfPreset).toBe('eco');
  });

  it('valores fora da faixa são recolhidos na sanitização', () => {
    const store = new DoomSettingsStore();
    store.set('renderScalePercent', 900);
    expect(store.value.renderScalePercent).toBe(160);
    store.set('targetFps', 47 as 60);
    expect([0, 30, 60, 90, 120]).toContain(store.value.targetFps);
    store.set('drawDistance', 2);
    expect(store.value.drawDistance).toBeGreaterThanOrEqual(45);
  });
});

describe('limitador de quadros encaixado no vsync', () => {
  const HZ_60 = 1000 / 60;
  const HZ_144 = 1000 / 144;

  it('sem limitador, não limita', () => {
    expect(snapFrameCapToVsync(0, HZ_60)).toEqual({ capMs: 0, toleranceMs: 0 });
  });

  it('sem vsync medido, usa o teto cru com tolerância mínima', () => {
    expect(snapFrameCapToVsync(HZ_60, 0)).toEqual({
      capMs: HZ_60,
      toleranceMs: 1,
    });
  });

  it('num monitor de 60 Hz, um alvo de 60 é um vsync', () => {
    const { capMs } = snapFrameCapToVsync(HZ_60, HZ_60);
    expect(capMs).toBeCloseTo(HZ_60, 5);
  });

  it('num monitor de 60 Hz, um alvo de 30 são dois vsyncs', () => {
    const { capMs } = snapFrameCapToVsync(1000 / 30, HZ_60);
    expect(capMs).toBeCloseTo(2 * HZ_60, 5);
  });

  it('num monitor de 144 Hz, um alvo de 60 pega o múltiplo mais próximo', () => {
    // O múltiplo mais próximo de 16,67 ms entre 13,88 e 20,8: tem que ser
    // 13,88 (72 FPS), não 20,8 (48 FPS).
    const { capMs } = snapFrameCapToVsync(HZ_60, HZ_144);
    expect(capMs).toBeCloseTo(2 * HZ_144, 5);
    expect(capMs).toBeLessThan(HZ_60 * 1.25);
  });

  it('não adianta pedir mais quadros do que o monitor aguenta', () => {
    // 120 FPS pedido num monitor de 60 Hz fica em 60, nunca em 30.
    const { capMs } = snapFrameCapToVsync(1000 / 120, HZ_60);
    expect(capMs).toBeCloseTo(HZ_60, 5);
  });

  it('a tolerância é metade de um vsync, com piso de 1 ms', () => {
    expect(snapFrameCapToVsync(HZ_60, HZ_60).toleranceMs).toBeCloseTo(
      HZ_60 / 2,
      5
    );
    expect(snapFrameCapToVsync(HZ_60, 1.2).toleranceMs).toBe(1);
  });
});
