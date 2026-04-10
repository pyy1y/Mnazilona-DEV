import axios from 'axios';
import Cookies from 'js-cookie';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: `${API_BASE}/admin`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = Cookies.get('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 globally (expired/invalid token only)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      Cookies.remove('admin_token');
      Cookies.remove('admin_data');
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth (2-step OTP login)
export const adminLoginSendCode = (email: string, password: string) =>
  api.post('/login/send-code', { email, password });

export const adminLoginVerifyCode = (email: string, code: string) =>
  api.post('/login/verify-code', { email, code });

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
export const createFirmware = (data: Record<string, unknown>) =>
  api.post('/firmware', data);
export const updateFirmware = (firmwareId: string, data: Record<string, unknown>) =>
  api.put(`/firmware/${firmwareId}`, data);
export const deleteFirmware = (firmwareId: string) => api.delete(`/firmware/${firmwareId}`);
export const getFirmwareStats = () => api.get('/firmware/stats');

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
