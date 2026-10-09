import { Controller, Get } from '@nestjs/common';
import { WorldService } from './world.service';
import type { WorldStatus } from './world';

@Controller('world')
export class WorldController {
  constructor(private readonly worlds: WorldService) {}

  /** A summary of the running world: the clock, who is in, and how long ticks take. */
  @Get()
  get(): WorldStatus {
    return this.worlds.status();
  }
}
