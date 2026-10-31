const express = require('express');
const slideController = require('../controllers/slideController');
const { requirePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/slides', requirePermission('slides.view'), slideController.listSlides);
// Before /slides/:slideId, which would otherwise take "uploads" and "delete" as an id.
router.get('/slides/uploads', requirePermission('slides.upload', 'slides.delete'), slideController.listUploadedSlides);
router.post('/slides/delete', requirePermission('slides.delete'), slideController.deleteSlides);
router.get('/browse', requirePermission('slides.view', 'cases.view'), slideController.getBrowseTree);
router.get('/slides/:slideId', requirePermission('slides.view'), slideController.getSlide);
router.get('/slides/:slideId/status', requirePermission('slides.view', 'slides.upload'), slideController.getSlideStatus);
router.patch('/slides/:slideId', requirePermission('cases.update'), slideController.updateSlide);
router.delete('/slides/:slideId', requirePermission('slides.delete'), slideController.deleteSlide);
router.post('/slides/:slideId/retry', requirePermission('slides.upload'), slideController.recheckSlide);
router.get('/uploads', requirePermission('slides.upload'), slideController.listUploadSessions);
router.post('/uploads', requirePermission('slides.upload'), slideController.createUploadSession);
router.get('/uploads/:uploadId', requirePermission('slides.upload'), slideController.getUploadSession);
router.patch('/uploads/:uploadId', requirePermission('slides.upload'), slideController.uploadChunk);
router.delete('/uploads/:uploadId', requirePermission('slides.upload'), slideController.cancelUploadSession);
router.get('/slides/:slideId/annotations', requirePermission('slides.view'), slideController.getSlideAnnotations);
router.put('/slides/:slideId/annotations', requirePermission('annotations.edit'), slideController.saveSlideAnnotations);

module.exports = router;
