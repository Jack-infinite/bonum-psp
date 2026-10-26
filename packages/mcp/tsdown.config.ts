import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22.12',
  tsconfig: 'tsconfig.lib.json',
  fixedExtension: false,
  sourcemap: true,
  // Declaration maps would point at src/, which is not published.
  dts: { generator: 'oxc', sourcemap: false },
  plugins: [
    {
      // rolldown-plugin-dts drops the .d.ts.map file but leaves its sourceMappingURL comment.
      name: 'strip-dts-sourcemap-comment',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.fileName.endsWith('.d.ts')) {
            chunk.code = chunk.code.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n');
          }
        }
      },
    },
  ],
});
