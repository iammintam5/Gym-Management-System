import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** Change fingerprint only; never used as an authentication credential. */
export function photoVersion(photo: string): string {
  return createHash('md5').update(photo).digest('hex');
}

export async function normalizeMemberPhoto(photo: string): Promise<string> {
  if (photo.length > 200000) throw new BadRequestException('Ảnh quá lớn.');
  const match =
    /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match?.[1])
    throw new BadRequestException(
      'Vui lòng chụp hoặc tải ảnh JPEG, PNG, WebP; không dùng đường dẫn ảnh bên ngoài.',
    );
  try {
    const image = sharp(Buffer.from(match[1], 'base64'), {
      limitInputPixels: 4_000_000,
      failOn: 'error',
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1 ||
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')
    )
      throw new Error('Invalid image');
    const bytes = await image
      .rotate()
      .resize(360, 480, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
    const normalized = `data:image/jpeg;base64,${bytes.toString('base64')}`;
    if (normalized.length > 200000) throw new Error('Photo too large');
    return normalized;
  } catch {
    throw new BadRequestException(
      'Ảnh không hợp lệ hoặc vượt giới hạn 4 triệu điểm ảnh.',
    );
  }
}

export async function validateCameraPortrait(photo: string): Promise<void> {
  try {
    const image = sharp(
      Buffer.from(photo.slice(photo.indexOf(',') + 1), 'base64'),
      { limitInputPixels: 360 * 480, failOn: 'error' },
    );
    const meta = await image.metadata();
    if (meta.format !== 'jpeg' || meta.width !== 360 || meta.height !== 480)
      throw new Error('Invalid portrait');
    await image.stats();
  } catch {
    throw new BadRequestException(
      'Ảnh camera phải là JPEG hợp lệ kích thước 360×480.',
    );
  }
}
