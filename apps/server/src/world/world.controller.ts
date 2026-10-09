import { Controller, Get, Inject } from '@nestjs/common';
import { WorldService } from './world.service';

@Controller('world')
export class WorldController {
  constructor(@Inject(WorldService) private readonly worlds: WorldService) {}

  /** A summary of the running world: the clock, who is in, and how long ticks take. */
  @Get()
  get() {
    return this.worlds.status();
  }
}
