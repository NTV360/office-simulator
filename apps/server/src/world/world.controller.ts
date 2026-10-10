import { Controller, Get, Inject, Query } from '@nestjs/common';
import { WorldService } from './world.service';

@Controller('world')
export class WorldController {
  constructor(@Inject(WorldService) private readonly worlds: WorldService) {}

  /** A summary of the running world: the clock, who is in, and how long ticks take. */
  @Get()
  get(@Query('fresh') fresh?: string) {
    return this.worlds.status(fresh === '1'); // ?fresh=1 empties the event-loop window first (a load test does; anybody else just looks)
  }
}
