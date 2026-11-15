import { FaceRecognitionModule } from '../face-recognition/face-recognition.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [DatabaseModule, FaceRecognitionModule, SubscriptionsModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
