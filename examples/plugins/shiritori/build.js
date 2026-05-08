const esbuild = require('esbuild');
const { solidPlugin } = require('esbuild-plugin-solid');
const path = require('path');

async function build() {
  const srcDir = path.join(__dirname, 'src');
  const distDir = path.join(__dirname, 'dist');

  // Build UI (browser module with SolidJS JSX)
  await esbuild.build({
    entryPoints: [path.join(srcDir, 'ui.tsx')],
    bundle: true,
    outfile: path.join(distDir, 'ui.js'),
    format: 'esm',
    platform: 'browser',
    plugins: [solidPlugin()],
    sourcemap: true,
    loader: {
      '.css': 'css',
    },
  });

  // Build main (Node.js CJS module)
  await esbuild.build({
    entryPoints: [path.join(srcDir, 'main.ts')],
    bundle: true,
    outfile: path.join(distDir, 'main.cjs'),
    format: 'cjs',
    platform: 'node',
    external: ['fs', 'path'],
  });

  console.log('Shiritori plugin built successfully!');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
