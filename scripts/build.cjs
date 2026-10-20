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
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    minify: false,
    legalComments: 'eof',
    charset: 'utf8',
    footer: { js: '\n/*\n' + fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8').replace(/\*\//g, '* /') + '\n*/' },
  });
  // Place full notices next to downloadable assets as well as in the source tree.
  fs.copyFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(root, 'release-notices.md'));
  console.log(`Built Kindle Mail ${manifest.version}`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
