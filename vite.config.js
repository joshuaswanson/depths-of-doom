import { defineConfig } from 'vite';

// Built for GitHub Pages at joshuaswanson.github.io/depths-of-doom/; the dev server stays at the root.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/depths-of-doom/' : '/',
}));
