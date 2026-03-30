import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { api, isAuthError } from '../../../utils/api';
import { useAuth } from '../../../hooks/useAuth';
import { isStrongPassword } from '../../../utils/validation';
import { ENDPOINTS, APP_CONFIG } from '../../../constants/api';
import { getUser } from '../../../utils/userStorage';

const BRAND_COLOR = '#2E5B8E';

export default function SecurityScreen() {
  const router = useRouter();
  const { logout, handleAuthError } = useAuth();

  // Password change state
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const newPasswordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  // Delete account state
  const [isDeleteStep1Visible, setIsDeleteStep1Visible] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState('');

  const [isDeleteStep2Visible, setIsDeleteStep2Visible] = useState(false);
  const [deleteCode, setDeleteCode] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const [resendTimer, setResendTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleGoBack = useCallback(() => {
    router.replace('/(tabs)/account');
  }, [router]);

  // ==================== Password Change ====================
  const openPasswordModal = useCallback(() => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowOldPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setIsPasswordModalVisible(true);
  }, []);

  const closePasswordModal = useCallback(() => {
    setIsPasswordModalVisible(false);
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  const handleChangePassword = useCallback(async () => {
    const oldPw = oldPassword.trim();
    const newPw = newPassword.trim();
    const confirmPw = confirmPassword.trim();

    if (!oldPw || !newPw || !confirmPw) {
      Alert.alert('Error', 'Please fill in all fields.');
      return;
    }

    if (newPw !== confirmPw) {
      Alert.alert('Error', 'New passwords do not match.');
      return;
    }

    if (!isStrongPassword(newPw)) {
      Alert.alert(
        'Weak Password',
        'Password must be at least 8 characters with 1 uppercase letter, 1 number, and 1 special character.'
      );
      return;
    }

    const storedUser = await getUser();
    if (storedUser?.name) {
      const prefix = storedUser.name.toLowerCase().slice(0, 5);
      if (prefix.length >= 1 && newPw.toLowerCase().includes(prefix)) {
        Alert.alert('Weak Password', 'Password must not contain the first 5 characters of your name.');
        return;
      }
    }

    if (oldPw === newPw) {
      Alert.alert('Error', 'New password must be different from current password.');
      return;
    }

    setIsChangingPassword(true);

    try {
      const response = await api.post<any>(
        ENDPOINTS.AUTH.CHANGE_PASSWORD,
        { oldPassword: oldPw, newPassword: newPw },
        { requireAuth: true }
      );

      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        if (response.status === 429) {
          Alert.alert('Too Soon', response.message || 'You can only change your password once every 24 hours.');
          return;
        }
        Alert.alert('Error', response.message || 'Current password is incorrect.');
        return;
      }

      closePasswordModal();
      Alert.alert(
        'Password Changed',
        'Your password has been changed successfully. All devices have been logged out. Please log in again.',
        [{ text: 'OK', onPress: () => logout(false) }]
      );
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsChangingPassword(false);
    }
  }, [oldPassword, newPassword, confirmPassword, closePasswordModal, handleAuthError, logout]);

  // ==================== Delete Account ====================
  const startResendTimer = useCallback(() => {
    setResendTimer(APP_CONFIG.OTP_RESEND_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleDeleteAccountStart = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action is permanent and cannot be undone. All your devices will be unpaired.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => setIsDeleteStep1Visible(true),
        },
      ]
    );
  }, []);

  const handleSendDeleteCode = useCallback(async () => {
    setIsSendingCode(true);

    try {
      const response = await api.post<any>(
        ENDPOINTS.USER.DELETE_SEND_CODE,
        {},
        { requireAuth: true }
      );

      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        Alert.alert('Error', response.message || 'Failed to send verification code.');
        return;
      }

      setMaskedEmail(response.data?.email || 'your email');
      setIsDeleteStep1Visible(false);
      setDeleteCode('');
      setIsDeleteStep2Visible(true);
      startResendTimer();
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsSendingCode(false);
    }
  }, [handleAuthError, startResendTimer]);

  const handleResendCode = useCallback(async () => {
    if (resendTimer > 0) return;

    setIsSendingCode(true);
    try {
      const response = await api.post<any>(
        ENDPOINTS.USER.DELETE_SEND_CODE,
        {},
        { requireAuth: true }
      );

      if (response.success) {
        Alert.alert('Success', 'A new verification code has been sent.');
        startResendTimer();
      } else {
        Alert.alert('Error', response.message || 'Failed to resend code.');
      }
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsSendingCode(false);
    }
  }, [resendTimer, startResendTimer]);

  const handleConfirmDelete = useCallback(async () => {
    const code = deleteCode.trim();

    if (!code || code.length < APP_CONFIG.OTP_LENGTH) {
      Alert.alert('Error', `Please enter the ${APP_CONFIG.OTP_LENGTH}-digit verification code.`);
      return;
    }

    setIsDeletingAccount(true);

    try {
      const response = await api.post<any>(
        ENDPOINTS.USER.DELETE_CONFIRM,
        { code },
        { requireAuth: true }
      );

      if (!response.success) {
        if (isAuthError(response.status)) {
          await handleAuthError(response.status);
          return;
        }
        Alert.alert('Error', response.message || 'Invalid or expired code.');
        return;
      }

      setIsDeleteStep2Visible(false);
      if (timerRef.current) clearInterval(timerRef.current);

      Alert.alert(
        'Account Deleted',
        'Your account has been permanently deleted.',
        [{ text: 'OK', onPress: () => logout(false) }]
      );
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsDeletingAccount(false);
    }
  }, [deleteCode, handleAuthError, logout]);

  const closeDeleteStep1 = useCallback(() => {
    setIsDeleteStep1Visible(false);
  }, []);

  const closeDeleteStep2 = useCallback(() => {
    setIsDeleteStep2Visible(false);
    setDeleteCode('');
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={BRAND_COLOR} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Security</Text>
        <Text style={styles.headerSubtitle}>Manage your password and account</Text>

        {/* Change Password */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={openPasswordModal}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons name="lock-outline" size={24} color={BRAND_COLOR} />
          </View>
          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Change Password</Text>
            <Text style={styles.cardRowLabel}>Update your account password</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={BRAND_COLOR} />
        </TouchableOpacity>

        {/* Delete Account */}
        <View style={styles.dangerSection}>
          <Text style={styles.dangerSectionTitle}>Danger Zone</Text>

          <TouchableOpacity
            style={styles.dangerCard}
            onPress={handleDeleteAccountStart}
            activeOpacity={0.7}
          >
            <View style={styles.dangerIconWrap}>
              <MaterialCommunityIcons name="account-remove-outline" size={24} color="#D32F2F" />
            </View>
            <View style={styles.cardRowBody}>
              <Text style={styles.dangerCardValue}>Delete Account</Text>
              <Text style={styles.dangerCardLabel}>
                Permanently delete your account and unpair all devices
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color="#D32F2F" />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ==================== Password Modal ==================== */}
      <Modal
        visible={isPasswordModalVisible}
        animationType="slide"
        transparent
        onRequestClose={closePasswordModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closePasswordModal}
          />
          <View style={styles.modalSheet}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Change Password</Text>
                <TouchableOpacity
                  onPress={closePasswordModal}
                  style={styles.modalCloseBtn}
                  disabled={isChangingPassword}
                >
                  <MaterialCommunityIcons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <MaterialCommunityIcons
                  name="lock-outline"
                  size={22}
                  color={BRAND_COLOR}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.inputField}
                  value={oldPassword}
                  onChangeText={setOldPassword}
                  placeholder="Current password"
                  placeholderTextColor="#999"
                  secureTextEntry={!showOldPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => newPasswordRef.current?.focus()}
                  editable={!isChangingPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowOldPassword((v) => !v)}
                  style={styles.eyeIcon}
                >
                  <MaterialCommunityIcons
                    name={showOldPassword ? 'eye' : 'eye-off'}
                    size={20}
                    color="#999"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <MaterialCommunityIcons
                  name="lock-plus-outline"
                  size={22}
                  color={BRAND_COLOR}
                  style={styles.inputIcon}
                />
                <TextInput
                  ref={newPasswordRef}
                  style={styles.inputField}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="New password"
                  placeholderTextColor="#999"
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                  editable={!isChangingPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowNewPassword((v) => !v)}
                  style={styles.eyeIcon}
                >
                  <MaterialCommunityIcons
                    name={showNewPassword ? 'eye' : 'eye-off'}
                    size={20}
                    color="#999"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <MaterialCommunityIcons
                  name="lock-check-outline"
                  size={22}
                  color={BRAND_COLOR}
                  style={styles.inputIcon}
                />
                <TextInput
                  ref={confirmPasswordRef}
                  style={styles.inputField}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  placeholderTextColor="#999"
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleChangePassword}
                  editable={!isChangingPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword((v) => !v)}
                  style={styles.eyeIcon}
                >
                  <MaterialCommunityIcons
                    name={showConfirmPassword ? 'eye' : 'eye-off'}
                    size={20}
                    color="#999"
                  />
                </TouchableOpacity>
              </View>

              <Text style={styles.helperText}>
                Password must be at least 8 characters with 1 uppercase letter, 1 number, and 1 special character.
              </Text>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={closePasswordModal}
                  disabled={isChangingPassword}
                >
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryBtn, isChangingPassword && styles.btnDisabled]}
                  onPress={handleChangePassword}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Change</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== Delete Step 1: Confirm & Send Code ==================== */}
      <Modal
        visible={isDeleteStep1Visible}
        animationType="slide"
        transparent
        onRequestClose={closeDeleteStep1}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closeDeleteStep1}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delete Account</Text>
              <TouchableOpacity
                onPress={closeDeleteStep1}
                style={styles.modalCloseBtn}
                disabled={isSendingCode}
              >
                <MaterialCommunityIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <View style={styles.warningBox}>
              <MaterialCommunityIcons name="alert-outline" size={24} color="#D32F2F" />
              <Text style={styles.warningText}>
                This will permanently delete your account and all associated data. All paired
                devices will be unpaired. This action cannot be undone.
              </Text>
            </View>

            <Text style={styles.deleteInfoText}>
              We will send a verification code to your registered email to confirm this action.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={closeDeleteStep1}
                disabled={isSendingCode}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dangerBtn, isSendingCode && styles.btnDisabled]}
                onPress={handleSendDeleteCode}
                disabled={isSendingCode}
              >
                {isSendingCode ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.dangerBtnText}>Send Code</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ==================== Delete Step 2: Enter Code ==================== */}
      <Modal
        visible={isDeleteStep2Visible}
        animationType="slide"
        transparent
        onRequestClose={closeDeleteStep2}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closeDeleteStep2}
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Verify Deletion</Text>
              <TouchableOpacity
                onPress={closeDeleteStep2}
                style={styles.modalCloseBtn}
                disabled={isDeletingAccount}
              >
                <MaterialCommunityIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            <Text style={styles.deleteInfoText}>
              A verification code has been sent to {maskedEmail}. Enter it below to confirm
              account deletion.
            </Text>

            <View style={styles.inputContainer}>
              <MaterialCommunityIcons
                name="numeric"
                size={22}
                color={BRAND_COLOR}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.inputField}
                value={deleteCode}
                onChangeText={(text) => setDeleteCode(text.replace(/\D/g, '').slice(0, APP_CONFIG.OTP_LENGTH))}
                placeholder={`Enter ${APP_CONFIG.OTP_LENGTH}-digit code`}
                placeholderTextColor="#999"
                keyboardType="number-pad"
                maxLength={APP_CONFIG.OTP_LENGTH}
                returnKeyType="done"
                onSubmitEditing={handleConfirmDelete}
                editable={!isDeletingAccount}
                autoFocus
              />
            </View>

            <TouchableOpacity
              onPress={handleResendCode}
              disabled={resendTimer > 0 || isSendingCode}
              style={styles.resendBtn}
            >
              <Text
                style={[
                  styles.resendText,
                  (resendTimer > 0 || isSendingCode) && styles.resendTextDisabled,
                ]}
              >
                {isSendingCode
                  ? 'Sending...'
                  : resendTimer > 0
                  ? `Resend code in ${resendTimer}s`
                  : 'Resend code'}
              </Text>
            </TouchableOpacity>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={closeDeleteStep2}
                disabled={isDeletingAccount}
              >
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dangerBtn, isDeletingAccount && styles.btnDisabled]}
                onPress={handleConfirmDelete}
                disabled={isDeletingAccount}
              >
                {isDeletingAccount ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.dangerBtnText}>Delete Account</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 30,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 12,
    gap: 6,
  },
  backButtonText: {
    color: BRAND_COLOR,
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: BRAND_COLOR,
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 15,
    color: '#7A8CA5',
    marginBottom: 24,
  },

  // Cards
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  leftIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#F6F8FB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardRowBody: {
    flex: 1,
  },
  cardRowLabel: {
    fontSize: 13,
    color: '#888',
    marginBottom: 2,
  },
  cardRowValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },

  // Danger section
  dangerSection: {
    marginTop: 24,
  },
  dangerSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D32F2F',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  dangerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5F5',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  dangerIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFEBEE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  dangerCardValue: {
    fontSize: 16,
    color: '#D32F2F',
    fontWeight: '600',
  },
  dangerCardLabel: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },

  // Warning box
  warningBox: {
    flexDirection: 'row',
    backgroundColor: '#FFF5F5',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: '#B71C1C',
    lineHeight: 20,
  },
  deleteInfoText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 16,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
  },
  modalCloseBtn: {
    padding: 4,
  },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    height: 56,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  inputField: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    color: '#333',
  },
  eyeIcon: {
    padding: 8,
  },
  helperText: {
    fontSize: 12,
    color: '#888',
    marginBottom: 16,
    lineHeight: 18,
  },

  // Resend
  resendBtn: {
    alignSelf: 'center',
    marginBottom: 12,
    padding: 8,
  },
  resendText: {
    fontSize: 14,
    color: BRAND_COLOR,
    fontWeight: '600',
  },
  resendTextDisabled: {
    color: '#999',
  },

  // Actions
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  secondaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  primaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND_COLOR,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  dangerBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D32F2F',
  },
  dangerBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.7,
  },
});
