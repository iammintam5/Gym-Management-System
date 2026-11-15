import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FaceDescriptorSnapshot } from '@gym/contracts';
import { photoVersion } from '../common/member-photo';
import { FaceWorkerController } from './runtime/face-worker-controller.cjs';

@Injectable()
export class FaceRecognitionService implements OnModuleDestroy {
  private readonly logger = new Logger(FaceRecognitionService.name);
  readonly modelVersion: string;
  private readonly worker: FaceWorkerController;

  constructor(config: ConfigService) {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, 'runtime/assets/manifest.json'), 'utf8'),
    ) as { descriptorVersion: string };
    this.modelVersion = manifest.descriptorVersion;
    const timeout = Number(
      config.get<string>('FACE_WORKER_TIMEOUT_MS') ?? 45000,
    );
    const queueSize = Number(config.get<string>('FACE_WORKER_QUEUE_SIZE') ?? 0);
    this.worker = new FaceWorkerController({
      defaultTimeoutMs: timeout,
      maxQueueSize: queueSize,
      eagerStart: false,
      idleTimeoutMs: 60000,
    });
  }

  async prepare(
    photo: string,
  ): Promise<FaceDescriptorSnapshot & { photo: string }> {
    try {
      const result = await this.worker.analyzePhoto(photo);
      if (
        result.faceCount !== 1 ||
        !result.descriptor ||
        !result.mirroredDescriptor
      ) {
        throw new BadRequestException({
          code: 'INVALID_MEMBER_FACE_PHOTO',
          message:
            'Ảnh cần có đúng một khuôn mặt rõ. Vui lòng chụp lại chính diện.',
        });
      }
      return {
        photo: result.normalizedDataUrl,
        photoVersion: photoVersion(result.normalizedDataUrl),
        modelVersion: result.descriptorVersion,
        descriptor: Array.from(result.descriptor),
        mirroredDescriptor: Array.from(result.mirroredDescriptor),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const code =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
      if (code === 'INVALID_INPUT')
        throw new BadRequestException('Ảnh không hợp lệ. Vui lòng chụp lại.');
      this.logger.warn(
        `Face worker request failed (${String(code ?? 'UNKNOWN')})`,
      );
      throw new ServiceUnavailableException(
        'Nhận diện đang bận hoặc chưa sẵn sàng. Vui lòng thử lại sau giây lát.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.shutdown();
  }
}
