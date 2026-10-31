const express = require('express');
const upload = require('../config/upload');
const caseController = require('../controllers/caseController');
const categoryController = require('../controllers/categoryController');
const slideController = require('../controllers/slideController');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

// Every signed-in user may read categories: they label cases and fill filter dropdowns.
router.get('/categories', categoryController.listCategories);
router.post('/categories', requirePermission('categories.manage'), categoryController.createCategory);
router.put('/categories/:categoryId', requirePermission('categories.manage'), categoryController.updateCategory);
router.delete('/categories/:categoryId', requirePermission('categories.manage'), categoryController.deleteCategory);

router.get('/cases', requirePermission('cases.view'), caseController.listCases);
router.post('/cases', requirePermission('cases.create'), caseController.createCase);
router.get('/cases/:caseId', requirePermission('cases.view'), caseController.getCase);
router.put('/cases/:caseId', requirePermission('cases.update'), caseController.updateCase);
router.delete('/cases/:caseId', requirePermission('cases.delete'), caseController.deleteCase);
router.post(
    '/cases/:caseId/slides',
    requirePermission('slides.upload'),
    caseController.ensureCaseExists,
    upload.single('slide'),
    slideController.uploadSlide
);
// Resumable upload in chunks (used by the web app); the chunks go to /uploads/:uploadId.
router.post(
    '/cases/:caseId/uploads',
    requirePermission('slides.upload'),
    caseController.ensureCaseExists,
    slideController.createUploadSession
);

module.exports = router;
