import fs from 'node:fs';
import { ZipFile } from 'yazl';

// Test-only: builds a small zip from in-memory entries.
export function writeZip(file: string, entries: Record<string, string | Buffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const [name, body] of Object.entries(entries)) {
      zip.addBuffer(typeof body === 'string' ? Buffer.from(body) : body, name);
    }
    zip.end();
    const out = fs.createWriteStream(file);
    out.on('close', () => resolve());
    out.on('error', reject);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
  });
}
