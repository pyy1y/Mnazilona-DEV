const express = require('express');
const Joi = require('joi');
const websiteController = require('../controllers/websiteController');
const { validate } = require('../middleware/validate');

const router = express.Router();

const contactMessageSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  email: Joi.string().trim().email().max(255).required(),
  phone: Joi.string().trim().max(40).allow('', null).optional(),
  message: Joi.string().trim().min(1).max(5000).required(),
});

router.get('/settings', websiteController.getPublicSettings);
router.get('/blogs', websiteController.listPublicBlogs);
router.get('/blogs/:slug', websiteController.getPublicBlogBySlug);
router.get('/legal/:type', websiteController.getPublicLegalPage);
router.post('/contact', validate(contactMessageSchema), websiteController.createContactMessage);

module.exports = router;
