import app from './app/app';
import { config, getAwsConfigStatus } from './config';
import { syncAllSequences } from './modules/store/controllers/generic.controller';

const server = app.listen(config.port, () => {
  console.log(`🚀 Master Backend server running on port ${config.port} in ${config.env} mode`);

  const awsStatus = getAwsConfigStatus();
  if (awsStatus.configured) {
    console.log(`✅ S3 configured — bucket: ${awsStatus.bucket}, region: ${awsStatus.region}`);
  } else {
    console.warn(
      `⚠️ S3 not configured (accessKeySet: ${awsStatus.accessKeySet}, secretKeySet: ${awsStatus.secretKeySet}, bucket: ${awsStatus.bucket || 'unset'}) — file uploads and downloads will FAIL. There is no local-disk fallback.`
    );
  }

  syncAllSequences().catch((err) => {
    console.warn('⚠️ Sequence sync on startup notice:', err);
  });
});

process.on('unhandledRejection', (err: Error) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
  server.close(() => {
    process.exit(1);
  });
});
