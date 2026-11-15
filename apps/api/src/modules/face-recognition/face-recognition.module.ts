import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FaceEnrollmentService } from './face-enrollment.service';
import { FaceRecognitionService } from './face-recognition.service';

@Module({
  imports: [ConfigModule],
  providers: [FaceRecognitionService, FaceEnrollmentService],
  exports: [FaceRecognitionService, FaceEnrollmentService],
})
export class FaceRecognitionModule {}
