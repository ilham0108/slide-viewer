const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/auth/login', authController.login);
router.post('/auth/logout', requireAuth, authController.logout);
router.get('/auth/me', requireAuth, authController.me);
router.put('/auth/password', requireAuth, authController.changePassword);
router.get('/permissions', requireAuth, authController.listPermissions);

module.exports = router;
