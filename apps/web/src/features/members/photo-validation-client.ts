'use client';

import { describeFacePhoto } from '@/lib/trained-face-recognition';
import { createPhotoValidationCache } from './member-photo-flow';

export const sharedMemberPhotoValidator =
  createPhotoValidationCache(describeFacePhoto);
