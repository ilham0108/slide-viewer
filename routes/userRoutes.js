const express = require('express');
const userController = require('../controllers/userController');
const roleController = require('../controllers/roleController');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/users', requirePermission('users.manage'), userController.listUsers);
router.post('/users', requirePermission('users.manage'), userController.createUser);
router.put('/users/:userId', requirePermission('users.manage'), userController.updateUser);
router.delete('/users/:userId', requirePermission('users.manage'), userController.deleteUser);

// The user form needs the role list, so user managers may read roles too.
router.get('/roles', requirePermission('roles.manage', 'users.manage'), roleController.listRoles);
router.post('/roles', requirePermission('roles.manage'), roleController.createRole);
router.put('/roles/:roleId', requirePermission('roles.manage'), roleController.updateRole);
router.delete('/roles/:roleId', requirePermission('roles.manage'), roleController.deleteRole);

module.exports = router;
