#!/usr/bin/env node
import { run } from './run.js';

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());

process.exitCode = await run(
  process.argv.slice(2),
  { stdout: process.stdout, stderr: process.stderr },
  process.env,
  controller.signal,
);
