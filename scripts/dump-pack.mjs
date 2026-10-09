// Writes packages/shared/src/character/pack-data.json: the plain data of the character pack (its option lists, colour palettes, accessories
// and presets), so the shared package and the server can validate and make character specs without Three.js. The pack itself
// (apps/client/src/character/pack/) is vendored and never edited; run this again whenever it is updated.   npm run pack:dump
// (A test fails if the data here no longer matches the pack.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packDir = path.join(root, 'apps/client/src/character/pack');
const out = path.join(root, 'packages/shared/src/character/pack-data.json');

/** The data of the pack, read from the pack's own modules. */
export async function readPack() {
  const load = f => import(pathToFileURL(path.join(packDir, f)).href);
  const [chibi, blocky, chars] = await Promise.all([load('chibi-character.js'), load('blocky-character.js'), load('characters.js')]);
  const accessories = lib => Object.fromEntries(Object.entries(lib.ACCESSORIES).map(([name, d]) => {
    const rec = { slot: d.slot };
    if (d.hand !== undefined) rec.hand = d.hand;
    if (d.hat) rec.hat = true;
    if (typeof d.color === 'string') rec.color = d.color;
    return [name, rec];
  }));
  const styles = { chibi: [chibi, chibi.ChibiCharacter], blocky: [blocky, blocky.BlockyCharacter] };
  const data = { options: {}, palettes: {}, accessories: {}, presets: {} };
  for (const [type, [lib, Class]] of Object.entries(styles)) {
    data.options[type] = JSON.parse(JSON.stringify(Class.options));
    data.palettes[type] = { skin: { ...lib.SKIN_TONES }, hair: { ...lib.HAIR_COLORS }, eyes: { ...lib.EYE_COLORS } };
    data.accessories[type] = accessories(lib);
    data.presets[type] = JSON.parse(JSON.stringify(chars.PRESETS[type]));
  }
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = await readPack();
  fs.writeFileSync(out, JSON.stringify(data, null, 1) + '\n');
  console.log(`wrote ${path.relative(root, out)}: ${Object.keys(data.presets.chibi).length + Object.keys(data.presets.blocky).length} presets, ${Object.keys(data.accessories.chibi).length + Object.keys(data.accessories.blocky).length} accessories`);
}
