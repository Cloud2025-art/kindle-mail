const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');
const nodemailer = require('nodemailer');
const { buildEpub } = require('../src/core');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0N8AAAAASUVORK5CYII=', 'base64');
function options(markdown, notes = {}, images = {}) {
  return {
    title: '中文 & title', author: 'Author <test>', root: 'root.md', markdown,
    resolve(target, source) {
      const relative = path.posix.join(path.posix.dirname(source), target);
      const key = [relative, relative + '.md', target, target + '.md'].find(p => p in notes || p in images);
      return key ? { path: key, name: path.posix.basename(key), extension: key.split('.').pop() } : null;
    },
    read: async (file, binary) => binary ? images[file.path] : notes[file.path],
  };
}
async function unpack(result) {
  const zip = await JSZip.loadAsync(result.buffer);
  return { zip, html: await zip.file('EPUB/content.xhtml').async('string') };
}

test('EPUB includes an uncompressed leading mimetype, OPF, spine and navigation', async () => {
  const result = await buildEpub(options('# 文章\n\n正文'));
  const { zip, html } = await unpack(result);
  assert.equal(result.buffer.readUInt16LE(8), 0);
  assert.equal(await zip.file('mimetype').async('string'), 'application/epub+zip');
  assert.equal(result.buffer.subarray(30, 38).toString(), 'mimetype');
  assert(zip.file('META-INF/container.xml'));
  assert((await zip.file('EPUB/package.opf').async('string')).includes('<spine>'));
  assert(zip.file('EPUB/nav.xhtml'));
  assert(html.includes('中文 &amp; title'));
  assert(html.includes('正文'));
});

test('frontmatter is removed, HTML escaped, unsafe links neutralized, code preserved', async () => {
  const { html } = await unpack(await buildEpub(options('---\nprivate: hidden\n---\n<script>x</script>\n\n`![[child]]`\n\n```\n![[child]]\n```\n\n[bad](javascript:alert(1))')));
  assert(!html.includes('private: hidden'));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('<code>![[child]]</code>'));
  assert(html.includes('<pre><code>![[child]]'));
  assert(!html.includes('href="javascript:'));
});

test('embedded notes resolve images relative to their source and deduplicate images', async () => {
  const input = options('![[folder/child]]\n\n![same](folder/photo.png)',
    { 'folder/child.md': '## Child\n\n![Photo](photo.png)' }, { 'folder/photo.png': png });
  const result = await buildEpub(input);
  const { html, zip } = await unpack(result);
  assert.equal(result.images, 1);
  assert(html.includes('Child'));
  assert.equal((html.match(/src="images\/0.png"/g) || []).length, 2);
  assert(zip.file('EPUB/images/0.png'));
});

test('cycles and section embeds produce warnings, while wikilinks become display text', async () => {
  const result = await buildEpub(options('![[child]]\n\n![[child#Heading]]\n\n[[target|显示名称]]', { 'child.md': '![[child]]' }));
  const { html } = await unpack(result);
  assert(result.warnings.some(w => w.includes('未展开')));
  assert(html.includes('显示名称'));
  assert(html.includes('未展开嵌入'));
});

test('remote images never cause reads, and unsupported images degrade to text', async () => {
  const input = options('![Remote](https://example.com/image.png)\n\n![[missing.svg]]');
  input.read = async () => { throw new Error('unexpected read'); };
  const result = await buildEpub(input);
  const { html } = await unpack(result);
  assert.equal(result.images, 0);
  assert(result.warnings.length);
  assert(!html.includes('<img'));
});

test('mismatched image signatures are rejected', async () => {
  await assert.rejects(buildEpub(options('![image](fake.png)', {}, { 'fake.png': Buffer.from('not a PNG') })), /扩展名/);
});

test('fan-out embeds and oversized Markdown are bounded', async () => {
  await assert.rejects(buildEpub(options('![[child]]\n\n'.repeat(101), { 'child.md': 'text' })), /展开过大/);
  await assert.rejects(buildEpub(options('x'.repeat(5 * 1024 * 1024 + 1))), /展开过大/);
});

test('XML-incompatible controls are removed from metadata and content', async () => {
  const input = options('text\x01'); input.title = 'title\x02';
  const { html } = await unpack(await buildEpub(input));
  assert(!/[\x01\x02]/.test(html));
});

test('EPUB attaches as MIME application/epub+zip without sending a message', async () => {
  const result = await buildEpub(options('Read me'));
  const mail = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
    from: 'sender@example.com', to: 'reader@example.com', subject: '中文文章',
    attachments: [{ filename: '文章.epub', content: result.buffer, contentType: 'application/epub+zip' }],
  });
  assert(mail.message.toString().includes('Content-Type: application/epub+zip'));
  assert(mail.message.toString().includes('Content-Transfer-Encoding: base64'));
});

function loadPlugin() {
  const captured = [], notices = [];
  const obsidian = { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, SecretComponent: class {},
    Setting: class {}, TFile: class {}, Notice: class { constructor(message) { notices.push(message); } } };
  const sandbox = { module: { exports: {} }, Buffer,
    require(name) {
      if (name === 'obsidian') return obsidian;
      if (name === './core') return { buildEpub };
      if (name === 'nodemailer') return { createTransport: config => { captured.push(config); return config; } };
      throw new Error('Unexpected import: ' + name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), sandbox);
  const instance = new sandbox.module.exports();
  instance.app = { secretStorage: { getSecret: id => id === 'test-secret' ? 'fake-app-password' : null } };
  instance.settings = { host: 'smtp.example.com', port: '465', user: 'sender@example.com', from: 'sender@example.com', secret: 'test-secret' };
  return { instance, captured, notices };
}

test('SMTP uses TLS verification and prevents URL or file attachment fetching', () => {
  const { instance, captured } = loadPlugin();
  instance.transport();
  assert.equal(captured[0].secure, true);
  assert.equal(captured[0].requireTLS, true);
  assert.equal(captured[0].tls.minVersion, 'TLSv1.2');
  assert.equal(captured[0].disableFileAccess, true);
  assert.equal(captured[0].disableUrlAccess, true);
  assert.equal(captured[0].tls.rejectUnauthorized, undefined);
  instance.settings.port = '587'; instance.transport();
  assert.equal(captured[1].secure, false);
  assert.equal(captured[1].requireTLS, true);
});

test('missing secrets, invalid hosts, ports and sender addresses are rejected locally', () => {
  const { instance, captured } = loadPlugin();
  for (const mutation of [{ secret: '' }, { host: 'https://smtp.example.com' }, { port: '25' }, { from: 'a@example.com\r\nBcc: b@example.com' }]) {
    assert.throws(() => instance.transport({ ...instance.settings, ...mutation }));
  }
  assert.equal(captured.length, 0);
});

test('export requires no secret or SMTP access and does not overwrite an existing file', async () => {
  const { instance, captured, notices } = loadPlugin();
  const writes = [];
  instance.settings = { author: 'Test', folder: 'Kindle Exports' };
  instance.app = { vault: {
    read: async () => '# Content', readBinary: async () => { throw new Error('unexpected image'); },
    adapter: { exists: async () => true }, createFolder: async () => {},
    createBinary: async (file, bytes) => { writes.push({ file, bytes }); },
  }, metadataCache: { getFirstLinkpathDest: () => null } };
  await instance.run({ path: 'note.md', basename: 'note' }, false);
  assert.equal(captured.length, 0);
  assert.equal(writes.length, 1);
  assert.match(writes[0].file, /^Kindle Exports\/note-\d+\.epub$/);
  assert.equal(instance.busy, false);
  assert(notices.some(n => n.startsWith('已导出')));
});

test('export rejects traversal, absolute and hidden-folder paths', async () => {
  for (const folder of ['../outside', 'Exports/../outside', '/outside', 'C:/outside', 'Exports/.obsidian']) {
    const { instance, notices } = loadPlugin();
    instance.settings = { folder };
    instance.app = { vault: { read: async () => 'text' }, metadataCache: { getFirstLinkpathDest: () => null } };
    await instance.run({ path: 'note.md', basename: 'note' }, false);
    assert(notices.some(n => n.includes('导出目录必须')));
  }
});
