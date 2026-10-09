import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { HealthController } from './health.controller';
import { AdminController } from './admin/admin.controller';
import { AdminGuard } from './admin/admin.guard';
import { GameGateway } from './net/game.gateway';
import { WorldController } from './world/world.controller';
import { WorldService } from './world/world.service';

@Module({
  controllers: [HealthController, WorldController, AdminController],
  providers: [DbService, WorldService, GameGateway, AdminGuard],
})
export class AppModule {}
