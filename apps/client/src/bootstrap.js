import { initCamera } from './camera/controller.js';
import { initInput } from './camera/input.js';
import { initDay, initGrid, initState, lockLayoutCheck } from '@office/shared';
import { OBS } from './world/helpers.js';
import { initLabels } from './render/labels.js';
import { initPeopleGroup } from './people/group.js';
import { initPeopleViews } from './people/views.js';
import { initControls } from './ui/controls.js';
import { initControl } from './player/control.js';
import { initPlayer } from './player/player.js';
import { initCreator } from './ui/creator.js';
import { initLedger } from './ui/ledger.js';
import { initPerson } from './ui/person.js';
import { initSearch } from './ui/search.js';
import { buildBake } from './world/bake.js';
import { initObjectViews } from './render/objects.js';
import { buildDoors } from './world/doors.js';
import { buildEntrance } from './world/entrance.js';
import { buildFloor } from './world/floor.js';
import { buildBar } from './world/furniture/bar.js';
import { buildBooths } from './world/furniture/booths.js';
import { buildDiningTv } from './world/furniture/diningTv.js';
import { buildConference } from './world/furniture/conference.js';
import { buildDarts } from './world/furniture/darts.js';
import { buildDesks } from './world/furniture/desks.js';
import { buildDining } from './world/furniture/dining.js';
import { buildGame } from './world/furniture/game.js';
import { buildGolf } from './world/furniture/golf.js';
import { buildKitchen } from './world/furniture/kitchen.js';
import { buildLounge } from './world/furniture/lounge.js';
import { buildPlants } from './world/furniture/plants.js';
import { buildMusic } from './world/furniture/music.js';
import { buildServer } from './world/furniture/server.js';
import { buildStorage } from './world/furniture/storage.js';
import { buildWorkfloor } from './world/furniture/workfloor.js';
import { buildWalls } from './world/walls.js';
import { buildWhiteboards } from './world/furniture/whiteboard.js';

// The order below is the order the scene is assembled in. It matters: furniture registers interactables and
// the obstacle list, the nav grid reads those obstacles, and people are seated at the desks.
export function bootstrap({ simulate = true } = {}) {
  // world: building shell, then furniture, then bake static meshes into few draw calls
  buildFloor();
  buildWalls();
  buildDoors();
  buildDesks();
  buildWhiteboards();
  buildConference();
  buildLounge();
  buildGame();
  buildBar();
  buildWorkfloor();
  buildBooths();
  buildDiningTv();
  buildDining();
  buildGolf();
  buildDarts();
  buildServer();
  buildMusic();
  buildKitchen();
  buildStorage();
  buildPlants();
  buildEntrance();
  buildBake();
  initObjectViews(); // the chairs and desk things: drawn instanced, from the object data (not baked)
  initLabels();
  // navigation reads the obstacles registered by the world
  initGrid(OBS);
  lockLayoutCheck(); // the fingerprint of the starting layout, before anything is moved
  // simulation; the player's saved look is loaded before anything could spawn them
  initPlayer();
  initPeopleGroup();
  initPeopleViews(); // before the simulation creates anyone, so each new person gets a body
  if (simulate) { initState(); initDay(); } // online, the server's people arrive in a message instead
  // input and UI
  initCamera();
  initInput();
  initPerson();
  initLedger();
  initControls();
  initControl();
  initCreator();
  initSearch();
}
