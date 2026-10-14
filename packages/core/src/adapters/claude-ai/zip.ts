import type { Readable } from 'node:stream';
import yauzl from 'yauzl';

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('cannot open zip'));
      else resolve(zip);
    });
  });
}

// Walks the central directory only; no entry is decompressed.
export async function zipEntryNames(file: string): Promise<string[]> {
  const zip = await openZip(file);
  return new Promise((resolve, reject) => {
    const names: string[] = [];
    zip.on('entry', (entry: yauzl.Entry) => {
      names.push(entry.fileName);
      zip.readEntry();
    });
    zip.on('end', () => {
      zip.close();
      resolve(names);
    });
    zip.on('error', (error) => {
      zip.close();
      reject(error);
    });
    zip.readEntry();
  });
}

// Streams one entry. The zip is closed when the stream ends or is destroyed.
export async function openZipEntry(file: string, name: string): Promise<Readable> {
  const zip = await openZip(file);
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName !== name) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          zip.close();
          reject(error ?? new Error('cannot read zip entry'));
          return;
        }
        stream.on('close', () => zip.close());
        resolve(stream);
      });
    });
    zip.on('end', () => {
      zip.close();
      reject(new Error(`zip has no ${name}`));
    });
    zip.on('error', (error) => {
      zip.close();
      reject(error);
    });
    zip.readEntry();
  });
}

export const CONVERSATIONS_ENTRY = 'conversations.json';
