# Office Floor Sim

A 3D office floor simulation (Three.js, built with Vite). Staff follow daily schedules; you can orbit the floor or walk around as your own character in first or third person.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs dist/
npm start          # serve the production build (honours $PORT; used on Render)
```

Deploying: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). On Render, build with `npm install && npm run build` and start with `npm start`.

## Controls

- **Orbit views:** drag to move, right-drag or Shift-drag to turn and tilt, wheel or pinch to zoom, `H` hides the HUD. Click a person to see what they are doing.
- **First / Third person:** WASD or arrows move, drag to look, Shift runs, `E` sits or stands, `V` swaps first and third person, `C` swaps shoulder (third person), wheel zooms (third person), `Esc` exits.
- **Hazel:** "Find her" follows her; "Make her angry" does what it says.

## Documentation

Start with [`docs/`](docs/README.md). It sets the standard for how this codebase is organised and changed.

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | layers, folder map, startup order, state ownership |
| [docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md) | rules for new code and the checklist before you push |
| [docs/HOW-TO.md](docs/HOW-TO.md) | recipes: furniture, activities, camera views, looks, HUD controls |
| [docs/MIGRATION.md](docs/MIGRATION.md) | moving work from the old single `index.html` |
| [docs/ROADMAP.md](docs/ROADMAP.md) | planned features and follow-ups |

## At a glance

`index.html` is markup only. `src/bootstrap.js` is the one place the scene is assembled: each module exports a `build*()` or `init*()` function and bootstrap calls them in order; modules do nothing when imported. `src/main.js` runs the frame loop. Code lives in `config/ core/ render/ world/ nav/ character/ people/ sim/ player/ camera/ fp/ ui/ styles/`; see the folder map in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#folder-map-src).
