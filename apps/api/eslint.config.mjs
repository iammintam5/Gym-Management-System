import base from '@gym/eslint-config/base';
export default [
  ...base,
  { ignores: ['src/modules/face-recognition/runtime/assets/**', 'dist/**'] },
];
