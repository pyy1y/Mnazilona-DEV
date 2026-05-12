import api from './api';

export interface LocalizedText {
  en: string;
  ar: string;
}

export interface HighlightItem {
  title: LocalizedText;
  description: LocalizedText;
  icon: string;
  sortOrder?: number;
}

export interface SiteSettings {
  hero: {
    badge: LocalizedText;
    title: LocalizedText;
    description: LocalizedText;
    imageUrl: string;
    appStoreUrl: string;
    googlePlayUrl: string;
    ctaText: LocalizedText;
  };
  about: {
    label: LocalizedText;
    title: LocalizedText;
    description: LocalizedText;
    imageUrl?: string;
  };
  highlights: {
    label: LocalizedText;
    title: LocalizedText;
    description: LocalizedText;
    items: HighlightItem[];
  };
  download: {
    label: LocalizedText;
    title: LocalizedText;
    description: LocalizedText;
    appStoreUrl: string;
    googlePlayUrl: string;
  };
  contact: {
    title: LocalizedText;
    description: LocalizedText;
    email: string;
    phone: string;
    location: LocalizedText;
  };
  footer?: {
    copyright: LocalizedText;
  };
}

export interface BlogPost {
  _id?: string;
  slug: string;
  title: LocalizedText;
  excerpt: LocalizedText;
  content: LocalizedText;
  coverImageUrl: string;
  status: 'draft' | 'published';
  featured?: boolean;
  publishedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegalPage {
  _id?: string;
  type: 'privacy' | 'terms';
  title: LocalizedText;
  content: LocalizedText;
  updatedAt?: string;
}

export interface ContactMessage {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  message: string;
  status: 'new' | 'read' | 'replied' | 'archived';
  adminNote?: string;
  createdAt: string;
}

export const getCmsSettings = () => api.get<SiteSettings>('/website/settings');
export const updateCmsSettings = (settings: Partial<SiteSettings>) =>
  api.put<{ message: string; settings: SiteSettings }>('/website/settings', settings);

export const getCmsBlogs = () => api.get<{ posts: BlogPost[] }>('/website/blogs');
export const createCmsBlog = (post: BlogPost) =>
  api.post<{ message: string; post: BlogPost }>('/website/blogs', post);
export const updateCmsBlog = (id: string, post: Partial<BlogPost>) =>
  api.put<{ message: string; post: BlogPost }>(`/website/blogs/${id}`, post);
export const deleteCmsBlog = (id: string) => api.delete(`/website/blogs/${id}`);

export const getCmsLegalPages = () => api.get<{ pages: LegalPage[] }>('/website/legal');
export const updateCmsLegalPage = (type: 'privacy' | 'terms', page: Partial<LegalPage>) =>
  api.put<{ message: string; page: LegalPage }>(`/website/legal/${type}`, page);

export const getCmsMessages = () => api.get<{ messages: ContactMessage[] }>('/website/messages');
export const updateCmsMessage = (id: string, data: Pick<ContactMessage, 'status'> | { adminNote: string }) =>
  api.put<{ message: string; contactMessage: ContactMessage }>(`/website/messages/${id}`, data);
