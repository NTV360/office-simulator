import { BadRequestException, Body, Controller, Get, Inject, Post, Put, UseGuards } from '@nestjs/common';
import { WorldService } from '../world/world.service';
import { AdminGuard } from './admin.guard';
import { parseSettingsUpdate, type Settings } from './settings';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(WorldService) private readonly worlds: WorldService) {}

  @Get('settings')
  settings(): Settings {
    return this.worlds.settings();
  }

  /** Change the number of staff, the clock speed, or pause. Saved straight away and visible to every viewer. */
  @Put('settings')
  async update(@Body() body: unknown): Promise<Settings> {
    return this.worlds.applySettings(parseSettingsUpdate(body));
  }

  /** Show a message to everyone connected. */
  @Post('announce')
  announce(@Body() body: unknown): { ok: true } {
    const text = (body as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || text.trim() === '' || text.length > 200) throw new BadRequestException('send { "text": "..." } with 1 to 200 characters');
    this.worlds.announce(text.trim());
    return { ok: true };
  }
}
