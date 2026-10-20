const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('jszip');
const nodemailer = require('nodemailer');
const { buildEpub } = require('../src/core');
const { createBoundedReader, safeVaultPath } = require('../src/safety');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0N8AAAAASUVORK5CYII=', 'base64');
function options(markdown, notes = {}, images = {}) {
  return {
    title: '中文 & title', author: 'Author <test>', root: 'root.md', markdown, includeEmbeddedNotes: true,
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

function loadPlugin({ confirm = false } = {}) {
  const captured = [], notices = [], details = [], calls = [];
  const obsidian = { Plugin: class {}, PluginSettingTab: class {},
    Modal: class {
      constructor() { this.contentEl = { style: {}, createEl: (_, data) => details.push(data.text), empty() {} }; }
      open() { this.onOpen(); this.contentEl.buttons.find(b => b.text === (confirm ? '发送' : '取消')).click(); }
      close() { this.onClose(); }
    }, SecretComponent: class {},
    Setting: class {
      constructor(el) { this.el = el; }
      addButton(fn) {
        const button = { setButtonText(text) { this.text = text; return this; }, setCta() { return this; }, onClick(click) { this.click = click; return this; } };
        fn(button); this.el.buttons ||= []; this.el.buttons.push(button);
        return this;
      }
    }, TFile: class {}, Notice: class { constructor(message) { notices.push(message); } } };
  const sandbox = { module: { exports: {} }, Buffer,
    require(name) {
      if (name === 'obsidian') return obsidian;
      if (name === './core') return { buildEpub };
      if (name === './safety') return { safeVaultPath, createBoundedReader };
      if (name === './smtp') return { createTransport: config => {
        captured.push(config); calls.push('transport');
        return { sendMail: async data => { calls.push(data); return { accepted: [data.to] }; }, close() { calls.push('close'); } };
      } };
      throw new Error('Unexpected import: ' + name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), sandbox);
  const instance = new sandbox.module.exports();
  instance.app = { secretStorage: { getSecret: id => id === 'test-secret' ? 'fake-app-password' : null } };
  instance.settings = { host: 'smtp.example.com', port: '465', user: 'sender@example.com', from: 'sender@example.com', secret: 'test-secret' };
  return { instance, captured, notices, details, calls };
}

test('SMTP uses TLS verification and prevents URL or file attachment fetching', () => {
  const { instance, captured } = loadPlugin();
  instance.transport();
  assert.equal(captured[0].secure, true);
  assert.equal(captured[0].requireTLS, true);
  assert.equal(captured[0].tls.minVersion, 'TLSv1.2');
  assert.equal(captured[0].disableFileAccess, true);
  assert.equal(captured[0].disableUrlAccess, true);
  assert.equal(captured[0].tls.rejectUnauthorized, true);
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
  const file = { path: 'note.md', basename: 'note', extension: 'md' };
  instance.settings = { author: 'Test', folder: 'Kindle Exports' };
  instance.app = { vault: {
    getAbstractFileByPath: p => p === file.path ? file : null,
    read: async () => '# Content', readBinary: async () => { throw new Error('unexpected image'); },
    adapter: { exists: async () => true, stat: async () => ({ type: 'file', size: 9 }) }, createFolder: async () => {},
    createBinary: async (file, bytes) => { writes.push({ file, bytes }); },
  }, metadataCache: { getFirstLinkpathDest: () => null } };
  await instance.run(file, false);
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

test('embedded notes are excluded by default without reading their contents', async () => {
  const input = options('![[private]]', { 'private.md': 'SECRET CONTENT' });
  delete input.includeEmbeddedNotes;
  input.read = async () => { throw new Error('private note must not be read'); };
  const result = await buildEpub(input);
  const { html } = await unpack(result);
  assert(!html.includes('SECRET CONTENT'));
  assert.deepEqual(result.notes, ['root.md']);
  assert(result.warnings.some(w => w.includes('默认不包含')));
});

test('included-file manifest lists recursive notes and deduplicated image paths', async () => {
  const result = await buildEpub(options('![[child]]\n\n![[photo.png]]',
    { 'child.md': '![[nested]]', 'nested.md': '![photo](photo.png)' }, { 'photo.png': png }));
  assert.deepEqual(result.notes, ['root.md', 'child.md', 'nested.md']);
  assert.deepEqual(result.imagePaths, ['photo.png']);
});

function readerFixture(files, sizes = {}) {
  const objects = Object.fromEntries(Object.keys(files).map(p => [p, { path: p, extension: p.split('.').pop(), basename: p.split('.')[0] }]));
  const reads = [];
  const vault = {
    getAbstractFileByPath: p => objects[p] || null,
    adapter: { stat: async p => ({ type: 'file', size: sizes[p] ?? Buffer.byteLength(files[p]) }) },
    read: async f => { reads.push(f.path); return files[f.path]; },
    readBinary: async f => { reads.push(f.path); return files[f.path]; },
  };
  return { vault, objects, reads };
}

test('oversized root notes and images are rejected before contents are read', async () => {
  for (const [name, binary, size] of [['note.md', false, 5 * 1024 * 1024 + 1], ['photo.png', true, 10 * 1024 * 1024 + 1]]) {
    const f = readerFixture({ [name]: binary ? png : 'text' }, { [name]: size });
    await assert.rejects(createBoundedReader(f.vault)(f.objects[name], binary), /过大/);
    assert.deepEqual(f.reads, []);
  }
});

test('cumulative image budget is checked before reading the next file', async () => {
  const data = Buffer.alloc(8 * 1024 * 1024);
  const f = readerFixture({ 'a.png': data, 'b.png': data, 'c.png': data });
  const read = createBoundedReader(f.vault);
  await read(f.objects['a.png'], true);
  await read(f.objects['b.png'], true);
  await assert.rejects(read(f.objects['c.png'], true), /过大/);
  assert.deepEqual(f.reads, ['a.png', 'b.png']);
});

test('growing files are checked again after reading', async () => {
  const f = readerFixture({ 'root.md': 'x'.repeat(5 * 1024 * 1024 + 1) }, { 'root.md': 1 });
  await assert.rejects(createBoundedReader(f.vault)(f.objects['root.md']), /读取时超过/);
});

test('unknown file sizes, hidden paths, traversal and forged vault objects fail closed', async () => {
  const f = readerFixture({ 'root.md': 'text', '.obsidian/private.md': 'secret' });
  const read = createBoundedReader(f.vault);
  for (const name of ['../outside.md', '/outside.md', 'C:/outside.md', 'folder/.secret.md', 'a\\b.md']) {
    assert.equal(safeVaultPath(name), false);
  }
  await assert.rejects(read(f.objects['.obsidian/private.md']), /拒绝读取/);
  await assert.rejects(read({ ...f.objects['root.md'] }), /拒绝读取/);
  f.vault.adapter.stat = async () => ({ type: 'file', size: NaN });
  await assert.rejects(read(f.objects['root.md']), /无法确认/);
  assert.deepEqual(f.reads, []);
});

function sendingFixture(confirm, includeEmbeddedNotes = false) {
  const loaded = loadPlugin({ confirm });
  const files = readerFixture({ 'root.md': '![[child]]\n\n![[photo.png]]', 'child.md': 'private child', 'photo.png': png });
  loaded.instance.settings = { ...loaded.instance.settings, to: 'reader@kindle.com', author: 'Me', includeEmbeddedNotes };
  loaded.instance.app = {
    ...loaded.instance.app, vault: files.vault,
    metadataCache: { getFirstLinkpathDest: p => files.objects[p] || files.objects[p + '.md'] || null },
  };
  return { ...loaded, ...files };
}

test('canceling send reads no secret, creates no transport and uploads nothing', async () => {
  const f = sendingFixture(false);
  f.instance.app.secretStorage.getSecret = () => { throw new Error('secret accessed before confirmation'); };
  await f.instance.run(f.objects['root.md'], true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.instance.busy, false);
  assert(!f.reads.includes('child.md'));
  assert(f.details.includes('笔记：root.md'));
  assert(f.details.includes('图片：photo.png'));
  assert(f.details.includes('SMTP 服务器：smtp.example.com:465'));
});

test('explicitly enabled embeds appear in confirmation and the final attachment', async () => {
  const f = sendingFixture(true, true);
  await f.instance.run(f.objects['root.md'], true);
  assert(f.details.includes('笔记：child.md'));
  assert.equal(f.captured.length, 1);
  const message = f.calls.find(c => c && typeof c === 'object');
  const zip = await JSZip.loadAsync(message.attachments[0].content);
  assert((await zip.file('EPUB/content.xhtml').async('string')).includes('private child'));
  assert.equal(message.to, 'reader@kindle.com');
  assert.equal(f.calls.at(-1), 'close');
});

test('SMTP diagnostics without an error code do not reveal server response or secrets', async () => {
  const f = sendingFixture(true);
  f.instance.transport = () => ({ sendMail: async () => { throw new Error('secret-password raw server response'); }, close() {} });
  await f.instance.run(f.objects['root.md'], true);
  assert(!f.notices.some(n => n.includes('secret-password')));
  assert(f.notices.some(n => n.includes('邮件发送失败')));
  assert.equal(f.instance.busy, false);
});

test('SMTP-only wrapper creates an SMTP transport with file and URL access disabled', () => {
  const { createTransport } = require('../src/smtp');
  const transport = createTransport({ host: 'smtp.example.com', port: 465, secure: true, requireTLS: true, disableFileAccess: true, disableUrlAccess: true, tls: { rejectUnauthorized: true } });
  assert.equal(transport.transporter.name, 'SMTP');
  assert.equal(transport.options.disableFileAccess, true);
  assert.equal(transport.options.disableUrlAccess, true);
  transport.close();
});
