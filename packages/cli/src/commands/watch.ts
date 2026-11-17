import chokidar from 'chokidar';
import { adapters, displayPath, ingestFile, safeMessage, type ThreadkeepContext } from 'threadkeep-core';
import { intFlag, parse, str } from '../args.js';
import { usage, type Command } from '../types.js';

// Watches every live adapter root and ingests each changed session file once it settles.
export const watchCommand: Command = async (args, env) => {
  const { values, positionals } = parse(args, { debounce: { type: 'string' } });
  if (positionals.length > 0) throw usage('watch takes no positional arguments');
  const ctx = env.context(str(values['home']));
  const debounce = intFlag(values['debounce'], 'debounce', 500);
  const roots = adapters.filter((a) => a.kind === 'live').flatMap((a) => (ctx.sources[a.id] ? [ctx.sources[a.id]?.root as string] : []));
  if (roots.length === 0) throw usage('no live sources configured');

  const owned = (ctx2: ThreadkeepContext, file: string) => adapters.some((a) => a.archiveFileFor?.(ctx2, file));
  const watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: debounce, pollInterval: Math.max(20, Math.min(100, debounce)) },
    ignored: (p, stats) => Boolean(stats?.isFile() && !p.endsWith('.jsonl')),
  });

  let chain: Promise<void> = Promise.resolve();
  const pending = new Set<string>();
  const queue = (file: string) => {
    if (!owned(ctx, file) || pending.has(file)) return;
    pending.add(file);
    chain = chain.then(async () => {
      pending.delete(file);
      try {
        const r = await ingestFile(ctx, file, { waitMs: 10_000 });
        env.io.stdout.write(`ingested ${displayPath(ctx, file)}: ${r.newEvents} new events, ${r.mirroredBytes} bytes mirrored\n`);
        for (const w of r.warnings) env.io.stderr.write(`warning: ${w}\n`);
      } catch (error) {
        env.io.stderr.write(`error: ${displayPath(ctx, file)}: ${safeMessage(ctx, error)}\n`);
      }
    });
  };
  watcher.on('add', queue).on('change', queue);
  watcher.on('error', (error) => env.io.stderr.write(`error: watcher: ${safeMessage(ctx, error)}\n`));

  await new Promise<void>((resolve) => {
    watcher.on('ready', () => {
      env.io.stdout.write(`watching ${roots.map((r) => displayPath(ctx, r)).join(', ')}\n`);
    });
    if (env.signal?.aborted) resolve();
    env.signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  await watcher.close();
  await chain;
  return 0;
};
