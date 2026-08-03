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
