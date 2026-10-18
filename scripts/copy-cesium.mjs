// Copies CesiumJS runtime assets into public/cesium so Vite serves them in dev and copies them in build.
// Runs on postinstall, predev, and prebuild.
import { cp, mkdir, rm } from 'node:fs/promises';

const source = 'node_modules/cesium/Build/Cesium';
const target = 'public/cesium';

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const dir of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) {
  await cp(`${source}/${dir}`, `${target}/${dir}`, { recursive: true });
}
console.log(`Copied Cesium assets to ${target}`);
