const express = require('express');
const publicShareController = require('../controllers/publicShareController');

// No login: access is decided by the share token (and its password, when set).
const router = express.Router();

router.get('/public/shares/:token', publicShareController.validateToken, publicShareController.getShare);
router.post('/public/shares/:token/unlock', publicShareController.validateToken, publicShareController.unlockShare);
router.get('/public/shares/:token/slides/:slideId/annotations', publicShareController.validateToken, publicShareController.getAnnotations);
router.put('/public/shares/:token/slides/:slideId/annotations', publicShareController.validateToken, publicShareController.saveAnnotations);

module.exports = router;
