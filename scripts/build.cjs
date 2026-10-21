const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function build() {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('Manifest and package versions must match.');
  if (manifest.description.length > 250 || !manifest.description.endsWith('.')) {
    throw new Error('Manifest description must end in a period and contain at most 250 characters.');
  }
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/main.js'],
    outfile: 'main.js',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    external: ['obsidian', 'electron'],
    plugins: [{
      name: 'restricted-runtime',
      setup(build) {
        build.onResolve({ filter: /^(?:node:)?fs(?:\/promises)?$/ }, () => ({ path: path.join(root, 'src/filesystem-disabled.js') }));
        build.onResolve({ filter: /^setimmediate$/ }, () => ({ path: path.join(root, 'src/immediate-safe.js') }));
        build.onResolve({ filter: /^immediate$/ }, () => ({ path: path.join(root, 'src/task-scheduler.js') }));
        build.onResolve({ filter: /^(?:node:)?child_process$/ }, () => ({ errors: [{ text: 'System command execution is forbidden in the installed plugin.' }] }));
      }
    }],
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    minify: false,
    legalComments: 'eof',
    charset: 'utf8',
    footer: { js: '\n/*\n' + fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8').replace(/\*\//g, '* /') + '\n*/' },
  });
  // esbuild's source labels otherwise embed the build machine's dependency path.
  // Canonicalize only comments and CommonJS wrapper labels, never application strings.
  const output = fs.readFileSync(path.join(root, 'main.js'), 'utf8')
    .replace(/^(\s*\/\/ )[^\r\n]*node_modules\/([^\r\n]+)$/gm, '$1node_modules/$2')
    .replace(/^(\s*")[^"\r\n]*node_modules\/([^"\r\n]+)("\([^\r\n]*)$/gm, '$1node_modules/$2$3');
  if (/\bnew\s+Function\s*\(|\beval\s*\(|require\(["'](?:node:)?(?:fs|child_process)["']\)/.test(output)) {
    throw new Error('Forbidden runtime capability in build output.');
  }
  if (/\bcreateElement\s*\(\s*["'`]script["'`]/i.test(output)) {
    throw new Error('Script element creation is forbidden in the installed plugin.');
  }
  fs.writeFileSync(path.join(root, 'main.js'), output);
  // Place full notices next to downloadable assets as well as in the source tree.
  fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, 'release-notices.md'));
  console.log(`Built Kindle Mail ${manifest.version}`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
