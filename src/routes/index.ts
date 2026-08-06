import { Router } from 'express';
import storeRoutes from '../modules/store/routes/store.routes';
import emailRoutes from './email.routes';
import checklistRoutes from '../modules/checklist/routes/checklist.routes';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

router.use('/store', storeRoutes);
router.use('/email', emailRoutes);
router.use('/checklist', authenticateJWT, checklistRoutes);

export default router;
