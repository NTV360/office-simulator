import { SCREENS, deskScreens } from '../render/screens.js';
import { screenState } from '../sim/step.js';
import { interactables } from '../world/interactables.js';

// Turn what each desk's screen should show (the simulation's screenState) into the material on its monitor mesh.
function materialFor(state) {
  if (state === 'off') return SCREENS.off;
  if (state === 'lock') return SCREENS.lock;
  const [kind, variant] = state.split(':');
  return SCREENS[kind][Number(variant)];
}

function updateScreens() {
  for (const s of interactables.of('desk')) {
    const m = materialFor(screenState(s));
    const mesh = deskScreens.get(s.id);
    if (mesh.material !== m) mesh.material = m;
  }
}

export { materialFor, updateScreens };
