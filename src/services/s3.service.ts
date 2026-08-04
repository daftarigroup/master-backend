import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index';

const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKey,
    secretAccessKey: config.aws.secretKey,
  },
});

export async function uploadBufferToS3(
  key: string,
  buffer: Buffer,
  contentType?: string
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.aws.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    })
  );

  return `https://${config.aws.bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;
}

export async function getObjectFromS3(key: string) {
  const command = new GetObjectCommand({
    Bucket: config.aws.bucket,
    Key: key,
  });
  return await s3Client.send(command);
}
