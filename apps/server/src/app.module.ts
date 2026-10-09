import { Module } from '@nestjs/common';
import { DbService } from './db.service';
import { HealthController } from './health.controller';
import { AuthController, SameOriginGuard, SessionGuard } from './auth/auth.controller';
import { AuthProvider } from './auth/auth.provider';
import { PlayController } from './auth/play.controller';
import { CharacterController } from './auth/character.controller';
import { PlayService } from './play/play.service';
import { TicketService } from './auth/tickets';
import { AdminController } from './admin/admin.controller';
import { AdminGuard } from './admin/admin.guard';
import { GameGateway } from './net/game.gateway';
import { WorldController } from './world/world.controller';
import { WorldService } from './world/world.service';

@Module({
  controllers: [HealthController, WorldController, AdminController, AuthController, PlayController, CharacterController],
  providers: [DbService, WorldService, GameGateway, AdminGuard, AuthProvider, PlayService, SessionGuard, SameOriginGuard, { provide: TicketService, useFactory: () => new TicketService() }],
})
export class AppModule {}
