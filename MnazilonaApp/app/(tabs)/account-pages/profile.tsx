import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { api, isAuthError, TokenManager, UserDataManager } from '../../../utils/api';
import { useAuth } from '../../../hooks/useAuth';
import { sanitizeName } from '../../../utils/validation';
import { saveUser, getUser } from '../../../utils/userStorage';
import { ENDPOINTS, APP_CONFIG } from '../../../constants/api';

const BRAND_COLOR = '#2E5B8E';

const COUNTRIES = [
  'Saudi Arabia',
  'United Arab Emirates',
  'Kuwait',
  'Qatar',
  'Bahrain',
  'Oman',
  'Egypt',
  'Jordan',
  'Iraq',
  'United States',
  'United Kingdom',
  'Canada',
  'India',
  'Pakistan',
  'Philippines',
  'Germany',
  'France',
  'Turkey',
].sort();

interface User {
  id: string;
  name: string;
  email: string;
  dob?: string;
  country?: string;
  city?: string;
}

function isUnsupportedUpdate(status?: number, message?: string) {
  const msg = (message || '').toLowerCase();
  return (
    status === 404 ||
    status === 405 ||
    status === 501 ||
    msg.includes('not support') ||
    msg.includes('not supported')
  );
}

function isValidEmail(email: string) {
  const e = email.trim();
  return e.includes('@') && e.includes('.');
}

// Email change steps
type EmailStep = 'input' | 'verify_old' | 'verify_new';

export default function ProfileScreen() {
  const router = useRouter();
  const { logout, handleAuthError } = useAuth();

  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Name
  const [isNameModalVisible, setIsNameModalVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  // Email change (3-step)
  const [isEmailModalVisible, setIsEmailModalVisible] = useState(false);
  const [emailStep, setEmailStep] = useState<EmailStep>('input');
  const [newEmail, setNewEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [maskedOldEmail, setMaskedOldEmail] = useState('');
  const [maskedNewEmail, setMaskedNewEmail] = useState('');
  const [isEmailLoading, setIsEmailLoading] = useState(false);
  const [emailResendTimer, setEmailResendTimer] = useState(0);
  const emailTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Date of Birth
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dobDate, setDobDate] = useState<Date>(new Date(2000, 0, 1));
  const [isUpdatingDob, setIsUpdatingDob] = useState(false);

  // Country & City
  const [isLocationModalVisible, setIsLocationModalVisible] = useState(false);
  const [locationModalType, setLocationModalType] = useState<'country' | 'city'>('country');
  const [locationSearch, setLocationSearch] = useState('');
  const [citiesList, setCitiesList] = useState<string[]>([]);
  const [citiesCache, setCitiesCache] = useState<Record<string, string[]>>({});
  const [isLoadingCities, setIsLoadingCities] = useState(false);
  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false);

  const updateLocalUser = useCallback(async (partial: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
    const cachedUser = await UserDataManager.get<User>();
    if (cachedUser) await UserDataManager.set({ ...cachedUser, ...partial });
    const currentUser = await getUser();
    if (currentUser) await saveUser({ ...currentUser, ...partial });
  }, []);

  const handleGoBack = useCallback(() => {
    router.replace('/(tabs)/account');
  }, [router]);

  // ==================== Load User ====================
  const loadUserData = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await TokenManager.get();
      if (!token) { await logout(); return; }

      const response = await api.get<any>(ENDPOINTS.USER.PROFILE, { requireAuth: true });
      if (!response.success) {
        if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
        const cachedUser = await UserDataManager.get<User>();
        if (cachedUser) setUser(cachedUser);
        return;
      }

      const userData = response.data;
      const userObj: User = {
        id: userData?.id || userData?._id || '',
        name: userData?.name || '',
        email: userData?.email || '',
        dob: userData?.dob || '',
        country: userData?.country || '',
        city: userData?.city || '',
      };
      setUser(userObj);
      await UserDataManager.set(userObj);
    } catch {
      const cachedUser = await UserDataManager.get<User>();
      if (cachedUser) setUser(cachedUser);
      else await logout();
    } finally {
      setIsLoading(false);
    }
  }, [logout, handleAuthError]);

  useFocusEffect(useCallback(() => { loadUserData(); }, [loadUserData]));

  // ==================== Name ====================
  const openNameModal = useCallback(() => {
    setNewName(user?.name || '');
    setIsNameModalVisible(true);
  }, [user?.name]);

  const closeNameModal = useCallback(() => {
    setIsNameModalVisible(false);
    setNewName('');
  }, []);

  const handleUpdateName = useCallback(async () => {
    const trimmedName = sanitizeName(newName);
    if (!trimmedName) { Alert.alert('Error', 'Name cannot be empty.'); return; }
    if (trimmedName.length < 2) { Alert.alert('Error', 'Name must be at least 2 characters.'); return; }

    setIsUpdatingName(true);
    try {
      const response = await api.patch<any>(ENDPOINTS.USER.UPDATE_PROFILE, { name: trimmedName }, { requireAuth: true });
      if (!response.success) {
        if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
        if (isUnsupportedUpdate(response.status, response.message)) { Alert.alert('Info', 'Name update not supported yet.'); return; }
        Alert.alert('Error', response.message || 'Failed to update name.');
        return;
      }
      if (response.data?.token) await TokenManager.set(response.data.token);
      await updateLocalUser({ name: response.data?.user?.name || trimmedName });
      Alert.alert('Success', 'Name updated successfully!');
      closeNameModal();
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsUpdatingName(false);
    }
  }, [newName, handleAuthError, closeNameModal, updateLocalUser]);

  // ==================== Date of Birth ====================
  const formatDateStr = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDobDisplay = (date: string) => {
    if (!date) return 'Not set';
    const d = new Date(date);
    if (isNaN(d.getTime())) return date;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const openDobPicker = useCallback(() => {
    if (user?.dob) {
      const parsed = new Date(user.dob);
      if (!isNaN(parsed.getTime())) setDobDate(parsed);
    }
    setShowDatePicker(true);
  }, [user?.dob]);

  const saveDob = useCallback(async (date: Date) => {
    const formatted = formatDateStr(date);
    if (formatted === user?.dob) return;

    setIsUpdatingDob(true);
    try {
      const response = await api.patch<any>(ENDPOINTS.USER.UPDATE_PROFILE, { dob: formatted }, { requireAuth: true });
      if (!response.success) {
        if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
        Alert.alert('Error', response.message || 'Failed to update date of birth.');
        return;
      }
      if (response.data?.token) await TokenManager.set(response.data.token);
      await updateLocalUser({ dob: response.data?.user?.dob || formatted });
      Alert.alert('Success', 'Date of birth updated successfully!');
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsUpdatingDob(false);
    }
  }, [user?.dob, handleAuthError, updateLocalUser]);

  const handleDateChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      // على iOS نخلي الـ picker مفتوح
      if (Platform.OS === 'android') {
        setShowDatePicker(false);
      }
      if (event.type === 'dismissed') { setShowDatePicker(false); return; }
      if (selectedDate) {
        setDobDate(selectedDate);
        if (Platform.OS === 'android') saveDob(selectedDate);
      }
    },
    [saveDob]
  );

  const handleDatePickerDone = useCallback(() => {
    setShowDatePicker(false);
    saveDob(dobDate);
  }, [dobDate, saveDob]);

  // ==================== Email Change (3-step) ====================
  const startResendTimer = useCallback(() => {
    setEmailResendTimer(APP_CONFIG.OTP_RESEND_SECONDS);
    if (emailTimerRef.current) clearInterval(emailTimerRef.current);
    emailTimerRef.current = setInterval(() => {
      setEmailResendTimer((prev) => {
        if (prev <= 1) {
          if (emailTimerRef.current) clearInterval(emailTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const openEmailModal = useCallback(() => {
    setNewEmail('');
    setEmailCode('');
    setEmailStep('input');
    setMaskedOldEmail('');
    setMaskedNewEmail('');
    setIsEmailModalVisible(true);
  }, []);

  const closeEmailModal = useCallback(() => {
    setIsEmailModalVisible(false);
    setNewEmail('');
    setEmailCode('');
    setEmailStep('input');
    if (emailTimerRef.current) clearInterval(emailTimerRef.current);
  }, []);

  // Step 1: Enter new email -> send code to OLD email
  const handleEmailStep1 = useCallback(async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!isValidEmail(trimmed)) { Alert.alert('Error', 'Please enter a valid email.'); return; }
    if (trimmed === user?.email) { Alert.alert('Error', 'New email is the same as current email.'); return; }

    setIsEmailLoading(true);
    try {
      const response = await api.post<any>(
        ENDPOINTS.USER.CHANGE_EMAIL_SEND_CODE,
        { newEmail: trimmed },
        { requireAuth: true }
      );
      if (!response.success) {
        if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
        Alert.alert('Error', response.message || 'Failed to send code.');
        return;
      }
      setMaskedOldEmail(response.data?.oldEmail || 'your current email');
      setEmailCode('');
      setEmailStep('verify_old');
      startResendTimer();
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsEmailLoading(false);
    }
  }, [newEmail, user?.email, handleAuthError, startResendTimer]);

  // Step 2: Verify old email code -> send code to NEW email
  const handleEmailStep2 = useCallback(async () => {
    const code = emailCode.trim();
    if (!code || code.length < APP_CONFIG.OTP_LENGTH) {
      Alert.alert('Error', `Please enter the ${APP_CONFIG.OTP_LENGTH}-digit code.`);
      return;
    }

    setIsEmailLoading(true);
    try {
      const response = await api.post<any>(
        ENDPOINTS.USER.CHANGE_EMAIL_VERIFY_OLD,
        { code, newEmail: newEmail.trim().toLowerCase() },
        { requireAuth: true }
      );
      if (!response.success) {
        if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
        Alert.alert('Error', response.message || 'Invalid or expired code.');
        return;
      }
      setMaskedNewEmail(response.data?.newEmail || 'your new email');
      setEmailCode('');
      setEmailStep('verify_new');
      startResendTimer();
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsEmailLoading(false);
    }
  }, [emailCode, newEmail, handleAuthError, startResendTimer]);

  // Step 3: Verify new email code -> change email
  const handleEmailStep3 = useCallback(async () => {
    const code = emailCode.trim();
    if (!code || code.length < APP_CONFIG.OTP_LENGTH) {
      Alert.alert('Error', `Please enter the ${APP_CONFIG.OTP_LENGTH}-digit code.`);
      return;
    }

    setIsEmailLoading(true);
    try {
      const response = await api.post<any>(
        ENDPOINTS.USER.CHANGE_EMAIL_CONFIRM,
        { code, newEmail: newEmail.trim().toLowerCase() },
        { requireAuth: true }
      );
      if (!response.success) {
        if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
        Alert.alert('Error', response.message || 'Invalid or expired code.');
        return;
      }
      if (response.data?.token) await TokenManager.set(response.data.token);
      const updatedEmail = response.data?.user?.email || newEmail.trim().toLowerCase();
      await updateLocalUser({ email: updatedEmail });
      Alert.alert('Success', 'Email changed successfully!');
      closeEmailModal();
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsEmailLoading(false);
    }
  }, [emailCode, newEmail, handleAuthError, updateLocalUser, closeEmailModal]);

  // Resend for current step
  const handleResendEmailCode = useCallback(async () => {
    if (emailResendTimer > 0) return;
    setIsEmailLoading(true);
    try {
      if (emailStep === 'verify_old') {
        const response = await api.post<any>(
          ENDPOINTS.USER.CHANGE_EMAIL_SEND_CODE,
          { newEmail: newEmail.trim().toLowerCase() },
          { requireAuth: true }
        );
        if (response.success) { Alert.alert('Success', 'Code resent to your current email.'); startResendTimer(); }
        else Alert.alert('Error', response.message || 'Failed to resend code.');
      } else if (emailStep === 'verify_new') {
        // Cannot resend to new email without re-verifying old email
        // Restart the process
        Alert.alert(
          'Resend Code',
          'To get a new code for your new email, you need to restart the verification process.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Restart', onPress: () => { setEmailStep('input'); setEmailCode(''); } },
          ]
        );
      }
    } catch {
      Alert.alert('Error', 'Could not connect to server.');
    } finally {
      setIsEmailLoading(false);
    }
  }, [emailResendTimer, emailStep, newEmail, startResendTimer]);

  // ==================== Country & City ====================
  const fetchCities = useCallback(
    async (selectedCountry: string) => {
      if (!selectedCountry) return;
      const cached = citiesCache[selectedCountry];
      if (cached && cached.length > 0) { setCitiesList(cached); return; }

      setIsLoadingCities(true);
      setCitiesList([]);
      try {
        const response = await fetch('https://countriesnow.space/api/v0.1/countries/cities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country: selectedCountry }),
        });
        if (!response.ok) throw new Error('Failed to fetch cities');
        const json = await response.json();
        const data = json?.data;
        if (!json?.error && Array.isArray(data) && data.length > 0) {
          const uniqueCities = [...new Set(data.filter(Boolean))] as string[];
          setCitiesList(uniqueCities);
          setCitiesCache((prev) => ({ ...prev, [selectedCountry]: uniqueCities }));
        } else {
          setCitiesList(['Other']);
          setCitiesCache((prev) => ({ ...prev, [selectedCountry]: ['Other'] }));
        }
      } catch {
        setCitiesList(['Other']);
      } finally {
        setIsLoadingCities(false);
      }
    },
    [citiesCache]
  );

  const openLocationModal = useCallback(
    (type: 'country' | 'city') => {
      if (type === 'city' && !user?.country) {
        Alert.alert('Select Country First', 'Please select a country before choosing a city.');
        return;
      }
      setLocationModalType(type);
      setLocationSearch('');
      setIsLocationModalVisible(true);
      if (type === 'city' && user?.country) fetchCities(user.country);
    },
    [user?.country, fetchCities]
  );

  const closeLocationModal = useCallback(() => {
    setIsLocationModalVisible(false);
    setLocationSearch('');
  }, []);

  const handleSelectLocation = useCallback(
    async (item: string) => {
      setIsUpdatingLocation(true);
      try {
        if (locationModalType === 'country') {
          const isNewCountry = item !== user?.country;
          const updateData: any = { country: item };
          if (isNewCountry) updateData.city = '';

          const response = await api.patch<any>(ENDPOINTS.USER.UPDATE_PROFILE, updateData, { requireAuth: true });
          if (!response.success) {
            if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
            Alert.alert('Error', response.message || 'Failed to update country.');
            return;
          }
          if (response.data?.token) await TokenManager.set(response.data.token);
          await updateLocalUser({ country: item, ...(isNewCountry ? { city: '' } : {}) });
          if (isNewCountry) { setCitiesList([]); fetchCities(item); }
        } else {
          const response = await api.patch<any>(ENDPOINTS.USER.UPDATE_PROFILE, { city: item }, { requireAuth: true });
          if (!response.success) {
            if (isAuthError(response.status)) { await handleAuthError(response.status); return; }
            Alert.alert('Error', response.message || 'Failed to update city.');
            return;
          }
          if (response.data?.token) await TokenManager.set(response.data.token);
          await updateLocalUser({ city: response.data?.user?.city || item });
        }
        closeLocationModal();
      } catch {
        Alert.alert('Error', 'Could not connect to server.');
      } finally {
        setIsUpdatingLocation(false);
      }
    },
    [locationModalType, user?.country, handleAuthError, updateLocalUser, closeLocationModal, fetchCities]
  );

  const locationListData = useMemo(() => {
    const data = locationModalType === 'country' ? COUNTRIES : citiesList;
    const query = locationSearch.trim().toLowerCase();
    if (!query) return data;
    return data.filter((item) => item.toLowerCase().includes(query));
  }, [locationModalType, citiesList, locationSearch]);

  // ==================== Email modal helpers ====================
  const getEmailModalTitle = () => {
    if (emailStep === 'input') return 'Change Email';
    if (emailStep === 'verify_old') return 'Verify Current Email';
    return 'Verify New Email';
  };

  const getEmailSubmitHandler = () => {
    if (emailStep === 'input') return handleEmailStep1;
    if (emailStep === 'verify_old') return handleEmailStep2;
    return handleEmailStep3;
  };

  const getEmailSubmitLabel = () => {
    if (emailStep === 'input') return 'Send Code';
    if (emailStep === 'verify_old') return 'Verify';
    return 'Confirm';
  };

  // ==================== Render ====================
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

        <Text style={styles.headerTitle}>Profile</Text>
        <Text style={styles.headerSubtitle}>Manage your account information</Text>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={BRAND_COLOR} />
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
        ) : (
          <>
            {/* Name */}
            <TouchableOpacity style={styles.cardRow} onPress={openNameModal} activeOpacity={0.7}>
              <View style={styles.leftIconWrap}>
                <MaterialCommunityIcons name="account-circle-outline" size={28} color={BRAND_COLOR} />
              </View>
              <View style={styles.cardRowBody}>
                <Text style={styles.cardRowLabel}>Name</Text>
                <Text style={styles.cardRowValue}>{user?.name || 'Not set'}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={BRAND_COLOR} />
            </TouchableOpacity>

            {/* Email */}
            <TouchableOpacity style={styles.cardRow} onPress={openEmailModal} activeOpacity={0.7}>
              <View style={styles.leftIconWrap}>
                <MaterialCommunityIcons name="email-outline" size={24} color={BRAND_COLOR} />
              </View>
              <View style={styles.cardRowBody}>
                <Text style={styles.cardRowLabel}>Email</Text>
                <Text style={styles.cardRowValue}>{user?.email || 'Not set'}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={BRAND_COLOR} />
            </TouchableOpacity>

            {/* Date of Birth */}
            <TouchableOpacity style={styles.cardRow} onPress={openDobPicker} activeOpacity={0.7}>
              <View style={styles.leftIconWrap}>
                <MaterialCommunityIcons name="calendar-outline" size={24} color={BRAND_COLOR} />
              </View>
              <View style={styles.cardRowBody}>
                <Text style={styles.cardRowLabel}>Date of Birth</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.cardRowValue}>{formatDobDisplay(user?.dob || '')}</Text>
                  {isUpdatingDob && <ActivityIndicator size="small" color={BRAND_COLOR} style={{ marginLeft: 8 }} />}
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-down" size={24} color="#999" />
            </TouchableOpacity>

            {/* Date Picker (inline like register) */}
            {showDatePicker && (
              <View style={styles.datePickerContainer}>
                <DateTimePicker
                  value={dobDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleDateChange}
                  maximumDate={new Date()}
                  minimumDate={new Date(1920, 0, 1)}
                  style={styles.datePicker}
                  themeVariant={Platform.OS === 'ios' ? 'light' : undefined}
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={[styles.datePickerDoneBtn, isUpdatingDob && styles.btnDisabled]}
                    onPress={handleDatePickerDone}
                    disabled={isUpdatingDob}
                  >
                    {isUpdatingDob ? (
                      <ActivityIndicator size="small" color={BRAND_COLOR} />
                    ) : (
                      <Text style={styles.datePickerDoneText}>Done</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Country */}
            <TouchableOpacity style={styles.cardRow} onPress={() => openLocationModal('country')} activeOpacity={0.7}>
              <View style={styles.leftIconWrap}>
                <MaterialCommunityIcons name="earth" size={24} color={BRAND_COLOR} />
              </View>
              <View style={styles.cardRowBody}>
                <Text style={styles.cardRowLabel}>Country</Text>
                <Text style={styles.cardRowValue}>{user?.country || 'Not set'}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={BRAND_COLOR} />
            </TouchableOpacity>

            {/* City */}
            <TouchableOpacity style={styles.cardRow} onPress={() => openLocationModal('city')} activeOpacity={0.7}>
              <View style={styles.leftIconWrap}>
                <MaterialCommunityIcons name="map-marker-outline" size={24} color={BRAND_COLOR} />
              </View>
              <View style={styles.cardRowBody}>
                <Text style={styles.cardRowLabel}>City</Text>
                <Text style={styles.cardRowValue}>{user?.city || 'Not set'}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={24} color={BRAND_COLOR} />
            </TouchableOpacity>
          </>
        )}

        {/* ==================== Name Modal ==================== */}
        <Modal visible={isNameModalVisible} animationType="slide" transparent onRequestClose={closeNameModal}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeNameModal} />
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Edit Name</Text>
                <TouchableOpacity onPress={closeNameModal} style={styles.modalCloseBtn} disabled={isUpdatingName}>
                  <MaterialCommunityIcons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="account-edit-outline" size={22} color={BRAND_COLOR} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputField}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Enter your name"
                  placeholderTextColor="#999"
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={100}
                  returnKeyType="done"
                  onSubmitEditing={handleUpdateName}
                  editable={!isUpdatingName}
                  autoFocus
                />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={closeNameModal} disabled={isUpdatingName}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primaryBtn, isUpdatingName && styles.btnDisabled]} onPress={handleUpdateName} disabled={isUpdatingName}>
                  {isUpdatingName ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ==================== Email Modal (3-step) ==================== */}
        <Modal visible={isEmailModalVisible} animationType="slide" transparent onRequestClose={closeEmailModal}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeEmailModal} />
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{getEmailModalTitle()}</Text>
                <TouchableOpacity onPress={closeEmailModal} style={styles.modalCloseBtn} disabled={isEmailLoading}>
                  <MaterialCommunityIcons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              {/* Step indicator */}
              <View style={styles.stepIndicator}>
                <View style={[styles.stepDot, emailStep === 'input' && styles.stepDotActive]} />
                <View style={styles.stepLine} />
                <View style={[styles.stepDot, emailStep === 'verify_old' && styles.stepDotActive]} />
                <View style={styles.stepLine} />
                <View style={[styles.stepDot, emailStep === 'verify_new' && styles.stepDotActive]} />
              </View>
              <View style={styles.stepLabels}>
                <Text style={[styles.stepLabelText, emailStep === 'input' && styles.stepLabelActive]}>New Email</Text>
                <Text style={[styles.stepLabelText, emailStep === 'verify_old' && styles.stepLabelActive]}>Verify Old</Text>
                <Text style={[styles.stepLabelText, emailStep === 'verify_new' && styles.stepLabelActive]}>Verify New</Text>
              </View>

              {/* Step 1: Enter new email */}
              {emailStep === 'input' && (
                <>
                  <Text style={styles.stepDescription}>
                    Enter your new email address. We will send a verification code to your current email first.
                  </Text>
                  <View style={styles.inputContainer}>
                    <MaterialCommunityIcons name="email-edit-outline" size={22} color={BRAND_COLOR} style={styles.inputIcon} />
                    <TextInput
                      style={styles.inputField}
                      value={newEmail}
                      onChangeText={setNewEmail}
                      placeholder="Enter new email"
                      placeholderTextColor="#999"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      returnKeyType="done"
                      onSubmitEditing={handleEmailStep1}
                      editable={!isEmailLoading}
                      autoFocus
                    />
                  </View>
                </>
              )}

              {/* Step 2: Verify old email */}
              {emailStep === 'verify_old' && (
                <>
                  <Text style={styles.stepDescription}>
                    A verification code has been sent to {maskedOldEmail}. Enter it below to verify your identity.
                  </Text>
                  <View style={styles.inputContainer}>
                    <MaterialCommunityIcons name="numeric" size={22} color={BRAND_COLOR} style={styles.inputIcon} />
                    <TextInput
                      style={styles.inputField}
                      value={emailCode}
                      onChangeText={(t) => setEmailCode(t.replace(/\D/g, '').slice(0, APP_CONFIG.OTP_LENGTH))}
                      placeholder={`Enter ${APP_CONFIG.OTP_LENGTH}-digit code`}
                      placeholderTextColor="#999"
                      keyboardType="number-pad"
                      maxLength={APP_CONFIG.OTP_LENGTH}
                      returnKeyType="done"
                      onSubmitEditing={handleEmailStep2}
                      editable={!isEmailLoading}
                      autoFocus
                    />
                  </View>
                  <TouchableOpacity
                    onPress={handleResendEmailCode}
                    disabled={emailResendTimer > 0 || isEmailLoading}
                    style={styles.resendBtn}
                  >
                    <Text style={[styles.resendText, (emailResendTimer > 0 || isEmailLoading) && styles.resendTextDisabled]}>
                      {isEmailLoading ? 'Sending...' : emailResendTimer > 0 ? `Resend code in ${emailResendTimer}s` : 'Resend code'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Step 3: Verify new email */}
              {emailStep === 'verify_new' && (
                <>
                  <Text style={styles.stepDescription}>
                    A verification code has been sent to {maskedNewEmail}. Enter it below to complete the email change.
                  </Text>
                  <View style={styles.inputContainer}>
                    <MaterialCommunityIcons name="numeric" size={22} color={BRAND_COLOR} style={styles.inputIcon} />
                    <TextInput
                      style={styles.inputField}
                      value={emailCode}
                      onChangeText={(t) => setEmailCode(t.replace(/\D/g, '').slice(0, APP_CONFIG.OTP_LENGTH))}
                      placeholder={`Enter ${APP_CONFIG.OTP_LENGTH}-digit code`}
                      placeholderTextColor="#999"
                      keyboardType="number-pad"
                      maxLength={APP_CONFIG.OTP_LENGTH}
                      returnKeyType="done"
                      onSubmitEditing={handleEmailStep3}
                      editable={!isEmailLoading}
                      autoFocus
                    />
                  </View>
                </>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={closeEmailModal} disabled={isEmailLoading}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, isEmailLoading && styles.btnDisabled]}
                  onPress={getEmailSubmitHandler()}
                  disabled={isEmailLoading}
                >
                  {isEmailLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.primaryBtnText}>{getEmailSubmitLabel()}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* ==================== Location Modal (Country / City) ==================== */}
        <Modal visible={isLocationModalVisible} animationType="slide" transparent onRequestClose={closeLocationModal}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeLocationModal} />
            <View style={[styles.modalSheet, { maxHeight: '70%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {locationModalType === 'country' ? 'Select Country' : 'Select City'}
                </Text>
                <TouchableOpacity onPress={closeLocationModal} style={styles.modalCloseBtn} disabled={isUpdatingLocation}>
                  <MaterialCommunityIcons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              {/* Search */}
              <View style={styles.inputContainer}>
                <MaterialCommunityIcons name="magnify" size={22} color={BRAND_COLOR} style={styles.inputIcon} />
                <TextInput
                  style={styles.inputField}
                  value={locationSearch}
                  onChangeText={setLocationSearch}
                  placeholder={locationModalType === 'country' ? 'Search countries...' : 'Search cities...'}
                  placeholderTextColor="#999"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                />
              </View>

              {isLoadingCities && locationModalType === 'city' ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={BRAND_COLOR} />
                  <Text style={styles.loadingText}>Loading cities...</Text>
                </View>
              ) : (
                <FlatList
                  data={locationListData}
                  keyExtractor={(item) => item}
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 350 }}
                  renderItem={({ item }) => {
                    const isSelected =
                      locationModalType === 'country' ? item === user?.country : item === user?.city;
                    return (
                      <TouchableOpacity
                        style={[styles.listItem, isSelected && styles.listItemSelected]}
                        onPress={() => handleSelectLocation(item)}
                        disabled={isUpdatingLocation}
                      >
                        <Text style={[styles.listItemText, isSelected && styles.listItemTextSelected]}>
                          {item}
                        </Text>
                        {isSelected && (
                          <MaterialCommunityIcons name="check" size={20} color={BRAND_COLOR} />
                        )}
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={
                    <Text style={styles.emptyListText}>
                      {locationModalType === 'city' ? 'No cities found.' : 'No countries found.'}
                    </Text>
                  }
                />
              )}

              {isUpdatingLocation && (
                <View style={styles.updatingOverlay}>
                  <ActivityIndicator size="small" color={BRAND_COLOR} />
                  <Text style={{ marginLeft: 8, color: '#666' }}>Saving...</Text>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
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
  backButtonText: { color: BRAND_COLOR, fontSize: 16, fontWeight: '600' },
  headerTitle: { fontSize: 34, fontWeight: '700', color: BRAND_COLOR, marginBottom: 6 },
  headerSubtitle: { fontSize: 15, color: '#7A8CA5', marginBottom: 24 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },

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
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: '#F6F8FB',
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  cardRowBody: { flex: 1 },
  cardRowLabel: { fontSize: 13, color: '#888', marginBottom: 2 },
  cardRowValue: { fontSize: 16, color: '#333', fontWeight: '600' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#333' },
  modalCloseBtn: { padding: 4 },

  inputContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1, borderColor: '#E8E8E8',
    height: 56, marginBottom: 12, paddingHorizontal: 16,
  },
  inputIcon: { marginRight: 12 },
  inputField: { flex: 1, height: '100%', fontSize: 16, color: '#333' },

  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  secondaryBtn: {
    flex: 1, height: 52, borderRadius: 16,
    borderWidth: 1, borderColor: '#E8E8E8',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: { color: '#666', fontSize: 16, fontWeight: '600' },
  primaryBtn: {
    flex: 1, height: 52, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', backgroundColor: BRAND_COLOR,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.7 },

  // Step indicator
  stepIndicator: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  stepDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#E0E0E0',
  },
  stepDotActive: { backgroundColor: BRAND_COLOR, width: 14, height: 14, borderRadius: 7 },
  stepLine: { width: 40, height: 2, backgroundColor: '#E0E0E0', marginHorizontal: 6 },
  stepLabels: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: 16, paddingHorizontal: 8,
  },
  stepLabelText: { fontSize: 11, color: '#999', textAlign: 'center', flex: 1 },
  stepLabelActive: { color: BRAND_COLOR, fontWeight: '600' },
  stepDescription: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 16 },

  // Resend
  resendBtn: { alignSelf: 'center', marginBottom: 4, padding: 8 },
  resendText: { fontSize: 14, color: BRAND_COLOR, fontWeight: '600' },
  resendTextDisabled: { color: '#999' },

  // Date picker (inline)
  datePickerContainer: {
    backgroundColor: '#F9F9F9',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  datePicker: {
    height: 150,
  },
  datePickerDoneBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    backgroundColor: '#FFFFFF',
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND_COLOR,
  },

  // Location list
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  listItemSelected: {
    backgroundColor: '#F0F5FA',
  },
  listItemText: {
    fontSize: 16,
    color: '#333',
  },
  listItemTextSelected: {
    color: BRAND_COLOR,
    fontWeight: '600',
  },
  emptyListText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
    paddingVertical: 30,
  },
  updatingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
});
