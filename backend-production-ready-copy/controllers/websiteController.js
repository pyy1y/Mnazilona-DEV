const SiteSettings = require('../models/SiteSettings');
const BlogPost = require('../models/BlogPost');
const LegalPage = require('../models/LegalPage');
const ContactMessage = require('../models/ContactMessage');

const parsePagination = (query, defaultLimit = 20, maxLimit = 100) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

const setPublishedAtIfNeeded = (payload, existing = null) => {
  if (payload.status === 'published' && !payload.publishedAt && !existing?.publishedAt) {
    payload.publishedAt = new Date();
  }
  return payload;
};

// ==================== Public CMS ====================

exports.getPublicSettings = async (req, res) => {
  try {
    const settings = await SiteSettings.getSingleton();
    res.json(settings || SiteSettings.defaultSettings());
  } catch (error) {
    console.error('Get website settings error:', error.message);
    res.status(500).json({ message: 'Failed to fetch website settings' });
  }
};

exports.listPublicBlogs = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 12, 50);
    const filter = { status: 'published' };

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .select('slug title excerpt coverImageUrl status publishedAt createdAt')
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BlogPost.countDocuments(filter),
    ]);

    res.json({
      posts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('List public blogs error:', error.message);
    res.status(500).json({ message: 'Failed to fetch blog posts' });
  }
};

exports.getPublicBlogBySlug = async (req, res) => {
  try {
    const post = await BlogPost.findOne({
      slug: req.params.slug,
      status: 'published',
    }).lean();

    if (!post) return res.status(404).json({ message: 'Blog post not found' });
    res.json({ post });
  } catch (error) {
    console.error('Get public blog error:', error.message);
    res.status(500).json({ message: 'Failed to fetch blog post' });
  }
};

exports.getPublicLegalPage = async (req, res) => {
  try {
    const { type } = req.params;
    if (!['privacy', 'terms'].includes(type)) {
      return res.status(400).json({ message: 'Invalid legal page type' });
    }

    const page = await LegalPage.findOne({ type }).lean();
    if (!page) return res.status(404).json({ message: 'Legal page not found' });
    res.json({ page });
  } catch (error) {
    console.error('Get legal page error:', error.message);
    res.status(500).json({ message: 'Failed to fetch legal page' });
  }
};

exports.createContactMessage = async (req, res) => {
  try {
    const message = await ContactMessage.create(req.body);
    res.status(201).json({ message: 'Contact message received', contactMessage: message });
  } catch (error) {
    console.error('Create contact message error:', error.message);
    res.status(500).json({ message: 'Failed to send contact message' });
  }
};

// ==================== Admin CMS ====================

exports.getAdminSettings = async (req, res) => {
  try {
    const settings = await SiteSettings.getSingleton();
    res.json(settings || SiteSettings.defaultSettings());
  } catch (error) {
    console.error('Get admin website settings error:', error.message);
    res.status(500).json({ message: 'Failed to fetch website settings' });
  }
};

exports.updateAdminSettings = async (req, res) => {
  try {
    const settings = await SiteSettings.findOneAndUpdate(
      { key: 'main' },
      { $set: { ...req.body, updatedBy: req.user.id }, $setOnInsert: { key: 'main' } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({ message: 'Website settings updated', settings });
  } catch (error) {
    console.error('Update website settings error:', error.message);
    res.status(500).json({ message: 'Failed to update website settings' });
  }
};

exports.listAdminBlogs = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BlogPost.countDocuments(filter),
    ]);

    res.json({
      posts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('List admin blogs error:', error.message);
    res.status(500).json({ message: 'Failed to fetch blog posts' });
  }
};

exports.createAdminBlog = async (req, res) => {
  try {
    const payload = setPublishedAtIfNeeded({
      ...req.body,
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });

    const post = await BlogPost.create(payload);
    res.status(201).json({ message: 'Blog post created', post });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Blog slug already exists' });
    console.error('Create blog post error:', error.message);
    res.status(500).json({ message: 'Failed to create blog post' });
  }
};

exports.updateAdminBlog = async (req, res) => {
  try {
    const existing = await BlogPost.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Blog post not found' });

    const payload = setPublishedAtIfNeeded({ ...req.body, updatedBy: req.user.id }, existing);
    Object.assign(existing, payload);
    await existing.save();

    res.json({ message: 'Blog post updated', post: existing });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Blog slug already exists' });
    console.error('Update blog post error:', error.message);
    res.status(500).json({ message: 'Failed to update blog post' });
  }
};

exports.deleteAdminBlog = async (req, res) => {
  try {
    const post = await BlogPost.findByIdAndDelete(req.params.id);
    if (!post) return res.status(404).json({ message: 'Blog post not found' });
    res.json({ message: 'Blog post deleted' });
  } catch (error) {
    console.error('Delete blog post error:', error.message);
    res.status(500).json({ message: 'Failed to delete blog post' });
  }
};

exports.listAdminLegalPages = async (req, res) => {
  try {
    const pages = await LegalPage.find().sort({ type: 1 }).lean();
    res.json({ pages });
  } catch (error) {
    console.error('List legal pages error:', error.message);
    res.status(500).json({ message: 'Failed to fetch legal pages' });
  }
};

exports.updateAdminLegalPage = async (req, res) => {
  try {
    const { type } = req.params;
    if (!['privacy', 'terms'].includes(type)) {
      return res.status(400).json({ message: 'Invalid legal page type' });
    }

    const page = await LegalPage.findOneAndUpdate(
      { type },
      { $set: { ...req.body, type, updatedBy: req.user.id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.json({ message: 'Legal page updated', page });
  } catch (error) {
    console.error('Update legal page error:', error.message);
    res.status(500).json({ message: 'Failed to update legal page' });
  }
};

exports.listAdminMessages = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 100);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [messages, total] = await Promise.all([
      ContactMessage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ContactMessage.countDocuments(filter),
    ]);

    res.json({
      messages,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('List contact messages error:', error.message);
    res.status(500).json({ message: 'Failed to fetch contact messages' });
  }
};

exports.updateAdminMessage = async (req, res) => {
  try {
    const message = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!message) return res.status(404).json({ message: 'Contact message not found' });
    res.json({ message: 'Contact message updated', contactMessage: message });
  } catch (error) {
    console.error('Update contact message error:', error.message);
    res.status(500).json({ message: 'Failed to update contact message' });
  }
};
