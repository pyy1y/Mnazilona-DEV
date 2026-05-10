const mongoose = require('mongoose');

const localizedStringSchema = new mongoose.Schema(
  {
    en: { type: String, default: '', trim: true },
    ar: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const highlightItemSchema = new mongoose.Schema(
  {
    title: { type: localizedStringSchema, default: () => ({}) },
    description: { type: localizedStringSchema, default: () => ({}) },
    icon: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const stepSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, min: 1 },
    title: { type: localizedStringSchema, default: () => ({}) },
  },
  { _id: false }
);

const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main', unique: true, immutable: true },
    hero: {
      badge: { type: localizedStringSchema, default: () => ({}) },
      title: { type: localizedStringSchema, default: () => ({}) },
      description: { type: localizedStringSchema, default: () => ({}) },
      imageUrl: { type: String, default: '', trim: true },
      appStoreUrl: { type: String, default: '', trim: true },
      googlePlayUrl: { type: String, default: '', trim: true },
      ctaText: { type: localizedStringSchema, default: () => ({}) },
    },
    about: {
      label: { type: localizedStringSchema, default: () => ({}) },
      title: { type: localizedStringSchema, default: () => ({}) },
      description: { type: localizedStringSchema, default: () => ({}) },
    },
    highlights: {
      label: { type: localizedStringSchema, default: () => ({}) },
      title: { type: localizedStringSchema, default: () => ({}) },
      description: { type: localizedStringSchema, default: () => ({}) },
      items: { type: [highlightItemSchema], default: [] },
    },
    howItWorks: {
      label: { type: localizedStringSchema, default: () => ({}) },
      title: { type: localizedStringSchema, default: () => ({}) },
      steps: { type: [stepSchema], default: [] },
    },
    download: {
      label: { type: localizedStringSchema, default: () => ({}) },
      title: { type: localizedStringSchema, default: () => ({}) },
      description: { type: localizedStringSchema, default: () => ({}) },
      appStoreUrl: { type: String, default: '', trim: true },
      googlePlayUrl: { type: String, default: '', trim: true },
    },
    contact: {
      title: { type: localizedStringSchema, default: () => ({}) },
      description: { type: localizedStringSchema, default: () => ({}) },
      email: { type: String, default: '', trim: true },
      phone: { type: String, default: '', trim: true },
      location: { type: localizedStringSchema, default: () => ({}) },
    },
    footer: {
      copyright: { type: localizedStringSchema, default: () => ({}) },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { transform: (doc, ret) => { delete ret.__v; return ret; } },
  }
);

siteSettingsSchema.statics.defaultSettings = function () {
  return {
    hero: {
      badge: { en: 'Smart home platform', ar: 'منصة المنزل الذكي' },
      title: { en: 'Smart living made effortless', ar: 'حياة ذكية بكل سهولة' },
      description: {
        en: 'A modern mobile app for managing connected homes with calm control, fast access, and secure everyday automation.',
        ar: 'تطبيق جوال حديث لإدارة المنازل المتصلة بتحكم هادئ ووصول سريع وأتمتة يومية آمنة.',
      },
      imageUrl: '',
      appStoreUrl: '',
      googlePlayUrl: '',
      ctaText: { en: 'Download Alma', ar: 'تحميل ألما' },
    },
    about: {
      label: { en: 'About', ar: 'من نحن' },
      title: { en: 'Built for calmer connected living', ar: 'مصمم لحياة متصلة أكثر هدوءاً' },
      description: {
        en: 'Alma brings smart home controls, device status, and daily automation into one clear experience.',
        ar: 'يجمع ألما التحكم بالمنزل الذكي وحالة الأجهزة والأتمتة اليومية في تجربة واضحة واحدة.',
      },
    },
    highlights: {
      label: { en: 'Highlights', ar: 'المزايا' },
      title: { en: 'Everything you need at a glance', ar: 'كل ما تحتاجه بلمحة واحدة' },
      description: {
        en: 'Designed for quick access, reliable visibility, and secure device management.',
        ar: 'مصمم للوصول السريع والرؤية الموثوقة وإدارة الأجهزة بأمان.',
      },
      items: [],
    },
    howItWorks: {
      label: { en: 'How it works', ar: 'كيف يعمل' },
      title: { en: 'Connect, manage, and automate', ar: 'اتصل وأدر وأتمت' },
      steps: [],
    },
    download: {
      label: { en: 'Download', ar: 'تحميل' },
      title: { en: 'Get Alma on your phone', ar: 'احصل على ألما على هاتفك' },
      description: {
        en: 'App Store and Google Play links will be available soon.',
        ar: 'ستتوفر روابط App Store و Google Play قريباً.',
      },
      appStoreUrl: '',
      googlePlayUrl: '',
    },
    contact: {
      title: { en: 'Contact Us', ar: 'تواصل معنا' },
      description: {
        en: 'Have a question about Alma? Send us a message.',
        ar: 'هل لديك سؤال حول ألما؟ أرسل لنا رسالة.',
      },
      email: '',
      phone: '',
      location: { en: '', ar: '' },
    },
    footer: {
      copyright: { en: '© 2026 Alma. All rights reserved.', ar: '© 2026 ألما. جميع الحقوق محفوظة.' },
    },
  };
};

siteSettingsSchema.statics.getSingleton = function () {
  return this.findOne({ key: 'main' }).lean();
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
