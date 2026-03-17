// utils/validation.ts

import { VALIDATION } from '../constants/api';

// ======================================
// Email Validation
// ======================================
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  return VALIDATION.EMAIL_REGEX.test(normalized);
}

export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

// ======================================
// Password Validation
// ======================================
export function isStrongPassword(password: string): boolean {
  if (!password || typeof password !== 'string') return false;
  return VALIDATION.PASSWORD_REGEX.test(password);
}

export function getPasswordStrengthErrors(password: string, username?: string): string[] {
  const errors: string[] = [];

  if (!password) {
    errors.push('Password is required');
    return errors;
  }

  if (password.length < VALIDATION.PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${VALIDATION.PASSWORD_MIN_LENGTH} characters`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least 1 uppercase letter');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least 1 number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('Password must contain at least 1 special character');
  }

  if (username) {
    const prefix = username.toLowerCase().slice(0, 5);
    if (prefix.length >= 1 && password.toLowerCase().includes(prefix)) {
      errors.push('Password must not contain the first 5 characters of your name');
    }
  }

  return errors;
}

// ======================================
// Name Validation
// ======================================
export function isValidName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length >= VALIDATION.NAME_MIN_LENGTH && 
         trimmed.length <= VALIDATION.NAME_MAX_LENGTH;
}

export function sanitizeName(name: string): string {
  if (!name || typeof name !== 'string') return '';
  return name.trim().replace(/[<>]/g, '').slice(0, VALIDATION.NAME_MAX_LENGTH);
}

// ======================================
// General Sanitization
// ======================================
export function sanitizeInput(input: string, maxLength: number = 500): string {
  if (!input || typeof input !== 'string') return '';
  return input.trim().replace(/[<>]/g, '').slice(0, maxLength);
}

// ======================================
// OTP Validation
// ======================================
export function isValidOTP(code: string, length: number = 6): boolean {
  if (!code || typeof code !== 'string') return false;
  const digits = code.replace(/\D/g, '');
  return digits.length === length;
}

export function sanitizeOTP(code: string, length: number = 6): string {
  if (!code || typeof code !== 'string') return '';
  return code.replace(/\D/g, '').slice(0, length);
}