import { Controller, Get, Inject } from '@nestjs/common';
import { DbService } from './db.service';
import { Health, buildHealth } from './health';

const startedAt = Date.now();

@Controller('health')
export class HealthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get()
  async get(): Promise<Health> {
    return buildHealth({ dbOk: await this.db.check(), startedAt, now: Date.now() });
  }
}
