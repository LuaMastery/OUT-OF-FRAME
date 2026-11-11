/**
 * Núcleo do console do jogo: armazenamento, filtragem e comandos.
 *
 * É lógica pura, sem DOM e sem `Date.now()` escondido — o relógio entra pelos
 * parâmetros. Isso mantém o comportamento testável e evita que o próprio
 * console vire uma fonte de efeitos colaterais difíceis de rastrear.
 */

export type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error' | 'system';

export type ConsoleChannel =
  | 'geral'
  | 'jogo'
  | 'rede'
  | 'desempenho'
  | 'audio'
  | 'webgl'
  | 'entrada';

export const CONSOLE_LEVELS: readonly ConsoleLevel[] = [
  'debug',
  'info',
  'warn',
  'error',
  'system',
];

export const CONSOLE_CHANNELS: readonly ConsoleChannel[] = [
  'geral',
  'jogo',
  'rede',
  'desempenho',
  'audio',
  'webgl',
  'entrada',
];

export const LEVEL_LABELS: Readonly<Record<ConsoleLevel, string>> = {
  debug: 'DEP',
  info: 'INFO',
  warn: 'AVISO',
  error: 'ERRO',
  system: 'SIS',
};

export const CHANNEL_LABELS: Readonly<Record<ConsoleChannel, string>> = {
  geral: 'GERAL',
  jogo: 'JOGO',
  rede: 'REDE',
  desempenho: 'DESEMPENHO',
  audio: 'ÁUDIO',
  webgl: 'WEBGL',
  entrada: 'ENTRADA',
};

/** Peso de cada nível, para ordenar e para o filtro "a partir de". */
export const LEVEL_WEIGHT: Readonly<Record<ConsoleLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  system: 1,
};

export interface ConsoleEntry {
  readonly id: number;
  /** Tempo monotônico, em ms. */
  readonly t: number;
  /** Hora de parede, em ms. */
  readonly wall: number;
  readonly level: ConsoleLevel;
  readonly channel: ConsoleChannel;
  readonly text: string;
  /** Quantas vezes esta mesma linha se repetiu em sequência. */
  readonly repeat: number;
}

export interface ConsoleFilter {
  /** Níveis visíveis. Vazio significa "nenhum". */
  readonly levels: ReadonlySet<ConsoleLevel>;
  /** Canais visíveis. Vazio significa "todos". */
  readonly channels: ReadonlySet<ConsoleChannel>;
  readonly query: string;
}

export function defaultConsoleFilter(): ConsoleFilter {
  return {
    levels: new Set<ConsoleLevel>(['info', 'warn', 'error', 'system']),
    channels: new Set<ConsoleChannel>(),
    query: '',
  };
}

/** Formata um instante como HH:MM:SS.mmm. */
export function formatConsoleClock(wallMs: number): string {
  const d = new Date(wallMs);
  const pad = (n: number, size = 2): string => String(n).padStart(size, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3
  )}`;
}

/** Profundidade máxima ao descrever objetos, para um log não virar um livro. */
const MAX_DEPTH = 4;

/** Normaliza valores soltos (objetos, erros, arrays) numa linha legível. */
export function stringifyConsoleArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    const stack = value.stack;
    // A pilha repete a mensagem na primeira linha; cortar deixa o log limpo.
    if (!stack) return value.message;
    const rest = stack.split('\n').slice(1).join('\n').trim();
    return rest ? `${value.message}\n${rest}` : value.message;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'function') return `[função ${value.name || 'anônima'}]`;
  return describeValue(value, 0, new Set());
}

/**
 * Descrição recursiva e à prova de cilcos.
 *
 * Referências circulares (comuns em objetos do three.js e do DOM) fariam
 * `JSON.stringify` estourar; por isso cada objeto em visita é marcado.
 */
function describeValue(value: unknown, depth: number, seen: Set<unknown>): string {
  // Dentro de um container, texto vazio e texto ausente precisam se distinguir.
  if (typeof value === 'string') return depth > 0 ? `"${value}"` : value;
  if (value === null || typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[ciclo]';
  if (depth >= MAX_DEPTH) return '[…]';

  if (value instanceof Map) {
    const items = [...value.entries()].slice(0, 8).map(
      ([k, v]) => `${String(k)} => ${describeValue(v, depth + 1, seen)}`
    );
    return `Map(${value.size}) {${items.join(', ')}}`;
  }
  if (value instanceof Set) {
    const items = [...value.values()].slice(0, 8).map((v) => describeValue(v, depth + 1, seen));
    return `Set(${value.size}) {${items.join(', ')}}`;
  }
  if (Array.isArray(value)) {
    seen.add(value);
    const items = value.slice(0, 12).map((v) => describeValue(v, depth + 1, seen));
    if (value.length > 12) items.push(`… +${value.length - 12}`);
    seen.delete(value);
    return `[${items.join(', ')}]`;
  }
  // Elementos do DOM aparecem bastante em erros de evento; o nome da tag
  // diz mais que um monte de propriedades.
  if (typeof Element !== 'undefined' && value instanceof Element) {
    const id = value.id ? `#${value.id}` : '';
    const cls = value.className && typeof value.className === 'string'
      ? `.${value.className.trim().split(/\s+/).join('.')}`
      : '';
    return `<${value.tagName.toLowerCase()}${id}${cls}>`;
  }

  seen.add(value);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).slice(0, 12);
  const parts = keys.map(
    (key) => `${key}: ${describeValue(record[key], depth + 1, seen)}`
  );
  if (Object.keys(record).length > 12) parts.push('…');
  seen.delete(value);
  return `{${parts.join(', ')}}`;
}

export class ConsoleLog {
  private readonly entries: ConsoleEntry[] = [];
  private readonly counts: Record<ConsoleLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    system: 0,
  };
  private nextId = 1;
  private droppedCount = 0;

  constructor(private readonly capacity = 600) {}

  get size(): number {
    return this.entries.length;
  }

  /** Quantas linhas já foram descartadas por excesso de capacidade. */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Registra uma linha. Linhas idênticas em sequência são agrupadas num
   * contador em vez de inundarem o buffer — é o que mantém o console legível
   * quando algo passa a repetir a cada quadro.
   */
  push(
    level: ConsoleLevel,
    channel: ConsoleChannel,
    text: string,
    nowMs: number,
    wallMs: number
  ): ConsoleEntry {
    const clean = text.replace(/\s+$/, '');
    this.counts[level] += 1;

    const last = this.entries[this.entries.length - 1];
    if (
      last &&
      last.level === level &&
      last.channel === channel &&
      last.text === clean
    ) {
      const merged: ConsoleEntry = {
        ...last,
        repeat: last.repeat + 1,
        t: nowMs,
        wall: wallMs,
      };
      this.entries[this.entries.length - 1] = merged;
      return merged;
    }

    const entry: ConsoleEntry = {
      id: this.nextId++,
      t: nowMs,
      wall: wallMs,
      level,
      channel,
      text: clean,
      repeat: 1,
    };
    this.entries.push(entry);

    if (this.entries.length > this.capacity) {
      const overflow = this.entries.length - this.capacity;
      this.entries.splice(0, overflow);
      this.droppedCount += overflow;
    }
    return entry;
  }

  clear(): void {
    this.entries.length = 0;
    for (const level of CONSOLE_LEVELS) this.counts[level] = 0;
    this.droppedCount = 0;
  }

  /** Contagem acumulada por nível desde o último `clear`. */
  totals(): Readonly<Record<ConsoleLevel, number>> {
    return { ...this.counts };
  }

  matches(entry: ConsoleEntry, filter: ConsoleFilter): boolean {
    if (!filter.levels.has(entry.level)) return false;
    if (filter.channels.size > 0 && !filter.channels.has(entry.channel)) {
      return false;
    }
    const query = filter.query.trim().toLowerCase();
    if (query.length > 0) {
      const haystack = `${entry.text} ${CHANNEL_LABELS[entry.channel]}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  }

  /** Últimas `limit` linhas que passam no filtro (ordem cronológica). */
  query(filter: ConsoleFilter, limit = 400): ConsoleEntry[] {
    const out: ConsoleEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const entry = this.entries[i];
      if (this.matches(entry, filter)) out.push(entry);
    }
    return out.reverse();
  }

  /** Serializa o que está visível, para copiar ou salvar. */
  exportText(filter: ConsoleFilter, limit = 4000): string {
    return this.query(filter, limit)
      .map(
        (e) =>
          `[${formatConsoleClock(e.wall)}] ${LEVEL_LABELS[e.level]} ${
            CHANNEL_LABELS[e.channel]
          } ${e.text}${e.repeat > 1 ? ` (×${e.repeat})` : ''}`
      )
      .join('\n');
  }
}

// ============================================================================
// COMANDOS
// ============================================================================

export interface CommandContext {
  /** Escreve linhas de resposta no console. */
  readonly print: (text: string, level?: ConsoleLevel) => void;
  /** Dados ao vivo pedidos ao jogo (desempenho, estado, configurações). */
  readonly info: (topic: string) => readonly string[];
  readonly clear: () => void;
  readonly setFilter: (patch: Partial<ConsoleFilter>) => void;
  readonly getFilter: () => ConsoleFilter;
  readonly copy: (text: string) => boolean;
}

export interface ConsoleCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly usage?: string;
  readonly complete?: readonly string[];
  run: (args: readonly string[], ctx: CommandContext) => void;
}

export interface ParsedCommand {
  readonly name: string;
  readonly args: readonly string[];
}

/** Separa a linha digitada em comando e argumentos (respeitando aspas). */
export function parseCommandLine(line: string): ParsedCommand | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of trimmed) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (current.length > 0) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.length > 0) tokens.push(current);
  if (tokens.length === 0) return null;

  return { name: tokens[0].toLowerCase(), args: tokens.slice(1) };
}

export class CommandRegistry {
  private readonly byName = new Map<string, ConsoleCommand>();
  private readonly order: ConsoleCommand[] = [];

  register(command: ConsoleCommand): void {
    for (const key of [command.name, ...command.aliases]) {
      this.byName.set(key.toLowerCase(), command);
    }
    this.order.push(command);
  }

  list(): readonly ConsoleCommand[] {
    return this.order;
  }

  find(name: string): ConsoleCommand | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /** Sugestões para o autocompletar, a partir do que já foi digitado. */
  complete(prefix: string): readonly string[] {
    const needle = prefix.trim().toLowerCase();
    const names: string[] = [];
    for (const cmd of this.order) {
      if (cmd.name.startsWith(needle)) names.push(cmd.name);
    }
    return names;
  }

  /** Executa uma linha digitada. Devolve false quando o comando não existe. */
  execute(line: string, ctx: CommandContext): boolean {
    const parsed = parseCommandLine(line);
    if (!parsed) return false;
    const command = this.find(parsed.name);
    if (!command) return false;
    command.run(parsed.args, ctx);
    return true;
  }
}

/** Monta o registry com os comandos padrão de diagnóstico. */
export function createDefaultCommands(registry = new CommandRegistry()): CommandRegistry {
  registry.register({
    name: 'ajuda',
    aliases: ['help', '?'],
    description: 'Lista todos os comandos disponíveis.',
    usage: '[comando]',
    run: (args, ctx) => {
      const asked = (args[0] ?? '').toLowerCase();
      if (asked.length > 0) {
        const cmd = registry.find(asked);
        if (!cmd) {
          ctx.print(`Comando desconhecido "${asked}". Digite "ajuda" para ver a lista.`, 'warn');
          return;
        }
        const usage = cmd.usage ? ` ${cmd.usage}` : '';
        ctx.print(`${cmd.name}${usage} — ${cmd.description}`, 'system');
        if (cmd.aliases.length > 0) {
          ctx.print(`  Apelidos: ${cmd.aliases.join(', ')}`, 'system');
        }
        if (cmd.complete && cmd.complete.length > 0) {
          ctx.print(`  Valores aceitos: ${cmd.complete.join(', ')}`, 'system');
        }
        return;
      }
      ctx.print('Comandos disponíveis:', 'system');
      for (const cmd of registry.list()) {
        const usage = cmd.usage ? ` ${cmd.usage}` : '';
        ctx.print(`  ${cmd.name}${usage} — ${cmd.description}`);
      }
    },
  });

  registry.register({
    name: 'limpar',
    aliases: ['clear', 'cls'],
    description: 'Apaga todas as linhas do console.',
    run: (_args, ctx) => {
      ctx.clear();
      ctx.print('Console limpo.', 'system');
    },
  });

  registry.register({
    name: 'desempenho',
    aliases: ['perf', 'fps'],
    description: 'Mostra quadros por segundo, tempo de quadro e o ajuste automático.',
    run: (_args, ctx) => {
      for (const line of ctx.info('desempenho')) ctx.print(line);
    },
  });

  registry.register({
    name: 'estado',
    aliases: ['status', 'jogo'],
    description: 'Mostra o estado atual da incursão.',
    run: (_args, ctx) => {
      for (const line of ctx.info('jogo')) ctx.print(line);
    },
  });

  registry.register({
    name: 'webgl',
    aliases: ['gpu'],
    description: 'Mostra informações do contexto WebGL e da placa de vídeo.',
    run: (_args, ctx) => {
      for (const line of ctx.info('webgl')) ctx.print(line);
    },
  });

  registry.register({
    name: 'rede',
    aliases: ['net', 'multiplayer'],
    description: 'Mostra o estado da sessão multiplayer.',
    run: (_args, ctx) => {
      for (const line of ctx.info('rede')) ctx.print(line);
    },
  });

  registry.register({
    name: 'config',
    aliases: ['settings'],
    description: 'Mostra as configurações atuais, ou só as que casarem com o termo.',
    usage: '[termo]',
    run: (args, ctx) => {
      const lines = ctx.info(`config:${args.join(' ')}`);
      if (lines.length === 0) {
        ctx.print('Nenhuma configuração encontrada.', 'warn');
        return;
      }
      for (const line of lines) ctx.print(line);
    },
  });

  registry.register({
    name: 'erros',
    aliases: ['errors'],
    description: 'Filtra o console para mostrar apenas erros.',
    run: (_args, ctx) => {
      ctx.setFilter({ levels: new Set<ConsoleLevel>(['error']) });
      ctx.print('Filtro aplicado: somente erros.', 'system');
    },
  });

  registry.register({
    name: 'tudo',
    aliases: ['all'],
    description: 'Volta o filtro para todos os níveis.',
    run: (_args, ctx) => {
      ctx.setFilter({
        levels: new Set<ConsoleLevel>(CONSOLE_LEVELS),
        channels: new Set<ConsoleChannel>(),
        query: '',
      });
      ctx.print('Filtro aplicado: todos os níveis e canais.', 'system');
    },
  });

  registry.register({
    name: 'canal',
    aliases: ['channel'],
    description: 'Filtra por canal. Sem argumento, mostra todos.',
    usage: '[geral|jogo|rede|desempenho|audio|webgl|entrada]',
    complete: CONSOLE_CHANNELS,
    run: (args, ctx) => {
      const raw = (args[0] ?? '').toLowerCase();
      if (raw.length === 0) {
        ctx.setFilter({ channels: new Set<ConsoleChannel>() });
        ctx.print('Filtro aplicado: todos os canais.', 'system');
        return;
      }
      const channel = CONSOLE_CHANNELS.find(
        (c) => c === raw || CHANNEL_LABELS[c].toLowerCase() === raw
      );
      if (!channel) {
        ctx.print(
          `Canal desconhecido "${raw}". Opções: ${CONSOLE_CHANNELS.join(', ')}.`,
          'warn'
        );
        return;
      }
      ctx.setFilter({ channels: new Set<ConsoleChannel>([channel]) });
      ctx.print(`Filtro aplicado: canal ${CHANNEL_LABELS[channel]}.`, 'system');
    },
  });

  registry.register({
    name: 'nivel',
    aliases: ['level'],
    description: 'Mostra somente um nível (dep, info, aviso, erro, sis).',
    usage: '[dep|info|aviso|erro|sis]',
    run: (args, ctx) => {
      const raw = (args[0] ?? '').toLowerCase();
      const level = CONSOLE_LEVELS.find(
        (l) => l === raw || LEVEL_LABELS[l].toLowerCase() === raw
      );
      if (!level) {
        ctx.print(
          `Nível desconhecido "${raw}". Opções: ${CONSOLE_LEVELS.map(
            (l) => LEVEL_LABELS[l].toLowerCase()
          ).join(', ')}.`,
          'warn'
        );
        return;
      }
      ctx.setFilter({ levels: new Set<ConsoleLevel>([level]) });
      ctx.print(`Filtro aplicado: nível ${LEVEL_LABELS[level]}.`, 'system');
    },
  });

  registry.register({
    name: 'buscar',
    aliases: ['find', 'grep'],
    description: 'Filtra as linhas pelo texto. Sem argumento, limpa a busca.',
    usage: '[texto]',
    run: (args, ctx) => {
      const query = args.join(' ');
      ctx.setFilter({ query });
      ctx.print(
        query.length > 0 ? `Buscando por "${query}".` : 'Busca limpa.',
        'system'
      );
    },
  });

  registry.register({
    name: 'copiar',
    aliases: ['copy', 'exportar'],
    description: 'Copia as linhas visíveis para a área de transferência.',
    run: (_args, ctx) => {
      const ok = ctx.copy(ctx.info('exportar').join('\n'));
      ctx.print(
        ok ? 'Linhas copiadas.' : 'Não foi possível acessar a área de transferência.',
        ok ? 'system' : 'warn'
      );
    },
  });

  registry.register({
    name: 'versao',
    aliases: ['version', 'sobre'],
    description: 'Mostra dados do navegador, da tela e do build.',
    run: (_args, ctx) => {
      for (const line of ctx.info('versao')) ctx.print(line);
    },
  });

  return registry;
}
