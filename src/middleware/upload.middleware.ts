import multer from 'multer';

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).single('file');
