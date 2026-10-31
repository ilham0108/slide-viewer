const express = require('express');
const multer = require('multer');
const settingsController = require('../controllers/settingsController');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// The logo is small, so it is kept in memory and checked before anything is written.
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1 } });

router.get('/public/settings', settingsController.getPublicSettings);
router.put('/settings', requireAuth, requirePermission('settings.manage'), settingsController.updateSettings);
router.post('/settings/logo', requireAuth, requirePermission('settings.manage'), logoUpload.single('logo'), settingsController.uploadLogo);
router.delete('/settings/logo', requireAuth, requirePermission('settings.manage'), settingsController.deleteLogo);

module.exports = router;
