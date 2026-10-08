import { defineConfig } from 'tsup';

// One source, two outputs: ESM for the browser build (Vite) and CommonJS for the NestJS server.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
});
