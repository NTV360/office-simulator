import { initCamera } from './camera/controller.js';
import { initInput } from './camera/input.js';
import { initGrid } from './nav/grid.js';
import { initLabels } from './render/labels.js';
import { initDay } from './sim/day.js';
import { initState } from './sim/state.js';
import { initControls } from './ui/controls.js';
import { initCreator } from './ui/creator.js';
import { initControl } from './player/control.js';
import { initPlayer } from './player/player.js';
import { initLedger } from './ui/ledger.js';
import { initPerson } from './ui/person.js';
import { initSearch } from './ui/search.js';
import { initTeto } from './ui/teto.js';
import { buildBake } from './world/bake.js';
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
import { buildPlush } from './world/furniture/plush.js';
import { buildMusic } from './world/furniture/music.js';
import { buildServer } from './world/furniture/server.js';
import { buildStorage } from './world/furniture/storage.js';
import { buildWorkfloor } from './world/furniture/workfloor.js';
import { buildWalls } from './world/walls.js';
import { buildWhiteboards } from './world/furniture/whiteboard.js';

// The order below is the order the scene is assembled in. It matters: furniture registers interactables and
// the obstacle list, the nav grid reads those obstacles, and people are seated at the desks.
export function bootstrap() {
  // world: building shell, then furniture, then bake static meshes into few draw calls
  buildFloor();
  buildWalls();
  buildDoors();
  buildDesks();
  buildPlush();
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
  initLabels();
  // navigation reads the obstacles registered by the world
  initGrid();
  // simulation; the player's saved look is loaded before anything could spawn them
  initPlayer();
  initState();
  initDay();
  // input and UI
  initCamera();
  initInput();
  initPerson();
  initLedger();
  initControls();
  initControl();
  initCreator();
  initSearch();
  initTeto();
}
