import axios from 'axios';
import Cookies from 'js-cookie';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const ADMIN_API_BASE = `${API_BASE}/admin`;
const AUTH_API_BASE = `${API_BASE}/auth`;

// NOTE: When you get a domain, update NEXT_PUBLIC_API_URL to use HTTPS:
// NEXT_PUBLIC_API_URL=https://your-domain.com

const api = axios.create({
  baseURL: ADMIN_API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

const adminApiUrl = (path: string) => `${ADMIN_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

export interface BlogPost {
  id: string;
  title: string;
  titleAr: string;
  slug: string;
  description: string;
  descriptionAr: string;
  content: string;
  contentAr: string;
  date: string;
}

const mockPosts: BlogPost[] = [
  {
    id: '1',
    title: 'Designing a calmer smart home experience',
    titleAr: 'تصميم تجربة منزل ذكي أكثر هدوءاً',
    slug: 'calmer-smart-home-experience',
    description: 'How Alma keeps connected-home controls focused, fast, and easy to trust.',
    descriptionAr: 'كيف يجعل ألما التحكم بالمنزل المتصل أكثر تركيزاً وسرعة وسهولة في الثقة.',
    date: '2026-04-24',
    content:
      'Smart home products work best when they stay out of the way. Alma is designed around clear device states, fast room navigation, and secure control paths that make everyday interactions feel dependable.',
    contentAr:
      'تعمل منتجات المنزل الذكي بأفضل شكل عندما تبقى بسيطة وغير مزعجة. صمم ألما حول حالات أجهزة واضحة وتنقل سريع بين الغرف ومسارات تحكم آمنة تجعل التفاعل اليومي أكثر اعتماداً.',
  },
  {
    id: '2',
    title: 'What matters in smart building notifications',
    titleAr: 'ما الذي يهم في تنبيهات المباني الذكية',
    slug: 'smart-building-notifications',
    description: 'A practical look at alerts that are timely, useful, and never noisy.',
    descriptionAr: 'نظرة عملية على التنبيهات التي تصل في الوقت المناسب وتبقى مفيدة دون إزعاج.',
    date: '2026-04-18',
    content:
      'Notifications should help people act with confidence. Future Alma updates will focus on priority signals, room context, and alert history so users can understand what changed and why it matters.',
    contentAr:
      'ينبغي أن تساعد التنبيهات المستخدمين على التصرف بثقة. ستركز تحديثات ألما القادمة على الإشارات المهمة وسياق الغرف وسجل التنبيهات حتى يفهم المستخدم ما تغير ولماذا يهم.',
  },
  {
    id: '3',
    title: 'Preparing connected devices for better onboarding',
    titleAr: 'تهيئة الأجهزة المتصلة لتجربة بدء أفضل',
    slug: 'connected-device-onboarding',
    description: 'Pairing flows should be guided, recoverable, and friendly to real homes.',
    descriptionAr: 'ينبغي أن تكون تجربة الاقتران موجهة وسهلة الاستعادة ومناسبة للمنازل الواقعية.',
    date: '2026-04-10',
    content:
      'Device onboarding is one of the most important moments in a smart home product. Alma aims to make pairing clearer by presenting simple steps, helpful feedback, and room organization from the start.',
    contentAr:
      'تعد تهيئة الأجهزة من أهم اللحظات في أي منتج منزل ذكي. يهدف ألما إلى جعل الاقتران أوضح عبر خطوات بسيطة وملاحظات مفيدة وتنظيم الغرف منذ البداية.',
  },
];

export async function getPosts() {
  return mockPosts;
}

export async function getPostBySlug(slug: string) {
  return mockPosts.find((post) => post.slug === slug) ?? null;
}

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = Cookies.get('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 globally - attempt refresh before redirecting to login
let isRefreshing = false;
let failedQueue: { resolve: (token: string) => void; reject: (err: unknown) => void }[] = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((prom) => {
    if (token) prom.resolve(token);
    else prom.reject(error);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't retry refresh-token requests
      if (originalRequest.url?.includes('/login')) {
        return Promise.reject(error);
      }

      const refreshToken = Cookies.get('admin_refresh_token');
      if (!refreshToken) {
        Cookies.remove('admin_token');
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/admin/login')) {
          window.location.href = '/admin/login';
        }
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(`${AUTH_API_BASE}/refresh-token`, { refreshToken });
        Cookies.set('admin_token', data.token, { sameSite: 'strict', secure: typeof window !== 'undefined' && window.location.protocol === 'https:', path: '/' });
        Cookies.set('admin_refresh_token', data.refreshToken, { sameSite: 'strict', secure: typeof window !== 'undefined' && window.location.protocol === 'https:', path: '/', expires: 7 });
        processQueue(null, data.token);
        originalRequest.headers.Authorization = `Bearer ${data.token}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        Cookies.remove('admin_token');
        Cookies.remove('admin_refresh_token');
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/admin/login')) {
          window.location.href = '/admin/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// Auth (2-step OTP login)
export const adminLoginSendCode = (email: string, password: string) =>
  axios.post(adminApiUrl('/login/send-code'), { email, password }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

export const adminLoginVerifyCode = (email: string, code: string) =>
  axios.post(adminApiUrl('/login/verify-code'), { email, code }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

// Dashboard
export const getDashboard = () => api.get('/dashboard');

// Users
export const getUsers = (params?: Record<string, string | number>) =>
  api.get('/users', { params });
export const getUser = (userId: string) => api.get(`/users/${userId}`);
export const deactivateUser = (userId: string) => api.post(`/users/${userId}/deactivate`);
export const activateUser = (userId: string) => api.post(`/users/${userId}/activate`);
export const forceLogoutUser = (userId: string) => api.post(`/users/${userId}/force-logout`);
export const deleteUser = (userId: string) => api.delete(`/users/${userId}`);

// Allowed Devices (Whitelist)
export const getAllowedDevices = (params?: Record<string, string | number>) =>
  api.get('/allowed-devices', { params });
export const registerDevice = (data: Record<string, string>) =>
  api.post('/devices/register', data);
export const registerBatch = (devices: Record<string, string>[]) =>
  api.post('/devices/register-batch', { devices });
export const banDevice = (serialNumber: string, reason?: string) =>
  api.post('/devices/ban', { serialNumber, reason });
export const unbanDevice = (serialNumber: string) =>
  api.post('/devices/unban', { serialNumber });

// Paired Devices
export const getPairedDevices = (params?: Record<string, string | number>) =>
  api.get('/devices', { params });
export const getDevice = (serialNumber: string) => api.get(`/devices/${serialNumber}`);
export const sendDeviceCommand = (serialNumber: string, command: string, params?: Record<string, unknown>) =>
  api.post(`/devices/${serialNumber}/command`, { command, params });
export const unpairDevice = (serialNumber: string) => api.post(`/devices/${serialNumber}/unpair`);
export const transferDevice = (serialNumber: string, newOwnerId: string) =>
  api.post(`/devices/${serialNumber}/transfer`, { newOwnerId });
export const factoryResetDevice = (serialNumber: string) =>
  api.post(`/devices/${serialNumber}/factory-reset`);

// Logs
export const getLogs = (params?: Record<string, string | number>) =>
  api.get('/logs', { params });
export const getAuditLogs = (params?: Record<string, string | number>) =>
  api.get('/audit-logs', { params });

// Security
export const getSecurityOverview = () => api.get('/security');

// Stats
export const getDeviceStats = () => api.get('/stats');

// Rate Limits
export const getRateLimits = (params?: Record<string, string | number>) =>
  api.get('/rate-limits', { params });

// Device Override Controls
export const getDeviceDetail = (serialNumber: string) => api.get(`/devices/${serialNumber}/detail`);
export const lockDevice = (serialNumber: string, reason?: string) =>
  api.post(`/devices/${serialNumber}/lock`, { reason });
export const unlockDevice = (serialNumber: string) => api.post(`/devices/${serialNumber}/unlock`);

// Firmware Management
export const listFirmware = (params?: Record<string, string | number>) =>
  api.get('/firmware', { params });
export const createFirmware = (data: FormData) =>
  api.post('/firmware', data, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
export const updateFirmware = (firmwareId: string, data: FormData) =>
  api.put(`/firmware/${firmwareId}`, data, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
export const deleteFirmware = (firmwareId: string) => api.delete(`/firmware/${firmwareId}`);
export const getFirmwareStats = () => api.get('/firmware/stats');

// OTA Management
export const pushOtaUpdate = (firmwareId: string, serialNumber?: string) =>
  api.post(`/firmware/${firmwareId}/push`, serialNumber ? { serialNumber } : {});
export const getOtaStatus = (params?: Record<string, string | number>) =>
  api.get('/ota/status', { params });
export const clearOtaStatus = (serialNumber: string) =>
  api.post(`/ota/clear/${encodeURIComponent(serialNumber)}`);
export const clearAllOtaStatus = () => api.post('/ota/clear-all');

// IP Blacklist
export const getBlacklist = (params?: Record<string, string | number>) =>
  api.get('/blacklist', { params });
export const blockIP = (data: { ip: string; reason: string; duration?: number }) =>
  api.post('/blacklist', data);
export const unblockIP = (ip: string) => api.post(`/blacklist/${encodeURIComponent(ip)}/unblock`);
export const deleteBlacklistEntry = (id: string) => api.delete(`/blacklist/${id}`);

// Anomaly Detection
export const getAnomalies = (params?: Record<string, string | number>) =>
  api.get('/anomalies', { params });
export const updateAnomalyStatus = (id: string, status: string) =>
  api.patch(`/anomalies/${id}`, { status });

export default api;
