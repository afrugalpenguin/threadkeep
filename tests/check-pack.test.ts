import { describe, expect, it } from 'vitest';
import { evaluateManifest, evaluatePackage } from '../scripts/check-pack.mjs';

const manifest = JSON.stringify({ name: 'x', author: 'afrugalpenguin', license: 'MIT' });
const good = ['dist/index.js', 'README.md', 'LICENSE', 'package.json'];

describe('check-pack', () => {
  it('accepts the expected tarball', () => {
    expect(evaluatePackage('p', good, manifest)).toEqual([]);
  });

  it('rejects stray files and missing README or LICENSE', () => {
    expect(evaluatePackage('p', [...good, 'src/index.ts'], manifest)).toHaveLength(1);
    expect(evaluatePackage('p', ['dist/a.js', 'LICENSE', 'package.json'], manifest)).toEqual(['p: README.md is missing from the tarball']);
    expect(evaluatePackage('p', ['dist/a.js', 'README.md', 'package.json'], manifest)).toEqual(['p: LICENSE is missing from the tarball']);
    expect(evaluatePackage('p', ['README.md', 'LICENSE', 'package.json'], manifest)).toHaveLength(1);
  });

  it('rejects compiled tests and build state inside dist', () => {
    for (const stray of ['dist/a.test.js', 'dist/a.spec.js', 'dist/tsconfig.tsbuildinfo', 'dist/test/x.js', 'dist/sub/__tests__/x.js']) {
      expect(evaluatePackage('p', [...good, stray], manifest)).toEqual([`p: test or build-state file in tarball: ${stray}`]);
    }
  });

  it('checks author, licence and emails without echoing contents', () => {
    expect(evaluateManifest('p', JSON.stringify({ author: 'someone', license: 'MIT' }))).toHaveLength(1);
    expect(evaluateManifest('p', JSON.stringify({ author: 'afrugalpenguin', license: 'ISC' }))).toHaveLength(1);
    const withEmail = JSON.stringify({ author: 'afrugalpenguin', license: 'MIT', bugs: 'someone@example.com' });
    const problems = evaluateManifest('p', withEmail);
    expect(problems).toEqual(['p: package.json contains an email address']);
    expect(evaluateManifest('p', JSON.stringify({ author: { name: 'afrugalpenguin' }, license: 'MIT' }))).toHaveLength(1);
    expect(evaluateManifest('p', '{')).toEqual(['p: package.json is not valid JSON']);
  });
});
