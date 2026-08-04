import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { uploadBufferToS3, getObjectFromS3 } from '../../../services/s3.service';

function extractS3Key(pathOrUrl: string): string {
  let cleaned = pathOrUrl.trim();
  cleaned = cleaned.replace(/^https?:\/\/[^\/]+\//i, '');
  cleaned = cleaned.replace(/^\/+/, '').replace(/^uploads\//i, '');
  return cleaned;
}

export class UploadController {
  // POST /api/store/upload
  uploadFile = asyncHandler(async (req: Request, res: Response) => {
    const file = (req as any).file;

    if (!file) {
      throw new ApiError(400, 'No file provided');
    }

    const bucket = String(req.body.bucket || 'misc').trim();
    const pathName = String(req.body.path || file.originalname).trim();
    const key = `${bucket}/${pathName}`.replace(/^\/+/, '');

    const url = await uploadBufferToS3(key, file.buffer, file.mimetype);

    res.status(201).json({
      success: true,
      data: { path: pathName, url },
    });
  });

  // GET /api/store/file-proxy
  // GET /api/store/files/*
  getFile = asyncHandler(async (req: Request, res: Response) => {
    const rawTarget = (req.query.url || req.query.key || req.params[0] || '') as string;
    if (!rawTarget) {
      throw new ApiError(400, 'No file path or URL provided');
    }

    const s3Key = extractS3Key(rawTarget);

    // 1. Try fetching from S3 using IAM credentials
    try {
      const s3Data = await getObjectFromS3(s3Key);
      if (s3Data && s3Data.Body) {
        if (s3Data.ContentType) {
          res.setHeader('Content-Type', s3Data.ContentType);
        }
        res.setHeader('Content-Disposition', 'inline');
        if (s3Data.ContentLength) {
          res.setHeader('Content-Length', s3Data.ContentLength.toString());
        }

        const stream = s3Data.Body as any;
        if (typeof stream.pipe === 'function') {
          return stream.pipe(res);
        } else {
          const bytes = await stream.transformToByteArray();
          return res.send(Buffer.from(bytes));
        }
      }
    } catch (s3Err) {
      console.warn(`S3 fetch failed for key '${s3Key}', checking local uploads fallback:`, s3Err);
    }

    // 2. Fallback to local ./uploads directory
    const localFilePath = path.join(__dirname, '../../../../uploads', s3Key);
    if (fs.existsSync(localFilePath)) {
      return res.sendFile(localFilePath);
    }

    throw new ApiError(404, 'File not found');
  });
}
