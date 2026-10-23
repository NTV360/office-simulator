import {
  initDay,
  initGrid,
  initState,
  lockLayoutCheck,
  objects,
  refreshFootprint,
  setFixedTops,
} from "@office/shared";
import { initCamera } from "./camera/controller.js";
import { initInput } from "./camera/input.js";
import { initPeopleGroup } from "./people/group.js";
import { initPeopleViews } from "./people/views.js";
import { initControl } from "./player/control.js";
import { initPlayer } from "./player/player.js";
import { initLabels } from "./render/labels.js";
import { initObjectViews } from "./render/objects.js";
import { initMovie } from "./render/screens.js";
import { initControls } from "./ui/controls.js";
import { initCreator } from "./ui/creator.js";
import { initGames } from "./ui/games.js";
import { initInteract } from "./ui/interact.js";
import { initLedger } from "./ui/ledger.js";
import { initPerson } from "./ui/person.js";
import { initSearch } from "./ui/search.js";
import { initSlap } from "./ui/slap.js";
import { buildBake } from "./world/bake.js";
import { buildDoors } from "./world/doors.js";
import { buildEntrance } from "./world/entrance.js";
import { buildFloor } from "./world/floor.js";
import { buildBar } from "./world/furniture/bar.js";
import { buildBooths } from "./world/furniture/booths.js";
import { initChannels } from "./world/furniture/channels.js";
import { buildConference } from "./world/furniture/conference.js";
import { buildDarts } from "./world/furniture/darts.js";
import { buildDesks } from "./world/furniture/desks.js";
import { buildDining } from "./world/furniture/dining.js";
import { buildDiningTv } from "./world/furniture/diningTv.js";
import { buildGame } from "./world/furniture/game.js";
import { buildGolf } from "./world/furniture/golf.js";
import { buildKitchen } from "./world/furniture/kitchen.js";
import { buildLounge } from "./world/furniture/lounge.js";
import { buildMusic } from "./world/furniture/music.js";
import { buildPlants } from "./world/furniture/plants.js";
import { buildServer } from "./world/furniture/server.js";
import { buildStorage } from "./world/furniture/storage.js";
import { buildWhiteboards } from "./world/furniture/whiteboard.js";
import { buildWorkfloor } from "./world/furniture/workfloor.js";
import { OBS, TOPS } from "./world/helpers.js";
import { flushLaterObjects, placeObject } from "./world/objects.js";
import { buildWalls } from "./world/walls.js";

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
  flushLaterObjects(); // (furniture that became items, after the first ones so their ids stay as they were)
  // The medkit on the kitchen counter, at its north-east corner (the free end, away from the fruit and the cups). Made last of all, so every
  // earlier object keeps its id.
  placeObject("medkit-box", 423.5, 999, 0, { y: 0.96 });
  buildBake();
  initObjectViews(); // the chairs and desk things: drawn instanced, from the object data (not baked)
  initChannels(); // every TV screen, for changing channels
  initLabels();
  initMovie();
  // navigation reads the obstacles registered by the world
  initGrid(OBS);
  for (const o of objects.all()) refreshFootprint(o); // (items that block walking: tables, sofas, cabinets)
  setFixedTops(TOPS);
  lockLayoutCheck(); // the fingerprint of the starting layout, before anything is moved
  // simulation; the player's saved look is loaded before anything could spawn them
  initPlayer();
  initPeopleGroup();
  initPeopleViews(); // before the simulation creates anyone, so each new person gets a body
  if (simulate) {
    initState();
    initDay();
  } // online, the server's people arrive in a message instead
  // input and UI
  initCamera();
  initInput();
  initPerson();
  initLedger();
  initControls();
  initControl();
  initCreator();
  initSearch();
  initSlap();
  initInteract();
  initGames();
}
