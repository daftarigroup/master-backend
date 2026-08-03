import app from './app/app';
import { config } from './config';

const server = app.listen(config.port, () => {
  console.log(`🚀 Master Backend server running on port ${config.port} in ${config.env} mode`);
});

process.on('unhandledRejection', (err: Error) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
  server.close(() => {
    process.exit(1);
  });
});
