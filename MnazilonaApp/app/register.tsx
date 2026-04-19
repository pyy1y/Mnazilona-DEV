// app/register.tsx

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
} from 'react-native';
import { useRouter, Link, useNavigation } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import * as SecureStore from 'expo-secure-store';
import { api } from '../utils/api';
import { ENDPOINTS } from '../constants/api';
import {
  isValidEmail,
  normalizeEmail,
  isStrongPassword,
  sanitizeName,
  sanitizeInput,
} from '../utils/validation';

const BRAND_COLOR = '#2E5B8E';

// Countries list
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

// Date formatting helper
const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Registration draft type
type RegisterDraft = {
  name: string;
  email: string;
  password: string;
  dob: string;
  country: string;
  city: string;
};

const REGISTER_DRAFT_KEY = '__register_draft';

export default function RegisterScreen() {
  const router = useRouter();
  const navigation = useNavigation();

  // Clear password when leaving screen
  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      setPassword('');
      setIsPasswordVisible(false);
    });
    return unsubscribe;
  }, [navigation]);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  // Date state
  const [dob, setDob] = useState<Date>(new Date(2000, 0, 1)); // Default to year 2000
  const [dobLabel, setDobLabel] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Location state
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [citiesList, setCitiesList] = useState<string[]>([]);
  const [citiesCache, setCitiesCache] = useState<Record<string, string[]>>({});
  const [isLoadingCities, setIsLoadingCities] = useState(false);

  // Modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'country' | 'city'>('country');
  const [searchQuery, setSearchQuery] = useState('');

  // Loading state
  const [isLoading, setIsLoading] = useState(false);

  // Refs for input navigation
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // ======================================
  // Cities Fetching
  // ======================================
  const fetchCities = useCallback(
    async (selectedCountry: string) => {
      if (!selectedCountry) return;

      // Check cache first
      const cached = citiesCache[selectedCountry];
      if (cached && cached.length > 0) {
        setCitiesList(cached);
        return;
      }

      setIsLoadingCities(true);
      setCitiesList([]);

      try {
        const response = await fetch(
          'https://countriesnow.space/api/v0.1/countries/cities',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ country: selectedCountry }),
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch cities');
        }

        const json = await response.json();
        const data = json?.data;

        if (!json?.error && Array.isArray(data) && data.length > 0) {
          const uniqueCities = [...new Set(data.filter(Boolean))] as string[];
          setCitiesList(uniqueCities);
          setCitiesCache((prev) => ({
            ...prev,
            [selectedCountry]: uniqueCities,
          }));
        } else {
          const fallback = ['Other'];
          setCitiesList(fallback);
          setCitiesCache((prev) => ({ ...prev, [selectedCountry]: fallback }));
        }
      } catch (error) {
        if (__DEV__) console.error('Error fetching cities:', error);
        setCitiesList(['Other']);
      } finally {
        setIsLoadingCities(false);
      }
    },
    [citiesCache]
  );

  // ======================================
  // Form Validation
  // ======================================
  const validateForm = useCallback((): RegisterDraft | null => {
    const trimmedName = sanitizeName(name);
    const normalizedEmailValue = normalizeEmail(email);

    if (!trimmedName) {
      Alert.alert('Missing Name', 'Please enter your full name.');
      return null;
    }

    if (trimmedName.length < 2) {
      Alert.alert('Invalid Name', 'Name must be at least 2 characters.');
      return null;
    }

    if (!normalizedEmailValue) {
      Alert.alert('Missing Email', 'Please enter your email address.');
      return null;
    }

    if (!isValidEmail(normalizedEmailValue)) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return null;
    }

    if (!password) {
      Alert.alert('Missing Password', 'Please enter a password.');
      return null;
    }

    if (!isStrongPassword(password)) {
      Alert.alert(
        'Weak Password',
        'Password must be at least 8 characters with uppercase, lowercase, number, and special character.'
      );
      return null;
    }

    if (!dobLabel) {
      Alert.alert('Missing Date of Birth', 'Please select your date of birth.');
      return null;
    }

    if (!country) {
      Alert.alert('Missing Country', 'Please select your country.');
      return null;
    }

    if (!city) {
      Alert.alert('Missing City', 'Please select your city.');
      return null;
    }

    return {
      name: trimmedName,
      email: normalizedEmailValue,
      password,
      dob: dobLabel,
      country: sanitizeInput(country),
      city: sanitizeInput(city),
    };
  }, [name, email, password, dobLabel, country, city]);

  // ======================================
  // Handlers
  // ======================================
  const handleRegister = useCallback(async () => {
    if (isLoading) return;

    const validatedData = validateForm();
    if (!validatedData) return;

    setIsLoading(true);

    try {
      const response = await api.post(ENDPOINTS.AUTH.REGISTER_SEND_CODE, {
        email: validatedData.email,
      });

      if (!response.success) {
        Alert.alert(
          'Registration Failed',
          response.message || 'Failed to send verification code.'
        );
        return;
      }

      // Store draft in SecureStore (encrypted, not in memory or URL params)
      await SecureStore.setItemAsync(REGISTER_DRAFT_KEY, JSON.stringify(validatedData));

      // Navigate to OTP
      router.push({
        pathname: '/otp',
        params: {
          mode: 'register',
          email: validatedData.email,
        },
      });
    } catch (error) {
      if (__DEV__) console.error('Register error:', error);
      Alert.alert('Connection Error', 'Could not connect to the server.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, validateForm, router]);

  const handleDateChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      // على iOS نخلي الـ picker مفتوح
      if (Platform.OS === 'android') {
        setShowDatePicker(false);
      }

      if (event.type === 'dismissed') {
        setShowDatePicker(false);
        return;
      }

      if (selectedDate) {
        setDob(selectedDate);
        setDobLabel(formatDate(selectedDate));
      }
    },
    []
  );

  const handleDatePickerDone = useCallback(() => {
    setShowDatePicker(false);
    if (!dobLabel && dob) {
      setDobLabel(formatDate(dob));
    }
  }, [dobLabel, dob]);

  const openModal = useCallback(
    (type: 'country' | 'city') => {
      if (type === 'city' && !country) {
        Alert.alert(
          'Select Country First',
          'Please select a country before choosing a city.'
        );
        return;
      }

      setModalType(type);
      setSearchQuery('');
      setModalVisible(true);

      if (type === 'city' && country) {
        fetchCities(country);
      }
    },
    [country, fetchCities]
  );

  const handleSelectOption = useCallback(
    (item: string) => {
      if (modalType === 'country') {
        if (item !== country) {
          setCountry(item);
          setCity('');
          setCitiesList([]);
          fetchCities(item);
        }
      } else {
        setCity(item);
      }
      setModalVisible(false);
    },
    [modalType, country, fetchCities]
  );

  const togglePasswordVisibility = useCallback(() => {
    setIsPasswordVisible((prev) => !prev);
  }, []);

  // ======================================
  // Computed Values
  // ======================================
  const listData = useMemo(() => {
    const data = modalType === 'country' ? COUNTRIES : citiesList;
    const query = searchQuery.trim().toLowerCase();

    if (!query) return data;
    return data.filter((item) => item.toLowerCase().includes(query));
  }, [modalType, citiesList, searchQuery]);

  const selectedValue = modalType === 'country' ? country : city;

  // Calculate max date (user must be at least 13 years old)
  const maxDate = useMemo(() => {
    const today = new Date();
    return new Date(
      today.getFullYear() - 13,
      today.getMonth(),
      today.getDate()
    );
  }, []);

  // Calculate min date (150 years ago)
  const minDate = useMemo(() => {
    const today = new Date();
    return new Date(
      today.getFullYear() - 150,
      today.getMonth(),
      today.getDate()
    );
  }, []);

  // ======================================
  // Render
  // ======================================
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text style={styles.headerTitle}>Create Account</Text>
        <Text style={styles.headerSubtitle}>
          Fill in your details to get started
        </Text>

        {/* Name Input */}
        <View style={styles.inputContainer}>
          <Feather
            name="user"
            size={20}
            color={BRAND_COLOR}
            style={styles.inputIcon}
          />
          <TextInput
            style={styles.inputField}
            placeholder="Full Name"
            placeholderTextColor="#999"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={100}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            editable={!isLoading}
          />
        </View>

        {/* Email Input */}
        <View style={styles.inputContainer}>
          <Feather
            name="mail"
            size={20}
            color={BRAND_COLOR}
            style={styles.inputIcon}
          />
          <TextInput
            ref={emailRef}
            style={styles.inputField}
            placeholder="Email Address"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!isLoading}
          />
        </View>

        {/* Password Input */}
        <View style={styles.inputContainer}>
          <Feather
            name="lock"
            size={20}
            color={BRAND_COLOR}
            style={styles.inputIcon}
          />
          <TextInput
            ref={passwordRef}
            style={styles.inputField}
            placeholder="Password"
            placeholderTextColor="#999"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!isPasswordVisible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            returnKeyType="done"
            editable={!isLoading}
          />
          <TouchableOpacity
            onPress={togglePasswordVisibility}
            style={styles.eyeIcon}
            disabled={isLoading}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather
              name={isPasswordVisible ? 'eye' : 'eye-off'}
              size={20}
              color={BRAND_COLOR}
            />
          </TouchableOpacity>
        </View>

        {/* Password Helper Text */}
        <Text style={styles.helperText}>
          Must contain at least 8 characters, uppercase, lowercase, number, and special character.
        </Text>

        {/* Date of Birth */}
        <TouchableOpacity
          style={styles.inputContainer}
          onPress={() => setShowDatePicker(true)}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          <Feather
            name="calendar"
            size={20}
            color={BRAND_COLOR}
            style={styles.inputIcon}
          />
          <Text style={[styles.selectText, !dobLabel && styles.placeholder]}>
            {dobLabel || 'Date of Birth'}
          </Text>
          <Feather name="chevron-down" size={20} color="#999" />
        </TouchableOpacity>

        {/* Date Picker */}
        {showDatePicker && (
          <View style={styles.datePickerContainer}>
            <DateTimePicker
              value={dob}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
              maximumDate={maxDate}
              minimumDate={minDate}
              style={styles.datePicker}
              themeVariant={Platform.OS === 'ios' ? 'light' : undefined}
            />
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.datePickerDoneBtn}
                onPress={handleDatePickerDone}
              >
                <Text style={styles.datePickerDoneText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Country Selector */}
        <TouchableOpacity
          style={styles.inputContainer}
          onPress={() => openModal('country')}
          activeOpacity={0.7}
          disabled={isLoading}
        >
          <Feather
            name="globe"
            size={20}
            color={BRAND_COLOR}
            style={styles.inputIcon}
          />
          <Text style={[styles.selectText, !country && styles.placeholder]}>
            {country || 'Select Country'}
          </Text>
          <Feather name="chevron-down" size={20} color="#999" />
        </TouchableOpacity>

        {/* City Selector */}
        <TouchableOpacity
          style={[styles.inputContainer, !country && styles.inputDisabled]}
          onPress={() => openModal('city')}
          activeOpacity={0.7}
          disabled={isLoading || !country}
        >
          <Feather
            name="map-pin"
            size={20}
            color={country ? BRAND_COLOR : '#CCC'}
            style={styles.inputIcon}
          />
          <Text
            style={[
              styles.selectText,
              !city && styles.placeholder,
              !country && styles.textDisabled,
            ]}
          >
            {isLoadingCities ? 'Loading cities...' : city || 'Select City'}
          </Text>
          {isLoadingCities ? (
            <ActivityIndicator size="small" color={BRAND_COLOR} />
          ) : (
            <Feather name="chevron-down" size={20} color="#999" />
          )}
        </TouchableOpacity>

        {/* Register Button */}
        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleRegister}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.buttonText}>Sign Up</Text>
          )}
        </TouchableOpacity>

        {/* Login Link */}
        <View style={styles.linkContainer}>
          <Text style={styles.linkText}>Already have an account? </Text>
          <Link href="/login" asChild>
            <TouchableOpacity disabled={isLoading}>
              <Text style={styles.linkHighlight}>Login</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* ==================== Selection Modal ==================== */}
        <Modal
          visible={modalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {modalType === 'country' ? 'Select Country' : 'Select City'}
                </Text>
                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  style={styles.closeButton}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="x" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              {/* Search Input */}
              <View style={styles.searchContainer}>
                <Feather
                  name="search"
                  size={18}
                  color="#999"
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder={`Search ${modalType === 'country' ? 'countries' : 'cities'}...`}
                  placeholderTextColor="#999"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Feather name="x-circle" size={18} color="#999" />
                  </TouchableOpacity>
                )}
              </View>

              {/* List */}
              {modalType === 'city' && isLoadingCities ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={BRAND_COLOR} />
                  <Text style={styles.loadingText}>Loading cities...</Text>
                </View>
              ) : (
                <FlatList
                  data={listData}
                  keyExtractor={(item) => item}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  initialNumToRender={20}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>
                      No {modalType === 'country' ? 'countries' : 'cities'}{' '}
                      found.
                    </Text>
                  }
                  renderItem={({ item }) => {
                    const isSelected = selectedValue === item;
                    return (
                      <TouchableOpacity
                        style={[
                          styles.optionItem,
                          isSelected && styles.optionItemSelected,
                        ]}
                        onPress={() => handleSelectOption(item)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            isSelected && styles.optionTextSelected,
                          ]}
                        >
                          {item}
                        </Text>
                        {isSelected && (
                          <Feather name="check" size={20} color={BRAND_COLOR} />
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ======================================
// Styles
// ======================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 40,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: BRAND_COLOR,
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    height: 58,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  inputDisabled: {
    backgroundColor: '#F9F9F9',
    borderColor: '#E0E0E0',
  },
  inputIcon: {
    marginRight: 14,
  },
  inputField: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    height: '100%',
    paddingVertical: 0,
  },
  selectText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  placeholder: {
    color: '#999',
  },
  textDisabled: {
    color: '#CCC',
  },
  eyeIcon: {
    padding: 8,
    marginRight: -8,
  },
  helperText: {
    fontSize: 13,
    color: '#888',
    marginTop: -8,
    marginBottom: 20,
    marginLeft: 4,
    lineHeight: 18,
  },
  datePickerContainer: {
    backgroundColor: '#F9F9F9',
    borderRadius: 16,
    marginBottom: 16,
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
  button: {
    width: '100%',
    height: 58,
    backgroundColor: BRAND_COLOR,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 24,
    shadowColor: BRAND_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkText: {
    color: '#666',
    fontSize: 15,
  },
  linkHighlight: {
    color: BRAND_COLOR,
    fontWeight: '700',
    fontSize: 15,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    height: '70%',
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  closeButton: {
    padding: 4,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
    marginBottom: 16,
    backgroundColor: '#F9F9F9',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  optionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  optionItemSelected: {
    backgroundColor: '#F0F5FA',
    marginHorizontal: -4,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  optionText: {
    fontSize: 16,
    color: '#333',
  },
  optionTextSelected: {
    color: BRAND_COLOR,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
    color: '#999',
  },
});