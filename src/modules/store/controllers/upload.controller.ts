import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import {
  headObjectFromS3,
  getPresignedGetUrl,
  getPresignedPutUrl,
  buildUploadKey,
  buildS3PublicUrl,
  extractS3KeyFromUrl,
  deleteObjectFromS3,
} from '../../../services/s3.service';
import { getAwsConfigStatus } from '../../../config/index';

export class UploadController {
  // POST /api/store/upload/presign
  // Issues a time-limited URL the browser PUTs the file to directly. File
  // bytes never touch this server, and there is no fallback: if S3 isn't
  // configured (or is explicitly disabled via DISABLE_PRESIGNED_UPLOADS)
  // this responds 503 and the upload fails outright rather than degrading
  // to any server-mediated or local-disk path.
  presignUpload = asyncHandler(async (req: Request, res: Response) => {
    const awsStatus = getAwsConfigStatus();
    const disabled = String(process.env.DISABLE_PRESIGNED_UPLOADS || '').toLowerCase() === 'true';

    if (!awsStatus.configured || disabled) {
      res.status(503).json({
        success: false,
        code: 'S3_NOT_CONFIGURED',
        message: 'Direct-to-S3 upload is unavailable because S3 is not configured on the server.',
      });
      return;
    }

    const bucket = String(req.body?.bucket || '').trim();
    const pathName = String(req.body?.path || '').trim();
    const contentType = String(req.body?.contentType || 'application/octet-stream').trim();

    if (!bucket || !pathName) {
      throw new ApiError(400, 'bucket and path are required');
    }

    const key = buildUploadKey(bucket, pathName);
    const uploadUrl = await getPresignedPutUrl(key, contentType);
    const publicUrl = buildS3PublicUrl(key);

    res.status(201).json({
      success: true,
      data: { uploadUrl, key, publicUrl, expiresIn: 300 },
    });
  });

  // DELETE /api/store/upload
  // Deletes a previously-uploaded S3 object, given its public URL or bare
  // key. Used to clean up orphaned objects when a user removes or replaces
  // an attachment that was already uploaded — best-effort housekeeping, not
  // part of the primary save flow.
  deleteUpload = asyncHandler(async (req: Request, res: Response) => {
    const raw = String(req.body?.url || req.body?.key || '').trim();
    if (!raw) {
      throw new ApiError(400, 'url or key is required');
    }

    if (!getAwsConfigStatus().configured) {
      res.status(503).json({
        success: false,
        code: 'S3_NOT_CONFIGURED',
        message: 'S3 is not configured on the server.',
      });
      return;
    }

    const key = extractS3KeyFromUrl(raw);
    await deleteObjectFromS3(key);

    res.status(200).json({ success: true });
  });

  // GET /api/store/file-proxy?url=...[&download=1]
  // GET /api/store/files/*
  // Redirects the browser to a short-lived presigned S3 URL rather than
  // streaming the bytes through this server, so the file transfers directly
  // between the browser and S3 while the bucket itself stays private.
  getFile = asyncHandler(async (req: Request, res: Response) => {
    const rawTarget = (req.query.url || req.query.key || req.params[0] || '') as string;
    if (!rawTarget) {
      throw new ApiError(400, 'No file path or URL provided');
    }

    if (!getAwsConfigStatus().configured) {
      throw new ApiError(503, 'S3 is not configured on the server — files cannot be served.');
    }

    const s3Key = extractS3KeyFromUrl(rawTarget);
    const wantsDownload = String(req.query.download || '') === '1';
    const filename = typeof req.query.filename === 'string' ? req.query.filename : undefined;

    // Confirm the object exists first so a missing key returns our clean JSON
    // 404 instead of redirecting the browser to an S3 XML error page.
    try {
      await headObjectFromS3(s3Key);
    } catch (s3Err: any) {
      console.warn(`File not found in S3 for key '${s3Key}':`, s3Err?.message || s3Err);
      throw new ApiError(404, 'File not found');
    }

    const signedUrl = await getPresignedGetUrl(
      s3Key,
      900,
      wantsDownload ? { filename } : undefined
    );

    return res.redirect(302, signedUrl);
  });
}
