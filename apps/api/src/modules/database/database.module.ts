import { Module, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient } from '@gym/database';
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: ReturnType<typeof createPrismaClient>;
  constructor(config: ConfigService) {
    this.client = createPrismaClient(config.getOrThrow<string>('DATABASE_URL'));
  }
  async onApplicationShutdown() {
    await this.client.$disconnect();
  }
}
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
