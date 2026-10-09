import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { HealthController } from './health.controller';
import { GameGateway } from './net/game.gateway';
import { WorldController } from './world/world.controller';
import { WorldService } from './world/world.service';

@Module({
  controllers: [HealthController, WorldController],
  providers: [DbService, WorldService, GameGateway],
})
export class AppModule {}
