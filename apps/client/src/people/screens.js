import { HAZEL_NAME, interactables, screenState } from '@office/shared';
import { SCREENS, deskScreens } from '../render/screens.js';

// Turn what each desk's screen should show (the simulation's screenState) into the material on its monitor mesh.
function materialFor(state) {
  if (state === 'off') return SCREENS.off;
  if (state === 'lock') return SCREENS.lock;
  const [kind, variant] = state.split(':');
  return SCREENS[kind][Number(variant)];
}

function updateScreens() {
  for (const s of interactables.of('desk')) {
    // (Hazel's monitor shows her movie while she is slacking: people/hazel.js)
    const o = s.owner, movie = o?.name === HAZEL_NAME && o.task?.spot === s ? o.slack?.screen : null;
    const m = movie ?? materialFor(screenState(s));
    const mesh = deskScreens.get(s.id);
    if (mesh.material !== m) mesh.material = m;
  }
}

export { materialFor, updateScreens };
