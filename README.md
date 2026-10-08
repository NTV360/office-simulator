# Office Floor Sim

3D office floor simulation (Three.js). Built with Vite.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

## Layout (`src/`)

| Folder | What lives there |
|---|---|
| `config/` | Floor-plan data and coordinate conversion |
| `core/` | Small shared utilities |
| `render/` | Renderer, scene, materials, screen textures, labels, day/night lighting |
| `world/` | Floor, walls, doors, furniture (one file per area), `interactables.js` registry (desks, seats, counters...), static-mesh baking |
| `nav/` | Navigation grid and A* pathfinding |
| `people/` | Appearance data, body rig, animation, person factory |
| `sim/` | Shared sim state, tasks, meetings, day cycle, per-frame stepping |
| `camera/` | `controller.js` switches camera modes (`modes/`: angle, top, follow, free, firstPerson); `state.js` orbit state; `orbit.js` + `input.js` pointer/keyboard input; `spots.js` jump-to |
| `ui/` | HUD controls, ledger, selected-person card |
| `fp/` | First-person mode |
| `styles/` | CSS, split by UI area |

`src/bootstrap.js` is the one place that assembles the scene: each world/sim/UI module exports a `build*()` or `init*()` function and bootstrap calls them in order (furniture registers interactables, the nav grid reads the obstacles, then people are seated). Modules do nothing on import. `src/main.js` calls `bootstrap()` and runs the main loop.

To add a camera view: write a mode (`{ id, enter, update, exit }`) in `camera/modes/` and register it in `initCamera()`.
