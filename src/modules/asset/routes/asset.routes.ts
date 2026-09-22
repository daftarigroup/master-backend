import { Router } from 'express';
import { assetController } from '../controllers/asset.controller';
import { validate } from '../../../middleware/validate.middleware';
import { createAssetSchema, updateAssetSchema } from '../validators/asset.validator';

const router = Router();

router.get('/', assetController.list);
router.get('/:id', assetController.getById);
router.post('/', validate(createAssetSchema), assetController.create);
router.patch('/:id', validate(updateAssetSchema), assetController.update);
router.delete('/:id', assetController.delete);

export default router;
