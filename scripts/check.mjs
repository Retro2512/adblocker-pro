import {readFile, readdir, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage']);
assert(!manifest.externally_connectable);
const references = [manifest.background.service_worker, manifest.options_page, manifest.action.default_popup, ...Object.values(manifest.icons)];
for (const script of manifest.content_scripts) {
  assert.equal(script.run_at, 'document_start');
  assert.equal(script.all_frames, true);
  references.push(...script.js);
}
for (const reference of references) {
  const resolved = path.resolve(extension, reference);
  assert(resolved.startsWith(extension + path.sep));
  assert((await stat(resolved)).isFile(), 'Missing ' + reference);
}
async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(filename)); else files.push(filename);
  }
  return files;
}
const files = await walk(extension);
for (const file of files) {
  const source = await readFile(file);
  if (file.endsWith('.js')) {
    new vm.Script(source.toString('utf8'), {filename: file});
    assert(!/\beval\s*\(|\bnew\s+Function\s*\(/.test(source), 'Dynamic code in ' + file);
  }
  if (file.endsWith('.html')) {
    const html = source.toString('utf8');
    assert(!/<script\b[^>]*src=["']https?:/i.test(html));
    assert(!/<script\b(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html), 'Inline script in ' + file);
    for (const match of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      if (/^(?:https?:|chrome:|data:)/.test(match[1])) continue;
      const resolved = path.resolve(path.dirname(file), match[1]);
      assert(resolved.startsWith(extension + path.sep));
      assert((await stat(resolved)).isFile(), 'Broken resource ' + match[1]);
    }
  }
}
console.log(`Checked manifest, ${references.length} referenced files, ${files.length} extension assets and script syntax`);
