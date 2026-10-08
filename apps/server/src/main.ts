import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks(); // lets Docker stop the server cleanly (later: flush the saved world)
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`server listening on :${port}`);
}

bootstrap().catch(err => {
  console.error('server failed to start:', err);
  process.exit(1);
});
