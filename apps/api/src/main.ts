import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupApp } from './config/setup-app';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  const port = app.get(ConfigService).getOrThrow<number>('API_PORT');
  await app.listen(port);
  console.log(
    `API: http://localhost:${port}/api | Swagger: http://localhost:${port}/api/docs`,
  );
}
bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
