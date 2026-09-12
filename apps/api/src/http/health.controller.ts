import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

/**
 * Readiness, not just liveness.
 *
 * The API boots, applies migrations and seeds before it serves traffic, so
 * "the process is running" is not the same as "requests will succeed". This
 * checks the database round-trips, which is what compose should wait on before
 * starting the web app.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', database: 'unreachable' });
    }
    return { status: 'ok', database: 'up' };
  }
}
