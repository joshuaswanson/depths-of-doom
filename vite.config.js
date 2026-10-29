import { defineConfig } from 'vite';

// Built for GitHub Pages at joshuaswanson.github.io/submania/; the dev server stays at the root. The iOS app loads
// its copy from the root of its own bundle.
export default defineConfig(({ command, isPreview, mode }) => ({
  base: mode === 'ios' ? '/' : command === 'build' || isPreview ? '/submania/' : '/',
  build: mode === 'ios' ? { outDir: 'dist-ios' } : {},
}));
