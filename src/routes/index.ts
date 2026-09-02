import { Router } from 'express';
import storeRoutes from '../modules/store/routes/store.routes';
import emailRoutes from './email.routes';
import checklistRoutes from '../modules/checklist/routes/checklist.routes';
import pettyCashRoutes from '../modules/petty-cash/routes/pettyCash.routes';
import documentRoutes from '../modules/document/routes/document.routes';
import { authenticateJWT } from '../middleware/auth.middleware';
import { getAwsConfigStatus } from '../config';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    // Presence/absence only — never the actual key values — so this is safe
    // to hit from a browser to confirm the deployed process actually picked
    // up the AWS_* env vars, without needing server/SSH access.
    s3: getAwsConfigStatus(),
  });
});

router.use('/store', storeRoutes);
router.use('/email', emailRoutes);
router.use('/checklist', authenticateJWT, checklistRoutes);
router.use('/petty-cash', authenticateJWT, pettyCashRoutes);
router.use('/document', authenticateJWT, documentRoutes);
router.use('/doc-submanager', authenticateJWT, documentRoutes);

// Compatibility aliases for petty cash flat endpoints
router.use('/', authenticateJWT, pettyCashRoutes);

export default router;

