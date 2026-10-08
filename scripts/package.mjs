import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist');
await mkdir(dist, {recursive: true});
const table = Array.from({length: 256}, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(buffer) {
  let result = 0xffffffff;
  for (const byte of buffer) result = table[(result ^ byte) & 255] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}
// Small reproducible ZIP writer. Packages only files explicitly selected below.
function zip(entries) {
  const chunks = [], directory = [];
  let offset = 0;
  const date = ((2026 - 1980) << 9) | (10 << 5) | 8;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'));
    const compressed = deflateRawSync(entry.data, {level: 9});
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}
async function collect(directory, prefix = '', exclude = () => false) {
  const output = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const name = prefix + entry.name;
    if (exclude(name, entry)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collect(target, name + '/', exclude));
    else if (entry.isFile()) output.push({name, data: await readFile(target)});
  }
  return output;
}
const reports = [];
async function archive(label, entries) {
  const name = `AdblockerPro-${label}.zip`;
  const buffer = zip(entries);
  await writeFile(path.join(dist, name), buffer);
  reports.push({name, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), entries: entries.length});
  console.log(`${name}: ${entries.length} files, ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
}
const license = {name: 'LICENSE', data: await readFile(path.join(root, 'LICENSE'))};
await archive('browser', [...await collect(path.join(root, 'extension')), license]);
const source = await collect(root, '', name => /^(?:node_modules|dist|artifacts|\.test-profiles|\.git)(?:\/|$)/.test(name) || /^windows\/(?:bin|obj|publish[^/]*)(?:\/|$)/.test(name) || /(?:^|\/)\.DS_Store$|\.log$|\.(?:pem|pfx|p12)$|(?:^|\/)\.env(?:\.|$)/.test(name));
await archive('source', source);
try {
  const windows = await collect(path.join(root, 'windows', 'publish-adblocker-pro'), '', name => name.endsWith('.pdb'));
  if (!windows.some(x => x.name === 'AdblockerPro.exe')) throw new Error('Windows executable not found');
  windows.push(license, {name: 'README.md', data: await readFile(path.join(root, 'docs', 'WINDOWS.md'))});
  await archive('windows-x64', windows);
} catch (error) {
  console.error('Windows package failed: ' + error.message);
  process.exitCode = 1;
}
await writeFile(path.join(dist, 'SHA256SUMS.txt'), reports.map(x => `${x.sha256}  ${x.name}`).join('\n') + '\n');
await writeFile(path.join(dist, 'release.json'), JSON.stringify({version: manifest.version, artifacts: reports}, null, 2) + '\n');
