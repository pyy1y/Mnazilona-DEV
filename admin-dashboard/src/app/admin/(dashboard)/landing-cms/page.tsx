'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  Edit3,
  FileText,
  Home,
  Info,
  Loader2,
  Mail,
  MessageSquare,
  Newspaper,
  Plus,
  Save,
  Scale,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { getErrorMessage } from '@/lib/types';
import {
  BlogPost,
  ContactMessage,
  HighlightItem,
  LegalPage,
  LocalizedText,
  SiteSettings,
  createCmsBlog,
  deleteCmsBlog,
  getCmsBlogs,
  getCmsLegalPages,
  getCmsMessages,
  getCmsSettings,
  updateCmsBlog,
  updateCmsLegalPage,
  updateCmsMessage,
  updateCmsSettings,
} from '@/lib/landingCmsApi';

type TabKey = 'hero' | 'about' | 'highlights' | 'download' | 'contact' | 'blogs' | 'legal' | 'messages';

const emptyText: LocalizedText = { en: '', ar: '' };

const cloneText = (value?: Partial<LocalizedText>): LocalizedText => ({
  en: value?.en || '',
  ar: value?.ar || '',
});

const defaultSettings: SiteSettings = {
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
    description: { en: '', ar: '' },
    imageUrl: '',
  },
  highlights: {
    label: { en: 'Highlights', ar: 'المزايا' },
    title: { en: 'Everything you need at a glance', ar: 'كل ما تحتاجه بلمحة واحدة' },
    description: { en: '', ar: '' },
    items: [],
  },
  download: {
    label: { en: 'Download', ar: 'تحميل' },
    title: { en: 'Get Alma on your phone', ar: 'احصل على ألما على هاتفك' },
    description: { en: '', ar: '' },
    appStoreUrl: '',
    googlePlayUrl: '',
  },
  contact: {
    title: { en: 'Contact Us', ar: 'تواصل معنا' },
    description: { en: '', ar: '' },
    email: '',
    phone: '',
    location: { en: '', ar: '' },
  },
  footer: {
    copyright: { en: '© 2026 Alma. All rights reserved.', ar: '© 2026 ألما. جميع الحقوق محفوظة.' },
  },
};

const defaultBlog: BlogPost = {
  slug: '',
  title: { ...emptyText },
  excerpt: { ...emptyText },
  content: { ...emptyText },
  coverImageUrl: '',
  status: 'draft',
  featured: false,
};

const defaultLegalPages: Record<'privacy' | 'terms', LegalPage> = {
  privacy: {
    type: 'privacy',
    title: { en: 'Privacy Policy', ar: 'سياسة الخصوصية' },
    content: { ...emptyText },
  },
  terms: {
    type: 'terms',
    title: { en: 'Terms of Use', ar: 'شروط الاستخدام' },
    content: { ...emptyText },
  },
};

const tabs: { key: TabKey; label: string; icon: typeof Home }[] = [
  { key: 'hero', label: 'Hero Section', icon: Home },
  { key: 'about', label: 'About Section', icon: Info },
  { key: 'highlights', label: 'Highlights', icon: Sparkles },
  { key: 'download', label: 'Download Section', icon: Download },
  { key: 'contact', label: 'Contact Section', icon: Mail },
  { key: 'blogs', label: 'Blogs', icon: Newspaper },
  { key: 'legal', label: 'Legal Pages', icon: Scale },
  { key: 'messages', label: 'Messages', icon: MessageSquare },
];

function mergeSettings(settings?: Partial<SiteSettings>): SiteSettings {
  return {
    hero: {
      ...defaultSettings.hero,
      ...(settings?.hero || {}),
      badge: cloneText(settings?.hero?.badge || defaultSettings.hero.badge),
      title: cloneText(settings?.hero?.title || defaultSettings.hero.title),
      description: cloneText(settings?.hero?.description || defaultSettings.hero.description),
      ctaText: cloneText(settings?.hero?.ctaText || defaultSettings.hero.ctaText),
    },
    about: {
      ...defaultSettings.about,
      ...(settings?.about || {}),
      label: cloneText(settings?.about?.label || defaultSettings.about.label),
      title: cloneText(settings?.about?.title || defaultSettings.about.title),
      description: cloneText(settings?.about?.description || defaultSettings.about.description),
    },
    highlights: {
      ...defaultSettings.highlights,
      ...(settings?.highlights || {}),
      label: cloneText(settings?.highlights?.label || defaultSettings.highlights.label),
      title: cloneText(settings?.highlights?.title || defaultSettings.highlights.title),
      description: cloneText(settings?.highlights?.description || defaultSettings.highlights.description),
      items: (settings?.highlights?.items || []).map((item, index) => ({
        title: cloneText(item.title),
        description: cloneText(item.description),
        icon: item.icon || '',
        sortOrder: item.sortOrder ?? index + 1,
      })),
    },
    download: {
      ...defaultSettings.download,
      ...(settings?.download || {}),
      label: cloneText(settings?.download?.label || defaultSettings.download.label),
      title: cloneText(settings?.download?.title || defaultSettings.download.title),
      description: cloneText(settings?.download?.description || defaultSettings.download.description),
    },
    contact: {
      ...defaultSettings.contact,
      ...(settings?.contact || {}),
      title: cloneText(settings?.contact?.title || defaultSettings.contact.title),
      description: cloneText(settings?.contact?.description || defaultSettings.contact.description),
      location: cloneText(settings?.contact?.location || defaultSettings.contact.location),
    },
    footer: {
      copyright: cloneText(settings?.footer?.copyright || defaultSettings.footer?.copyright),
    },
  };
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  dir,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        dir={dir}
        className="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 4,
  dir,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        dir={dir}
        className="mt-1 w-full resize-y rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
    </label>
  );
}

function LocalizedInput({
  label,
  value,
  onChange,
  multiline = false,
  rows,
}: {
  label: string;
  value: LocalizedText;
  onChange: (value: LocalizedText) => void;
  multiline?: boolean;
  rows?: number;
}) {
  const Field = multiline ? TextArea : TextInput;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field
        label={`${label} EN`}
        value={value.en}
        onChange={(en) => onChange({ ...value, en })}
        rows={rows}
        dir="ltr"
      />
      <Field
        label={`${label} AR`}
        value={value.ar}
        onChange={(ar) => onChange({ ...value, ar })}
        rows={rows}
        dir="rtl"
      />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function SaveButton({ loading, children = 'Save Changes' }: { loading: boolean; children?: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
      {children}
    </button>
  );
}

export default function LandingCmsPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('hero');
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [blogs, setBlogs] = useState<BlogPost[]>([]);
  const [blogDraft, setBlogDraft] = useState<BlogPost>(defaultBlog);
  const [editingBlogId, setEditingBlogId] = useState<string | null>(null);
  const [legalPages, setLegalPages] = useState<Record<'privacy' | 'terms', LegalPage>>(defaultLegalPages);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteBlogId, setDeleteBlogId] = useState<string | null>(null);

  const sortedHighlights = useMemo(
    () => [...settings.highlights.items].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [settings.highlights.items]
  );

  const loadCms = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, blogsRes, legalRes, messagesRes] = await Promise.all([
        getCmsSettings(),
        getCmsBlogs(),
        getCmsLegalPages(),
        getCmsMessages(),
      ]);

      setSettings(mergeSettings(settingsRes.data));
      setBlogs(blogsRes.data.posts || []);
      const nextLegal = { ...defaultLegalPages };
      for (const page of legalRes.data.pages || []) {
        if (page.type === 'privacy' || page.type === 'terms') {
          nextLegal[page.type] = {
            ...nextLegal[page.type],
            ...page,
            title: cloneText(page.title),
            content: cloneText(page.content),
          };
        }
      }
      setLegalPages(nextLegal);
      setMessages(messagesRes.data.messages || []);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load landing CMS'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadCms();
  }, [loadCms]);

  const saveSettingsSection = async (section: keyof SiteSettings) => {
    setSaving(true);
    try {
      await updateCmsSettings({ [section]: settings[section] });
      toast.success('Settings saved');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const updateSettingsSection = <K extends keyof SiteSettings>(section: K, value: SiteSettings[K]) => {
    setSettings((prev) => ({ ...prev, [section]: value }));
  };

  const updateHighlight = (index: number, value: HighlightItem) => {
    const next = [...settings.highlights.items];
    next[index] = value;
    updateSettingsSection('highlights', { ...settings.highlights, items: next });
  };

  const addHighlight = () => {
    updateSettingsSection('highlights', {
      ...settings.highlights,
      items: [
        ...settings.highlights.items,
        {
          title: { ...emptyText },
          description: { ...emptyText },
          icon: 'Home',
          sortOrder: settings.highlights.items.length + 1,
        },
      ],
    });
  };

  const deleteHighlight = (index: number) => {
    updateSettingsSection('highlights', {
      ...settings.highlights,
      items: settings.highlights.items.filter((_, i) => i !== index),
    });
  };

  const resetBlogForm = () => {
    setBlogDraft(defaultBlog);
    setEditingBlogId(null);
  };

  const saveBlog = async () => {
    setSaving(true);
    try {
      if (editingBlogId) {
        const res = await updateCmsBlog(editingBlogId, blogDraft);
        setBlogs((prev) => prev.map((post) => (post._id === editingBlogId ? res.data.post : post)));
        toast.success('Blog post updated');
      } else {
        const res = await createCmsBlog(blogDraft);
        setBlogs((prev) => [res.data.post, ...prev]);
        toast.success('Blog post created');
      }
      resetBlogForm();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save blog post'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteBlog = async () => {
    if (!deleteBlogId) return;
    setSaving(true);
    try {
      await deleteCmsBlog(deleteBlogId);
      setBlogs((prev) => prev.filter((post) => post._id !== deleteBlogId));
      toast.success('Blog post deleted');
      setDeleteBlogId(null);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete blog post'));
    } finally {
      setSaving(false);
    }
  };

  const saveLegalPage = async (type: 'privacy' | 'terms') => {
    setSaving(true);
    try {
      const res = await updateCmsLegalPage(type, legalPages[type]);
      setLegalPages((prev) => ({ ...prev, [type]: res.data.page }));
      toast.success(`${type === 'privacy' ? 'Privacy Policy' : 'Terms of Use'} saved`);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save legal page'));
    } finally {
      setSaving(false);
    }
  };

  const updateMessageStatus = async (id: string, status: ContactMessage['status']) => {
    try {
      const res = await updateCmsMessage(id, { status });
      setMessages((prev) => prev.map((message) => (message._id === id ? res.data.contactMessage : message)));
      toast.success('Message updated');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update message'));
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Landing Page CMS</h1>
          <p className="mt-1 text-gray-500">Manage public Alma landing page content in English and Arabic.</p>
        </div>
        <button
          onClick={loadCms}
          className="self-start rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={16} />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'hero' && (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); saveSettingsSection('hero'); }}>
          <SectionCard title="Hero Section">
            <LocalizedInput label="Badge" value={settings.hero.badge} onChange={(badge) => updateSettingsSection('hero', { ...settings.hero, badge })} />
            <LocalizedInput label="Title" value={settings.hero.title} onChange={(title) => updateSettingsSection('hero', { ...settings.hero, title })} />
            <LocalizedInput label="Description" multiline rows={4} value={settings.hero.description} onChange={(description) => updateSettingsSection('hero', { ...settings.hero, description })} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextInput label="App Store URL" value={settings.hero.appStoreUrl} onChange={(appStoreUrl) => updateSettingsSection('hero', { ...settings.hero, appStoreUrl })} />
              <TextInput label="Google Play URL" value={settings.hero.googlePlayUrl} onChange={(googlePlayUrl) => updateSettingsSection('hero', { ...settings.hero, googlePlayUrl })} />
            </div>
            <LocalizedInput label="CTA Text" value={settings.hero.ctaText} onChange={(ctaText) => updateSettingsSection('hero', { ...settings.hero, ctaText })} />
            <TextInput label="Hero Image URL" value={settings.hero.imageUrl} onChange={(imageUrl) => updateSettingsSection('hero', { ...settings.hero, imageUrl })} />
            <SaveButton loading={saving} />
          </SectionCard>
        </form>
      )}

      {activeTab === 'about' && (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); saveSettingsSection('about'); }}>
          <SectionCard title="About Section">
            <LocalizedInput label="Label" value={settings.about.label} onChange={(label) => updateSettingsSection('about', { ...settings.about, label })} />
            <LocalizedInput label="Title" value={settings.about.title} onChange={(title) => updateSettingsSection('about', { ...settings.about, title })} />
            <LocalizedInput label="Description" multiline rows={5} value={settings.about.description} onChange={(description) => updateSettingsSection('about', { ...settings.about, description })} />
            <TextInput label="Image URL" value={settings.about.imageUrl || ''} onChange={(imageUrl) => updateSettingsSection('about', { ...settings.about, imageUrl })} />
            <SaveButton loading={saving} />
          </SectionCard>
        </form>
      )}

      {activeTab === 'highlights' && (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); saveSettingsSection('highlights'); }}>
          <SectionCard title="Highlights Section">
            <LocalizedInput label="Label" value={settings.highlights.label} onChange={(label) => updateSettingsSection('highlights', { ...settings.highlights, label })} />
            <LocalizedInput label="Title" value={settings.highlights.title} onChange={(title) => updateSettingsSection('highlights', { ...settings.highlights, title })} />
            <LocalizedInput label="Description" multiline rows={3} value={settings.highlights.description} onChange={(description) => updateSettingsSection('highlights', { ...settings.highlights, description })} />
            <div className="flex items-center justify-between border-t border-gray-100 pt-5">
              <h3 className="font-semibold text-gray-900">Highlight Cards</h3>
              <button type="button" onClick={addHighlight} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-800">
                <Plus size={16} /> Add Card
              </button>
            </div>
            <div className="space-y-4">
              {sortedHighlights.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">No highlight cards yet.</div>
              ) : (
                sortedHighlights.map((item) => {
                  const sourceIndex = settings.highlights.items.indexOf(item);
                  return (
                    <div key={sourceIndex} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-gray-700">Card {sourceIndex + 1}</p>
                        <button type="button" onClick={() => deleteHighlight(sourceIndex)} className="rounded-lg p-2 text-gray-500 transition hover:bg-red-50 hover:text-red-600" title="Delete card">
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <LocalizedInput label="Title" value={item.title} onChange={(title) => updateHighlight(sourceIndex, { ...item, title })} />
                        <LocalizedInput label="Description" multiline rows={3} value={item.description} onChange={(description) => updateHighlight(sourceIndex, { ...item, description })} />
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <TextInput label="Icon Name" value={item.icon} onChange={(icon) => updateHighlight(sourceIndex, { ...item, icon })} />
                          <TextInput label="Sort Order" value={String(item.sortOrder || '')} onChange={(sortOrder) => updateHighlight(sourceIndex, { ...item, sortOrder: Number(sortOrder) || 0 })} />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <SaveButton loading={saving} />
          </SectionCard>
        </form>
      )}

      {activeTab === 'download' && (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); saveSettingsSection('download'); }}>
          <SectionCard title="Download Section">
            <LocalizedInput label="Label" value={settings.download.label} onChange={(label) => updateSettingsSection('download', { ...settings.download, label })} />
            <LocalizedInput label="Title" value={settings.download.title} onChange={(title) => updateSettingsSection('download', { ...settings.download, title })} />
            <LocalizedInput label="Description" multiline rows={4} value={settings.download.description} onChange={(description) => updateSettingsSection('download', { ...settings.download, description })} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextInput label="App Store URL" value={settings.download.appStoreUrl} onChange={(appStoreUrl) => updateSettingsSection('download', { ...settings.download, appStoreUrl })} />
              <TextInput label="Google Play URL" value={settings.download.googlePlayUrl} onChange={(googlePlayUrl) => updateSettingsSection('download', { ...settings.download, googlePlayUrl })} />
            </div>
            <SaveButton loading={saving} />
          </SectionCard>
        </form>
      )}

      {activeTab === 'contact' && (
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); saveSettingsSection('contact'); }}>
          <SectionCard title="Contact Section">
            <LocalizedInput label="Title" value={settings.contact.title} onChange={(title) => updateSettingsSection('contact', { ...settings.contact, title })} />
            <LocalizedInput label="Description" multiline rows={4} value={settings.contact.description} onChange={(description) => updateSettingsSection('contact', { ...settings.contact, description })} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <TextInput label="Email" value={settings.contact.email} onChange={(email) => updateSettingsSection('contact', { ...settings.contact, email })} />
              <TextInput label="Phone" value={settings.contact.phone} onChange={(phone) => updateSettingsSection('contact', { ...settings.contact, phone })} />
            </div>
            <LocalizedInput label="Location" value={settings.contact.location} onChange={(location) => updateSettingsSection('contact', { ...settings.contact, location })} />
            <SaveButton loading={saving} />
          </SectionCard>
        </form>
      )}

      {activeTab === 'blogs' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <SectionCard title="Blog Posts">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase text-gray-500">
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Slug</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Published</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {blogs.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No blog posts yet.</td></tr>
                  ) : (
                    blogs.map((post) => (
                      <tr key={post._id || post.slug} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{post.title?.en || '-'}</p>
                          <p className="text-xs text-gray-400" dir="rtl">{post.title?.ar || '-'}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{post.slug}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${post.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {post.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{formatDate(post.publishedAt || post.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => { setBlogDraft({ ...defaultBlog, ...post, title: cloneText(post.title), excerpt: cloneText(post.excerpt), content: cloneText(post.content) }); setEditingBlogId(post._id || null); }}
                              className="rounded-lg p-2 text-blue-600 transition hover:bg-blue-50"
                              title="Edit"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => post._id && setDeleteBlogId(post._id)}
                              className="rounded-lg p-2 text-red-600 transition hover:bg-red-50"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); saveBlog(); }}>
            <SectionCard title={editingBlogId ? 'Edit Blog Post' : 'Create Blog Post'}>
              <LocalizedInput label="Title" value={blogDraft.title} onChange={(title) => setBlogDraft((prev) => ({ ...prev, title }))} />
              <TextInput label="Slug" value={blogDraft.slug} onChange={(slug) => setBlogDraft((prev) => ({ ...prev, slug }))} />
              <LocalizedInput label="Excerpt" multiline rows={3} value={blogDraft.excerpt} onChange={(excerpt) => setBlogDraft((prev) => ({ ...prev, excerpt }))} />
              <LocalizedInput label="Content" multiline rows={8} value={blogDraft.content} onChange={(content) => setBlogDraft((prev) => ({ ...prev, content }))} />
              <TextInput label="Cover Image URL" value={blogDraft.coverImageUrl} onChange={(coverImageUrl) => setBlogDraft((prev) => ({ ...prev, coverImageUrl }))} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3.5 py-3 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={blogDraft.status === 'published'}
                    onChange={(e) => setBlogDraft((prev) => ({ ...prev, status: e.target.checked ? 'published' : 'draft' }))}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  Published
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3.5 py-3 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(blogDraft.featured)}
                    onChange={(e) => setBlogDraft((prev) => ({ ...prev, featured: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  Featured
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <SaveButton loading={saving}>{editingBlogId ? 'Update Blog' : 'Create Blog'}</SaveButton>
                {editingBlogId && (
                  <button type="button" onClick={resetBlogForm} className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200">
                    <X size={16} /> Cancel
                  </button>
                )}
              </div>
            </SectionCard>
          </form>
        </div>
      )}

      {activeTab === 'legal' && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {(['privacy', 'terms'] as const).map((type) => (
            <form key={type} onSubmit={(e) => { e.preventDefault(); saveLegalPage(type); }}>
              <SectionCard title={type === 'privacy' ? 'Privacy Policy' : 'Terms of Use'}>
                <LocalizedInput label="Title" value={legalPages[type].title} onChange={(title) => setLegalPages((prev) => ({ ...prev, [type]: { ...prev[type], title } }))} />
                <LocalizedInput label="Content" multiline rows={14} value={legalPages[type].content} onChange={(content) => setLegalPages((prev) => ({ ...prev, [type]: { ...prev[type], content } }))} />
                <SaveButton loading={saving}>Save {type === 'privacy' ? 'Privacy' : 'Terms'}</SaveButton>
              </SectionCard>
            </form>
          ))}
        </div>
      )}

      {activeTab === 'messages' && (
        <SectionCard title="Contact Messages">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Created At</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {messages.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No contact messages yet.</td></tr>
                ) : (
                  messages.map((message) => (
                    <tr key={message._id} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{message.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{message.email}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{message.phone || '-'}</td>
                      <td className="max-w-sm px-4 py-3 text-sm text-gray-600">{message.message}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(message.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          message.status === 'new'
                            ? 'bg-blue-100 text-blue-700'
                            : message.status === 'replied'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}>
                          {message.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => updateMessageStatus(message._id, 'read')} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200">
                            Mark read
                          </button>
                          <button type="button" onClick={() => updateMessageStatus(message._id, 'replied')} className="rounded-lg bg-green-100 px-3 py-1.5 text-xs font-medium text-green-700 transition hover:bg-green-200">
                            Mark resolved
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <ConfirmDialog
        open={Boolean(deleteBlogId)}
        title="Delete Blog Post"
        message="This will permanently delete the selected blog post."
        confirmLabel="Delete"
        variant="danger"
        loading={saving}
        onConfirm={confirmDeleteBlog}
        onCancel={() => setDeleteBlogId(null)}
      />
    </div>
  );
}
