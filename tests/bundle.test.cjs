const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Duplex } = require('node:stream');
const { isBuiltin } = require('node:module');
const bundlePath = path.join(__dirname, '../main.js');

function loadBundle() {
  const imported = [];
  const source = fs.readFileSync(bundlePath, 'utf8');
  assert(!/\bnew\s+Function\s*\(|\beval\s*\(|require\(["'](?:node:)?(?:fs|child_process)["']\)/.test(source));
  const context = vm.createContext({
    module: { exports: {} }, Buffer, process, console, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name) {
      imported.push(name);
      if (name === 'obsidian') return { Plugin: class {}, Modal: class {}, PluginSettingTab: class {} };
      assert(!/^(?:node:)?(?:fs|child_process)(?:\/|$)/.test(name), 'forbidden runtime import: ' + name);
      assert(isBuiltin(name), 'unbundled dependency: ' + name);
      return require(name);
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(source + '\nmodule.exports = { Mailer: require_mailer(), createTransport: require_smtp().createTransport, buildEpub: require_core().buildEpub };').runInContext(context);
  return { ...context.module.exports, imported, context };
}

test('installed bundle generates EPUB without fs, child_process or dynamic compilation', { skip: !fs.existsSync(bundlePath) }, async () => {
  const bundle = loadBundle();
  // No native setImmediate was supplied: exercises the function-only fallback too.
  const result = await bundle.buildEpub({ title: '离线测试', author: 'Me', root: 'root.md', markdown: '# hello', resolve: () => null, read: async () => { throw new Error('unexpected read'); } });
  assert(result.buffer.length > 0);
  assert.throws(() => bundle.context.setImmediate('globalThis.unexpected = true'), /function callback/);
});

test('installed mail dependency composes MIME in memory and rejects file attachments', { skip: !fs.existsSync(bundlePath) }, async () => {
  const { Mailer } = loadBundle();
  const mailer = new Mailer({
    name: 'offline', version: 'test',
    send(mail, callback) {
      const chunks = [];
      mail.message.createReadStream().on('data', chunk => chunks.push(chunk)).once('error', callback)
        .once('end', () => callback(null, { message: Buffer.concat(chunks) }));
    },
  }, { disableFileAccess: true, disableUrlAccess: true });
  const info = await mailer.sendMail({ from: 'a@example.com', to: 'b@kindle.com', subject: '测试', attachments: [{ filename: 'test.epub', content: Buffer.from('EPUB bytes'), contentType: 'application/epub+zip' }] });
  assert(info.message.toString().includes('Content-Type: application/epub+zip'));
  assert(info.message.toString().includes(Buffer.from('EPUB bytes').toString('base64')));
  await assert.rejects(mailer.sendMail({ from: 'a@example.com', to: 'b@kindle.com', attachments: [{ path: 'should-never-open.txt' }] }), /File access rejected/);
  await assert.rejects(mailer.sendMail({ from: 'a@example.com', to: 'b@kindle.com', attachments: [{ href: 'https://example.invalid/never-fetch' }] }), /Url access rejected/);
});

test('installed SMTP rejects a simulated server that refuses TLS before transmitting credentials', { skip: !fs.existsSync(bundlePath), timeout: 5000 }, async t => {
  const { createTransport } = loadBundle();
  const commands = [];
  const socket = new Duplex({
    read() {},
    write(data, encoding, callback) {
      for (const line of data.toString().split('\r\n').filter(Boolean)) {
        commands.push(line);
        const response = /^EHLO/.test(line) ? '250-localhost\r\n250 AUTH PLAIN\r\n' : /^STARTTLS/.test(line) ? '502 TLS unavailable\r\n' : '500 unsupported\r\n';
        setImmediate(() => { if (!this.destroyed) this.push(response); });
      }
      callback();
    },
  });
  socket.setTimeout = () => socket;
  const transport = createTransport({ host: 'smtp.example.invalid', port: 587, secure: false, requireTLS: true,
    getSocket(options, callback) { callback(null, { connection: socket }); setImmediate(() => socket.push('220 localhost simulated SMTP\r\n')); },
    auth: { user: 'fake-user', pass: 'fake-password' }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 1000, disableFileAccess: true, disableUrlAccess: true });
  t.after(() => { transport.close(); socket.destroy(); });
  await assert.rejects(transport.verify(), error => error.code === 'ETLS');
  assert(commands.some(line => /^STARTTLS/.test(line)));
  assert(!commands.some(line => /^(?:AUTH|MAIL|DATA)/.test(line)));
  assert(!commands.some(line => line.includes('fake-password')));
});

test('installed SMTP completes authentication, envelope and EPUB DATA with a simulated secure socket', { skip: !fs.existsSync(bundlePath), timeout: 5000 }, async t => {
  const { createTransport, buildEpub } = loadBundle();
  let pending = '', message = '', readingData = false;
  const commands = [];
  const socket = new Duplex({ read() {}, write(data, encoding, callback) {
    pending += data.toString();
    let end;
    while ((end = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 2);
      let response;
      if (readingData) {
        if (line === '.') { readingData = false; response = '250 2.0.0 queued\r\n'; }
        else message += line + '\r\n';
      } else {
        commands.push(line);
        if (/^EHLO/.test(line)) response = '250-localhost\r\n250 AUTH PLAIN\r\n';
        else if (/^AUTH PLAIN/.test(line)) response = '235 2.7.0 authenticated\r\n';
        else if (/^(MAIL FROM|RCPT TO)/.test(line)) response = '250 2.1.0 OK\r\n';
        else if (line === 'DATA') { readingData = true; response = '354 send data\r\n'; }
        else if (line === 'QUIT') response = '221 bye\r\n';
        else response = '500 unsupported\r\n';
      }
      if (response) setImmediate(() => { if (!socket.destroyed) socket.push(response); });
    }
    callback();
  } });
  socket.setTimeout = () => socket;
  const transport = createTransport({ host: 'smtp.example.invalid', port: 465, secure: true, requireTLS: true,
    getSocket(options, callback) { callback(null, { connection: socket, secured: true }); setImmediate(() => socket.push('220 simulated secure SMTP\r\n')); },
    auth: { user: 'fake-user', pass: 'fake-password' }, tls: { rejectUnauthorized: true },
    connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 1000, disableFileAccess: true, disableUrlAccess: true });
  t.after(() => { transport.close(); socket.destroy(); });
  const epub = await buildEpub({ title: '投递测试', author: 'Me', root: 'root.md', markdown: '# 测试', resolve: () => null, read: async () => { throw new Error('unexpected'); } });
  const result = await transport.sendMail({ from: 'sender@example.com', to: 'reader@kindle.com', subject: '投递测试', text: 'Test', attachments: [{ filename: 'test.epub', content: epub.buffer, contentType: 'application/epub+zip' }] });
  assert.equal(result.accepted[0], 'reader@kindle.com');
  assert.match(result.response, /queued/);
  assert(commands.some(line => /^AUTH PLAIN/.test(line)));
  assert(message.includes('Content-Type: application/epub+zip'));
  const base64 = epub.buffer.toString('base64');
  assert(message.replace(/\r\n/g, '').includes(base64));
});
