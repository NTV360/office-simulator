# Office Floor Sim

A 3D office floor simulation (Three.js, built with Vite). Staff follow daily schedules; you can orbit the floor or walk around as your own character in first or third person. Characters come from a chibi + blocky character pack, and you can design your own in the built-in character lab.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs dist/
npm start          # production server: dist/ + the /api BFF (honours $PORT; used on Render)
```

Supabase is reached only through the BFF in `server/`; copy `.env.example` to `.env` and fill in the server-only keys (the app runs without them, keeping data in the browser).

Deploying: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). On Render, build with `npm install && npm run build`, start with `npm start`, and set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

## Controls

- **Orbit views:** drag to move, right-drag or Shift-drag to turn and tilt, wheel or pinch to zoom, `H` hides the HUD. Click a person to see what they are doing.
- **First / Third person:** WASD or arrows move, drag to look, Shift runs, `E` sits or stands, `V` swaps first and third person, `C` swaps shoulder (third person), wheel zooms (third person), `Esc` exits.
- **Character lab:** edits an employee's character (search them, or use **Edit character** on their card): chibi or blocky style, 50 presets, body, hair, clothes and accessories. Save stores it in `character_information`.
- **Hours:** people work through their shift (meetings, whiteboards, booth calls, coffee and snacks) and play only at lunch, 15:00 and 17:00. The clock runs a full day, 06:00 to 06:00.
- **Desks:** Desk A–H and the HR Office; pick an employee's desk on the seat map in the character lab.
- **Clock:** **Live** follows the actual time in Manila; **Simulate** runs the office's own faster clock (pause, 1×/3×/8×). In both, who is in comes from the attendances table (once readable).
- **Find someone:** type a name in the search box at the bottom left; pick them to fly to them and open their card. **Edit character** on the card opens the character lab for them.

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
