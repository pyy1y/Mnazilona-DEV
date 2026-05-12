const express = require('express');
const Joi = require('joi');
const websiteController = require('../controllers/websiteController');
const { validate } = require('../middleware/validate');

const router = express.Router();

const localizedSchema = Joi.object({
  en: Joi.string().allow('').max(10000).optional(),
  ar: Joi.string().allow('').max(10000).optional(),
});

const settingsSchema = Joi.object({
  hero: Joi.object().unknown(true).optional(),
  about: Joi.object().unknown(true).optional(),
  highlights: Joi.object().unknown(true).optional(),
  howItWorks: Joi.object().unknown(true).optional(),
  download: Joi.object().unknown(true).optional(),
  contact: Joi.object().unknown(true).optional(),
  footer: Joi.object().unknown(true).optional(),
}).min(1);

const blogSchema = Joi.object({
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160).optional(),
  title: localizedSchema.optional(),
  excerpt: localizedSchema.optional(),
  content: localizedSchema.optional(),
  coverImageUrl: Joi.string().trim().allow('').max(2000).optional(),
  status: Joi.string().valid('draft', 'published').optional(),
  publishedAt: Joi.date().allow(null).optional(),
}).min(1);

const createBlogSchema = blogSchema.keys({
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160).required(),
  title: localizedSchema.required(),
});

const legalPageSchema = Joi.object({
  title: localizedSchema.optional(),
  content: localizedSchema.optional(),
}).min(1);

const messageUpdateSchema = Joi.object({
  status: Joi.string().valid('new', 'read', 'replied', 'archived').optional(),
  adminNote: Joi.string().trim().allow('').max(5000).optional(),
}).min(1);

router.get('/settings', websiteController.getAdminSettings);
router.put('/settings', validate(settingsSchema), websiteController.updateAdminSettings);
router.get('/blogs', websiteController.listAdminBlogs);
router.post('/blogs', validate(createBlogSchema), websiteController.createAdminBlog);
router.put('/blogs/:id', validate(blogSchema), websiteController.updateAdminBlog);
router.delete('/blogs/:id', websiteController.deleteAdminBlog);
router.get('/legal', websiteController.listAdminLegalPages);
router.put('/legal/:type', validate(legalPageSchema), websiteController.updateAdminLegalPage);
router.get('/messages', websiteController.listAdminMessages);
router.put('/messages/:id', validate(messageUpdateSchema), websiteController.updateAdminMessage);

module.exports = router;
