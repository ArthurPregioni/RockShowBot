import {defineConfig} from 'vite';
import vinext from 'vinext';
import {fileURLToPath} from 'node:url';

// Build on a desktop; the resulting JS runs on native Termux Node without workerd.
export default defineConfig({
  plugins:[vinext({nextConfig:{output:"standalone"}})],
  css:{postcss:fileURLToPath(new URL('.',import.meta.url))},
  resolve:{alias:{'cloudflare:workers':fileURLToPath(new URL('../deploy/node/runtime.mjs',import.meta.url))}},
  define:{'import.meta.env.ROCKSHOWBOT_STANDALONE':JSON.stringify('true')},
});
