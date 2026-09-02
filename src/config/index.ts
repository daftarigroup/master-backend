import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5001', 10),
  env: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  jwt: {
    secret: process.env.JWT_SECRET || 'default_jwt_secret',
    refreshSecret: process.env.REFRESH_SECRET || 'default_refresh_secret',
    expiresIn: '1d',
    refreshExpiresIn: '7d',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },
  aws: {
    region: process.env.AWS_REGION || '',
    bucket: process.env.AWS_BUCKET || '',
    accessKey: process.env.AWS_ACCESS_KEY || '',
    secretKey: process.env.AWS_SECRET_KEY || '',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
  },
};

/**
 * Safe-to-log snapshot of the S3 config: confirms the AWS_* env vars were
 * actually picked up by this running process, without ever exposing the
 * access key or secret key values themselves (only presence/absence).
 * Use this to verify a deployed environment's config from startup logs or
 * the /health endpoint instead of the values from .env — a key can be set in
 * the hosting dashboard yet not reach the running process (wrong var name,
 * env not injected, process not restarted after the change, etc).
 */
export function getAwsConfigStatus() {
  return {
    configured: !!(config.aws.bucket && config.aws.accessKey && config.aws.secretKey),
    region: config.aws.region || null,
    bucket: config.aws.bucket || null,
    accessKeySet: !!config.aws.accessKey,
    secretKeySet: !!config.aws.secretKey,
  };
}
