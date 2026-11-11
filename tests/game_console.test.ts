import { describe, expect, it, vi } from 'vitest';
import {
  CommandContext,
  ConsoleChannel,
  ConsoleFilter,
  ConsoleLog,
  createDefaultCommands,
  defaultConsoleFilter,
  formatConsoleClock,
  parseCommandLine,
  stringifyConsoleArg,
} from '../src/console/ConsoleLog';

const T0 = 1_700_000_000_000;

function feed(
  log: ConsoleLog,
  entries: ReadonlyArray<[level: 'debug' | 'info' | 'warn' | 'error' | 'system',
                          channel: 'geral' | 'jogo' | 'rede' | 'desempenho' | 'audio' | 'webgl' | 'entrada',
                          text: string]>
): void {
  entries.forEach(([level, channel, text], i) => {
    log.push(level, channel, text, i * 16, T0 + i * 1000);
  });
}

// ---------------------------------------------------------------------------
// formatação
// ---------------------------------------------------------------------------

describe('formatação de valores do console', () => {
  it('converte tipos comuns em texto legível', () => {
    expect(stringifyConsoleArg(null)).toBe('null');
    expect(stringifyConsoleArg(undefined)).toBe('undefined');
    expect(stringifyConsoleArg(42)).toBe('42');
    expect(stringifyConsoleArg(true)).toBe('true');
    expect(stringifyConsoleArg('texto')).toBe('texto');
    expect(stringifyConsoleArg([1, 'a'])).toBe('[1, "a"]');
    expect(stringifyConsoleArg({ fps: 60 })).toBe('{fps: 60}');
  });

  it('mostra a mensagem e a pilha de um erro', () => {
    const err = new Error('falhou de verdade');
    const text = stringifyConsoleArg(err);
    expect(text).toContain('falhou de verdade');
    // A pilha ajuda a achar o arquivo; sem ela o console seria inútil.
    expect(text.length).toBeGreaterThan('falhou de verdade'.length);
  });

  it('sobrevive a objetos com referência circular', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    // JSON.stringify estouraria aqui; o console precisa seguir em frente.
    expect(stringifyConsoleArg(cyclic)).toBe('{self: [ciclo]}');
  });

  it('descreve objetos profundos sem virar um livro', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(stringifyConsoleArg(deep)).toBe('{a: {b: {c: {d: [\u2026]}}}}');
  });

  it('descreve Map e Set com contagem', () => {
    expect(stringifyConsoleArg(new Map([['a', 1]]))).toBe('Map(1) {a => 1}');
    expect(stringifyConsoleArg(new Set([1, 2]))).toBe('Set(2) {1, 2}');
  });

  it('formata o relógio em 24 horas com milissegundos curtos', () => {
    // Construído com UTC para o teste não depender do fuso de quem roda.
    const date = Date.UTC(2024, 4, 20, 13, 37, 9, 400);
    expect(formatConsoleClock(date)).toMatch(/13:37:09\.\d{2,3}/);
  });
});

// ---------------------------------------------------------------------------
// buffer
// ---------------------------------------------------------------------------

describe('buffer de linhas do console', () => {
  it('registra nível, canal e horário', () => {
    const log = new ConsoleLog(10);
    log.push('error', 'webgl', 'contexto perdido', 0, T0);
    const entry = log.query(defaultConsoleFilter(), 10)[0];
    expect(entry.level).toBe('error');
    expect(entry.channel).toBe('webgl');
    expect(entry.text).toBe('contexto perdido');
    expect(entry.wall).toBe(T0);
  });

  it('agrupa linhas idênticas em sequência num contador', () => {
    const log = new ConsoleLog(10);
    feed(log, [
      ['info', 'geral', 'mesma coisa'],
      ['info', 'geral', 'mesma coisa'],
      ['info', 'geral', 'mesma coisa'],
      ['info', 'geral', 'outra coisa'],
      ['info', 'geral', 'mesma coisa'],
    ]);
    const all = log.query(defaultConsoleFilter(), 10);
    // Cinco registros viram três linhas: a repetição não polui o painel.
    expect(all).toHaveLength(3);
    expect(all[0].repeat).toBe(3);
    expect(all[2].repeat).toBe(1);
  });

  it('conta os totais por nível', () => {
    const log = new ConsoleLog(10);
    feed(log, [
      ['info', 'geral', 'a'],
      ['warn', 'geral', 'b'],
      ['warn', 'geral', 'b'],
      ['error', 'rede', 'c'],
      ['debug', 'geral', 'd'],
    ]);
    const totals = log.totals();
    expect(totals.info).toBe(1);
    expect(totals.warn).toBe(2);
    expect(totals.error).toBe(1);
    expect(totals.debug).toBe(1);
  });

  it('descarta as linhas mais antigas ao estourar a capacidade', () => {
    const log = new ConsoleLog(3);
    feed(log, [
      ['info', 'geral', 'um'],
      ['info', 'geral', 'dois'],
      ['info', 'geral', 'três'],
      ['info', 'geral', 'quatro'],
    ]);
    const texts = log.query(defaultConsoleFilter(), 10).map((e) => e.text);
    expect(texts).toEqual(['dois', 'três', 'quatro']);
    expect(log.dropped).toBe(1);
  });

  it('exporta apenas o que está visível no filtro', () => {
    const log = new ConsoleLog(10);
    feed(log, [
      ['info', 'geral', 'mostra'],
      ['debug', 'geral', 'esconde'],
      ['error', 'rede', 'mostra também'],
    ]);
    const onlyRede: ConsoleFilter = {
      ...defaultConsoleFilter(),
      channels: new Set<ConsoleChannel>(['rede']),
    };
    const text = log.exportText(onlyRede);
    expect(text).toContain('mostra também');
    expect(text).not.toContain('esconde');
    expect(text).not.toContain('mostra\n');
  });

  it('limpa tudo e volta a contar do zero', () => {
    const log = new ConsoleLog(10);
    feed(log, [['error', 'geral', 'x']]);
    log.clear();
    expect(log.size).toBe(0);
    expect(log.query(defaultConsoleFilter(), 10)).toHaveLength(0);
    expect(log.totals().error).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// filtros
// ---------------------------------------------------------------------------

describe('filtros do console', () => {
  const log = new ConsoleLog(20);
  feed(log, [
    ['debug', 'geral', 'rastro interno'],
    ['info', 'jogo', 'item recolhido'],
    ['warn', 'audio', 'sem áudio'],
    ['error', 'webgl', 'shader quebrou'],
    ['system', 'geral', 'comando'],
  ]);

  it('esconde depuração por padrão', () => {
    const texts = log.query(defaultConsoleFilter(), 20).map((e) => e.text);
    expect(texts).not.toContain('rastro interno');
    expect(texts).toContain('item recolhido');
  });

  it('mostra depuração quando o nível é incluído', () => {
    const base = defaultConsoleFilter();
    const filter: ConsoleFilter = {
      ...base,
      levels: new Set([...base.levels, 'debug' as const]),
    };
    const texts = log.query(filter, 20).map((e) => e.text);
    expect(texts[0]).toBe('rastro interno');
  });

  it('trata conjunto de canais vazio como "todos"', () => {
    const filter: ConsoleFilter = {
      ...defaultConsoleFilter(),
      channels: new Set<ConsoleChannel>(),
    };
    expect(log.query(filter, 20)).toHaveLength(4);
  });

  it('restringe por canal quando algum é escolhido', () => {
    const filter: ConsoleFilter = {
      ...defaultConsoleFilter(),
      channels: new Set<ConsoleChannel>(['webgl']),
    };
    const texts = log.query(filter, 20).map((e) => e.text);
    expect(texts).toEqual(['shader quebrou']);
  });

  it('busca texto ignorando maiúsculas', () => {
    const filter = { ...defaultConsoleFilter(), query: 'SHADER' };
    const texts = log.query(filter, 20).map((e) => e.text);
    expect(texts).toEqual(['shader quebrou']);
  });

  it('cruza canal e busca textual juntos', () => {
    const filter: ConsoleFilter = {
      ...defaultConsoleFilter(),
      channels: new Set<ConsoleChannel>(['jogo']),
      query: 'shader',
    };
    // O texto casa, mas o canal não: nenhuma linha sobrevive.
    expect(log.query(filter, 20)).toHaveLength(0);
  });

  it('respeita o limite de linhas devolvidas', () => {
    expect(log.query(defaultConsoleFilter(), 2)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// análise da linha de comando
// ---------------------------------------------------------------------------

describe('análise da linha de comando', () => {
  it('separa comando e argumentos', () => {
    expect(parseCommandLine('  nivel  erro  ')).toEqual({
      name: 'nivel',
      args: ['erro'],
    });
  });

  it('devolve nulo para linha em branco', () => {
    // Nulo significa "nada a executar", diferente de "comando sem argumentos".
    expect(parseCommandLine('   ')).toBeNull();
    expect(parseCommandLine('')).toBeNull();
  });

  it('respeita aspas para argumentos com espaço', () => {
    expect(parseCommandLine('config "escala de render" 80')).toEqual({
      name: 'config',
      args: ['escala de render', '80'],
    });
  });
});

// ---------------------------------------------------------------------------
// comandos
// ---------------------------------------------------------------------------

function makeContext() {
  const printed: Array<[string, string]> = [];
  const ctx: CommandContext = {
    print: (text, level = 'info') => printed.push([level, text]),
    info: vi.fn((topic: string) =>
      topic === 'desempenho' ? ['fps 60', 'orçamento 16 ms'] : [`info de ${topic}`]
    ),
    clear: vi.fn(),
    setFilter: vi.fn(),
    getFilter: () => defaultConsoleFilter(),
    copy: vi.fn(() => true),
  };
  return { ctx, printed };
}

describe('comandos do console', () => {
  it('responde a comandos conhecidos e recusa os demais', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    expect(registry.execute('ajuda', ctx)).toBe(true);
    expect(registry.execute('inexistente', ctx)).toBe(false);
  });

  it('aceita comando em maiúsculas', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    expect(registry.execute('LIMPAR', ctx)).toBe(true);
    expect(ctx.clear).toHaveBeenCalled();
  });

  it('não executa linha vazia', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    expect(registry.execute('   ', ctx)).toBe(false);
  });

  it('o comando desempenho imprime as linhas do provedor ao vivo', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    registry.execute('desempenho', ctx);
    expect(printed.map(([, text]) => text)).toEqual(['fps 60', 'orçamento 16 ms']);
  });

  it('o comando estado delega ao provedor do jogo', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    registry.execute('estado', ctx);
    expect(ctx.info).toHaveBeenCalledWith('jogo');
  });

  it('o comando erros isola o nível de erro', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    registry.execute('erros', ctx);
    // O filtro é um remendo: os demais campos permanecem como estavam.
    expect(ctx.setFilter).toHaveBeenCalledWith({ levels: new Set(['error']) });
  });

  it('o comando tudo reabre todos os níveis e canais', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    registry.execute('tudo', ctx);
    expect(ctx.setFilter).toHaveBeenCalledWith({
      levels: new Set(['debug', 'info', 'warn', 'error', 'system']),
      channels: new Set(),
      query: '',
    });
  });

  it('o comando canal aceita o nome do canal ou o rótulo em português', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    expect(registry.execute('canal webgl', ctx)).toBe(true);
    expect(ctx.setFilter).toHaveBeenCalledWith({ channels: new Set(['webgl']) });
    expect(registry.execute('canal áudio', ctx)).toBe(true);
    expect(ctx.setFilter).toHaveBeenCalledWith({ channels: new Set(['audio']) });
  });

  it('o comando canal recusa nome inventado sem mexer no filtro', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    expect(registry.execute('canal inventado', ctx)).toBe(true);
    expect(ctx.setFilter).not.toHaveBeenCalled();
    expect(printed.at(-1)?.[0]).toBe('warn');
    expect(printed.at(-1)?.[1]).toContain('inventado');
  });

  it('o comando canal sem argumento volta para todos os canais', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    registry.execute('canal', ctx);
    expect(ctx.setFilter).toHaveBeenCalledWith({ channels: new Set() });
  });

  it('o comando nivel aceita o rótulo em português', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    expect(registry.execute('nivel erro', ctx)).toBe(true);
    expect(ctx.setFilter).toHaveBeenCalledWith({ levels: new Set(['error']) });
  });

  it('o comando nivel recusa nome inventado', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    expect(registry.execute('nivel exagerado', ctx)).toBe(true);
    expect(ctx.setFilter).not.toHaveBeenCalled();
    expect(printed.at(-1)?.[0]).toBe('warn');
  });

  it('o comando buscar repassa a consulta inteira, com espaços', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    registry.execute('buscar shader quebrou', ctx);
    expect(ctx.setFilter).toHaveBeenCalledWith({ query: 'shader quebrou' });
  });

  it('o comando buscar sem texto limpa a busca', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    expect(registry.execute('buscar', ctx)).toBe(true);
    expect(ctx.setFilter).toHaveBeenCalledWith({ query: '' });
    expect(printed.at(-1)?.[1]).toContain('limpa');
  });

  it('o comando copiar leva as linhas visíveis para a área de transferência', () => {
    const registry = createDefaultCommands();
    const { ctx } = makeContext();
    registry.execute('copiar', ctx);
    expect(ctx.copy).toHaveBeenCalled();
  });

  it('o comando copiar avisa quando o navegador recusa a cópia', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    const failing = { ...ctx, copy: vi.fn(() => false) };
    registry.execute('copiar', failing);
    expect(failing.copy).toHaveBeenCalled();
    expect(printed.at(-1)?.[0]).toBe('warn');
  });

  it('a ajuda lista todos os comandos registrados', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    registry.execute('ajuda', ctx);
    const text = printed.map(([, t]) => t).join('\n');
    for (const cmd of registry.list()) {
      expect(text).toContain(cmd.name);
    }
  });

  it('a ajuda de um comando específico mostra o uso', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    registry.execute('ajuda canal', ctx);
    const text = printed.map(([, t]) => t).join('\n');
    expect(text).toContain('canal');
    expect(text).toContain('Valores aceitos');
  });

  it('a ajuda de comando inexistente avisa', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    registry.execute('ajuda inexistente', ctx);
    expect(printed.at(-1)?.[0]).toBe('warn');
  });

  it('completa prefixos e sugere alternativas', () => {
    const registry = createDefaultCommands();
    expect(registry.complete('des')).toEqual(['desempenho']);
    expect(registry.complete('zzz')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tradução dos nomes
// ---------------------------------------------------------------------------

describe('nomes amigáveis', () => {
  it('traduz níveis e canais para o jogador', () => {
    const registry = createDefaultCommands();
    const { ctx, printed } = makeContext();
    registry.execute('canal audio', ctx);
    const text = printed.map(([, t]) => t).join('\n');
    expect(text.toLowerCase()).toContain('áudio');
  });
});
