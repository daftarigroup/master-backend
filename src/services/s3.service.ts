import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config/index';

const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKey,
    secretAccessKey: config.aws.secretKey,
  },
});

// Single source of truth for the public URL shape — used by both the legacy
// buffer-proxy upload path and the presigned-upload path, so they never drift.
export function buildS3PublicUrl(key: string): string {
  return `https://${config.aws.bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;
}

// Normalises any stored file value (full S3 URL, bare key, or a legacy
// /uploads/... path) down to the S3 object key it refers to.
export function extractS3KeyFromUrl(pathOrUrl: string): string {
  let cleaned = pathOrUrl.trim();
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch (_) {}
  cleaned = cleaned.split('?')[0];
  cleaned = cleaned.replace(/^https?:\/\/[^\/]+\//i, '');
  cleaned = cleaned
    .replace(/^\/+/, '')
    .replace(/^uploads\//i, '')
    .replace(/^api\/store\/files\//i, '');
  return cleaned;
}

// Nests a path under the caller-supplied folderId with no forced root prefix
// — folderId is expected to be a fully-qualified module/section path (e.g.
// "store-and-inventory/lifting") so the bucket's layout mirrors the app's
// own module structure and can be backed up/reasoned about per section.
export function buildUploadKey(folderId: string, path: string): string {
  const cleanFolderId = folderId.replace(/^\/+|\/+$/g, '');
  const cleanPath = path.replace(/^\/+/, '');
  return cleanFolderId ? `${cleanFolderId}/${cleanPath}` : cleanPath;
}

// Reads an object's bytes on the server. Only used where the server itself
// genuinely needs the content (e.g. attaching a file to an outgoing email) —
// never for serving files to the browser, which uses presigned GET redirects.
export async function getObjectFromS3(key: string) {
  const command = new GetObjectCommand({
    Bucket: config.aws.bucket,
    Key: key,
  });
  return await s3Client.send(command);
}

// Generates a time-limited URL the browser can PUT directly to, bypassing the
// Node server entirely. The ContentType here is signed as part of the
// request — the caller's actual PUT must send the identical Content-Type
// header or S3 will reject it with SignatureDoesNotMatch.
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.aws.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

// Deletes an object from S3. S3 does not error when the key is already
// missing, so this is naturally idempotent/safe to call more than once or
// against a key that was never actually written.
export async function deleteObjectFromS3(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
    })
  );
}

// Cheap existence check used before issuing a view redirect, so a missing
// object produces a clean JSON 404 from us instead of S3's raw XML error page
// (which is what legacy /uploads/... records would otherwise hit).
export async function headObjectFromS3(key: string) {
  return s3Client.send(
    new HeadObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
    })
  );
}

// Generates a time-limited URL the browser can GET directly from S3, so file
// bytes never pass through this server. ResponseContentDisposition is signed
// as part of the request, which is how inline preview (and the explicit
// download variant) is preserved without us serving the bytes ourselves.
export async function getPresignedGetUrl(
  key: string,
  expiresInSeconds = 900,
  download?: { filename?: string }
): Promise<string> {
  const filename = download?.filename?.replace(/["\\]/g, '') || key.split('/').pop() || 'download';
  const command = new GetObjectCommand({
    Bucket: config.aws.bucket,
    Key: key,
    ResponseContentDisposition: download
      ? `attachment; filename="${filename}"`
      : 'inline',
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}
