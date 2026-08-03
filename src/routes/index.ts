import { Router } from 'express';
import storeRoutes from '../modules/store/routes/store.routes';
import emailRoutes from './email.routes';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

router.use('/store', storeRoutes);
router.use('/email', emailRoutes);

export default router;
