import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { World, readWorldOptions, type WorldStatus } from './world';

/** Owns the one World of this process: builds it at startup, runs its tick loop, stops it on shutdown. */
@Injectable()
export class WorldService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly world = new World(readWorldOptions(process.env));

  onApplicationBootstrap(): void {
    this.world.init();
    this.world.start();
    const s = this.world.status();
    console.log(`world running: ${s.staff} staff at ${s.tickRate} Hz, speed ${s.speed}${s.paused ? ' (paused)' : ''}`);
  }

  onApplicationShutdown(): void {
    this.world.stop();
  }

  status(): WorldStatus {
    return this.world.status();
  }
}
