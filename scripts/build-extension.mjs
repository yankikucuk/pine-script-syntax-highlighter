import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
