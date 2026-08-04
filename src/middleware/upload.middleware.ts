import multer, { MulterError } from 'multer';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB limit
}).single('file');

export const uploadSingle = (req: Request, res: Response, next: NextFunction) => {
  multerUpload(req, res, (err: any) => {
    if (err) {
      if (err instanceof MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new ApiError(400, 'File is too large. Maximum allowed file size is 100MB.'));
        }
        return next(new ApiError(400, `Upload error: ${err.message}`));
      }
      return next(err);
    }
    next();
  });
};
