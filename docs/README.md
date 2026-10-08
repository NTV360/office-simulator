# Documentation

Read these in order if you are new to the codebase. They describe how the project is organised **and the rules every change should follow**, so that the codebase stays consistent as more people add to it.

| Document | Read it to... |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | understand the layers, the folders, how the app starts up, and who owns which state |
| [CODING-STANDARDS.md](CODING-STANDARDS.md) | know the rules for new code (imports, state, naming, git) and the checklist before you push |
| [HOW-TO.md](HOW-TO.md) | add furniture, an activity, a camera view, a hairstyle or accessory, a HUD control, or a special character |
| [MIGRATION.md](MIGRATION.md) | move work you started against the old single `index.html` into the new structure |
| [DEPLOYMENT.md](DEPLOYMENT.md) | deploy to Render (web service or static site) and fix common deploy errors |
| [ROADMAP.md](ROADMAP.md) | see what is planned (items, shops, saving) and the design it was built to allow |

**The short version**

1. Run it: `npm install`, then `npm run dev` (http://localhost:5173). Build with `npm run build`.
2. The whole scene is assembled in one place: [`src/bootstrap.js`](../src/bootstrap.js). Modules do nothing when imported.
3. Put code in the folder that matches what it is (see the table in [ARCHITECTURE.md](ARCHITECTURE.md)). If it does not fit anywhere, ask before inventing a new folder.
4. Verify in a real browser before pushing (checklist in [CODING-STANDARDS.md](CODING-STANDARDS.md#before-you-push)). There are no automated tests yet.
5. Keep commits short. Do not add AI co-author trailers.
