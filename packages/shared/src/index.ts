// Code that both the browser client and the server use. No DOM, no Three.js, no Node-only APIs.
//
// Phase 0 only proves the wiring (a package both sides can import). The simulation, the character
// spec, the floor plan and the network protocol move in here in later phases; see
// docs/MULTIPLAYER-PLAN.md.

import { WIRE_VERSION } from './protocol/messages';

/** Bump when the client/server message format changes in a way old clients cannot read. */
export const PROTOCOL_VERSION = WIRE_VERSION;

export * from './server-defaults';
export * from './plan';
export * from './util';
export * from './vec3';
export * from './character/spec';
export * from './sim/data';
export * from './nav/grid';
export * from './nav/astar';
export * from './sim/locomotion';
export * from './sim/props';
export * from './sim/person';
export * from './sim/interactables';
export * from './sim/spots';
export * from './sim/types';
export * from './sim/events';
export * from './sim/hazel';
export * from './sim/state';
export * from './sim/tasks';
export * from './sim/meetings';
export * from './sim/day';
export * from './sim/step';
export * from './sim/factory';
export * from './sim/testing';
export * from './layout/layout';
export * from './layout/office';
export * from './protocol';
export * from './sim/persist';
