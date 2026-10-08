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
| `world/` | Floor, walls, doors, furniture (one file per area), static-mesh baking |
| `nav/` | Navigation grid and A* pathfinding |
| `people/` | Appearance data, body rig, animation, person factory |
| `sim/` | Shared sim state, tasks, meetings, day cycle, per-frame stepping |
| `camera/` | Camera state/views, pointer + keyboard input, jump-to spots |
| `ui/` | HUD controls, ledger, selected-person card |
| `fp/` | First-person mode |
| `styles/` | CSS, split by UI area |

`src/main.js` imports every module in dependency order and runs the main loop.
Module import order matters: furniture modules build the scene (and fill `SEATS`) at import time.
