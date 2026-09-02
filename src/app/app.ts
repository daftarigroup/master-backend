import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'path';
import apiRouter from '../routes';
import { errorHandler } from '../middleware/error.middleware';
import { authenticateJWT } from '../middleware/auth.middleware';
import { ApiError } from '../utils/ApiError';

const app = express();

// Use CORS before all other middleware
app.use(cors({
  origin: true, // Reflect request origin to allow credentials from any origin during dev
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cache-Control', 'Pragma', 'Expires', 'If-None-Match'],
}));

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cookieParser());

// Static file serving for uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Base authentication check
app.use('/api', authenticateJWT, apiRouter);

// 404 Handler
app.use((req, res, next) => {
  next(new ApiError(404, `Route ${req.originalUrl} not found`));
});

// Global Error Handler
app.use(errorHandler);

export default app;
