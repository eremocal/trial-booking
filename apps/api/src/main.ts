import 'reflect-metadata';
import { required } from './common/env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BookingErrorFilter } from './http/booking-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new BookingErrorFilter());
  app.enableCors({ origin: true });

  const port = Number(required('API_PORT'));
  await app.listen(port);
  new Logger('bootstrap').log(`API listening on http://localhost:${port}`);
}

void bootstrap();
