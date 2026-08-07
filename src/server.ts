import app from './app/app';
import { config } from './config';
import { syncAllSequences } from './modules/store/controllers/generic.controller';

const server = app.listen(config.port, () => {
  console.log(`🚀 Master Backend server running on port ${config.port} in ${config.env} mode`);
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
