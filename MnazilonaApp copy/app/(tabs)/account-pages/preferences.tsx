import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Platform,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BRAND_COLOR = '#2E5B8E';

const PREFS_KEY = 'mnazilona_preferences';

type SelectionType = 'language' | 'theme' | 'temperature' | null;

interface Preferences {
  language: string;
  theme: string;
  temperatureUnit: string;
}

const DEFAULT_PREFS: Preferences = {
  language: 'English',
  theme: 'System',
  temperatureUnit: 'Celsius',
};

async function loadPreferences(): Promise<Preferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

async function savePreferences(prefs: Preferences): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    if (__DEV__) console.error('Failed to save preferences');
  }
}

export default function PreferencesScreen() {
  const router = useRouter();

  const [language, setLanguage] = useState('English');
  const [theme, setTheme] = useState('System');
  const [temperatureUnit, setTemperatureUnit] = useState('Celsius');
  const [isLoaded, setIsLoaded] = useState(false);

  const [activeSheet, setActiveSheet] = useState<SelectionType>(null);

  // Load saved preferences on mount
  useEffect(() => {
    loadPreferences().then((prefs) => {
      setLanguage(prefs.language);
      setTheme(prefs.theme);
      setTemperatureUnit(prefs.temperatureUnit);
      setIsLoaded(true);
    });
  }, []);

  // Save whenever a preference changes (after initial load)
  useEffect(() => {
    if (!isLoaded) return;
    savePreferences({ language, theme, temperatureUnit });
  }, [language, theme, temperatureUnit, isLoaded]);

  const handleGoBack = useCallback(() => {
    router.replace('/(tabs)/account');
  }, [router]);

  const openLanguageSheet = useCallback(() => {
    setActiveSheet('language');
  }, []);

  const openThemeSheet = useCallback(() => {
    setActiveSheet('theme');
  }, []);

  const openTemperatureSheet = useCallback(() => {
    setActiveSheet('temperature');
  }, []);

  const closeSheet = useCallback(() => {
    setActiveSheet(null);
  }, []);

  const renderOption = (
    label: string,
    isSelected: boolean,
    onPress: () => void
  ) => (
    <TouchableOpacity
      style={styles.optionRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.optionText}>{label}</Text>
      {isSelected ? (
        <MaterialCommunityIcons
          name="check-circle"
          size={22}
          color={BRAND_COLOR}
        />
      ) : (
        <MaterialCommunityIcons
          name="circle-outline"
          size={22}
          color="#B0B7C3"
        />
      )}
    </TouchableOpacity>
  );

  const getSheetTitle = () => {
    if (activeSheet === 'language') return 'Select Language';
    if (activeSheet === 'theme') return 'Select Theme';
    if (activeSheet === 'temperature') return 'Select Temperature Unit';
    return '';
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={BRAND_COLOR} />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Preferences</Text>
        <Text style={styles.headerSubtitle}>Manage app language, appearance and units</Text>

        {/* Language Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={openLanguageSheet}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="translate"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Language</Text>
            <Text style={styles.cardRowLabel}>{language}</Text>
          </View>

          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Theme Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={openThemeSheet}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="theme-light-dark"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Theme</Text>
            <Text style={styles.cardRowLabel}>{theme}</Text>
          </View>

          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Temperature Unit Card */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={openTemperatureSheet}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="thermometer"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Temperature Unit</Text>
            <Text style={styles.cardRowLabel}>{temperatureUnit}</Text>
          </View>

          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={activeSheet !== null}
        animationType="slide"
        transparent
        onRequestClose={closeSheet}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closeSheet}
          />

          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{getSheetTitle()}</Text>
              <TouchableOpacity onPress={closeSheet} style={styles.modalCloseBtn}>
                <MaterialCommunityIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {activeSheet === 'language' && (
              <>
                {renderOption('English', language === 'English', () => {
                  setLanguage('English');
                  closeSheet();
                })}
                {renderOption('Arabic', language === 'Arabic', () => {
                  setLanguage('Arabic');
                  closeSheet();
                })}
              </>
            )}

            {activeSheet === 'theme' && (
              <>
                {renderOption('Light', theme === 'Light', () => {
                  setTheme('Light');
                  closeSheet();
                })}
                {renderOption('Dark', theme === 'Dark', () => {
                  setTheme('Dark');
                  closeSheet();
                })}
                {renderOption('System', theme === 'System', () => {
                  setTheme('System');
                  closeSheet();
                })}
              </>
            )}

            {activeSheet === 'temperature' && (
              <>
                {renderOption('Celsius', temperatureUnit === 'Celsius', () => {
                  setTemperatureUnit('Celsius');
                  closeSheet();
                })}
                {renderOption('Fahrenheit', temperatureUnit === 'Fahrenheit', () => {
                  setTemperatureUnit('Fahrenheit');
                  closeSheet();
                })}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
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
  cardRowValue: {
    fontSize: 16,
    color: '#333',
    fontWeight: '700',
  },
  cardRowLabel: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
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
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    paddingBottom: 14,
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
  optionRow: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  optionText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
});
