# Mnazilona — Smart Home App

## Password Policy Update

Updated password validation rules across all entry points (register, reset password, change password) in both Frontend and Backend.

### New Requirements
1. At least 8 characters
2. At least 1 uppercase letter
3. At least 1 number
4. At least 1 special character (e.g. `!@#$%^&*`)
5. Must not contain the first 5 characters of the user's name

### Files Updated
**Backend:** `utils/helpers.js`, `controllers/authController.js`

**Frontend:** `constants/api.ts`, `utils/validation.ts`, `app/register.tsx`, `app/change-password.tsx`, `app/(tabs)/account-pages/security.tsx`
