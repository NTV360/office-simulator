import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { HealthController } from './health.controller';
import { AuthController, SameOriginGuard, SessionGuard } from './auth/auth.controller';
import { AuthProvider } from './auth/auth.provider';
import { AdminController } from './admin/admin.controller';
import { AdminGuard } from './admin/admin.guard';
import { GameGateway } from './net/game.gateway';
import { WorldController } from './world/world.controller';
import { WorldService } from './world/world.service';

@Module({
  controllers: [HealthController, WorldController, AdminController, AuthController],
  providers: [DbService, WorldService, GameGateway, AdminGuard, AuthProvider, SessionGuard, SameOriginGuard],
})
export class AppModule {}
