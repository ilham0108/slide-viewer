const express = require('express');
const shareController = require('../controllers/shareController');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/shares', requirePermission('shares.create', 'shares.manage'), shareController.listShares);
router.post('/shares', requirePermission('shares.create'), shareController.createShare);
router.delete('/shares/:shareId', requirePermission('shares.create', 'shares.manage'), shareController.revokeShare);

module.exports = router;
