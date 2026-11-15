import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
export function setupApp(app: INestApplication) {
  const expressApp = app as Partial<NestExpressApplication>;
  if (typeof expressApp.useBodyParser === 'function') {
    expressApp.useBodyParser('json', { limit: '2mb' });
    expressApp.useBodyParser('urlencoded', { limit: '2mb', extended: true });
  }
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors({ origin: config.getOrThrow<string>('WEB_ORIGIN') });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Gym Management API')
      .setDescription(
        'Modular monolith foundation. Business endpoints marked 501 are not implemented yet.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
}
