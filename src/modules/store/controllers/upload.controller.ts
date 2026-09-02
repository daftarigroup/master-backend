import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { uploadBufferToS3, getObjectFromS3 } from '../../../services/s3.service';
import { config } from '../../../config/index';

function extractS3Key(pathOrUrl: string): string {
  let cleaned = pathOrUrl.trim();
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch (_) {}
  // Strip query strings if present
  cleaned = cleaned.split('?')[0];
  // Strip full protocol and domain 
  cleaned = cleaned.replace(/^https?:\/\/[^\/]+\//i, '');
  // Strip leading slashes and prefix paths
  cleaned = cleaned.replace(/^\/+/, '').replace(/^uploads\//i, '').replace(/^api\/store\/files\//i, '');
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

    let url: string;
    if (config.aws.bucket && config.aws.accessKey && config.aws.secretKey) {
      try {
        url = await uploadBufferToS3(key, file.buffer, file.mimetype);
      } catch (s3Err: any) {
        console.error('AWS S3 Upload failed, saving to local uploads fallback:', s3Err?.message || s3Err);
        const localDirPath = path.join(__dirname, '../../../../uploads', path.dirname(key));
        fs.mkdirSync(localDirPath, { recursive: true });
        const localFilePath = path.join(__dirname, '../../../../uploads', key);
        fs.writeFileSync(localFilePath, file.buffer);
        url = `/uploads/${key}`;
      }
    } else {
      console.warn('AWS S3 credentials not set in environment. Saving to local uploads folder.');
      const localDirPath = path.join(__dirname, '../../../../uploads', path.dirname(key));
      fs.mkdirSync(localDirPath, { recursive: true });
      const localFilePath = path.join(__dirname, '../../../../uploads', key);
      fs.writeFileSync(localFilePath, file.buffer);
      url = `/uploads/${key}`;
    }

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
    const s3Configured = !!(config.aws.bucket && config.aws.accessKey && config.aws.secretKey);

    // 1. Try fetching from S3 if credentials exist
    if (s3Configured) {
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
      } catch (s3Err: any) {
        console.warn(`S3 fetch failed for key '${s3Key}' (Bucket: ${config.aws.bucket}):`, s3Err?.message || s3Err);
      }
    } else {
      console.warn(`S3 not configured (missing AWS_BUCKET/AWS_ACCESS_KEY/AWS_SECRET_KEY) — skipping S3 lookup for key '${s3Key}'`);
    }

    // 2. Fallback to local ./uploads directory
    const localFilePath = path.join(__dirname, '../../../../uploads', s3Key);
    if (fs.existsSync(localFilePath)) {
      return res.sendFile(localFilePath);
    }

    console.warn(`File not found for key '${s3Key}' — checked ${s3Configured ? 'S3 and ' : ''}local disk at '${localFilePath}'`);
    throw new ApiError(404, 'File not found');
  });
}
