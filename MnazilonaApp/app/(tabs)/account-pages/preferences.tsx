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

import {
  loadPreferences,
  savePreferences,
  type TemperatureUnit,
} from '../../../utils/preferences';

const BRAND_COLOR = '#2E5B8E';

export default function PreferencesScreen() {
  const router = useRouter();

  const [temperatureUnit, setTemperatureUnit] =
    useState<TemperatureUnit>('Celsius');
  const [isLoaded, setIsLoaded] = useState(false);
  const [isUnitSheetVisible, setIsUnitSheetVisible] = useState(false);

  useEffect(() => {
    loadPreferences().then((prefs) => {
      setTemperatureUnit(prefs.temperatureUnit);
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    savePreferences({ temperatureUnit });
  }, [temperatureUnit, isLoaded]);

  const handleGoBack = useCallback(() => {
    router.replace('/(tabs)/account');
  }, [router]);

  const closeSheet = useCallback(() => {
    setIsUnitSheetVisible(false);
  }, []);

  const renderOption = (
    label: TemperatureUnit,
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
        <Text style={styles.headerSubtitle}>
          Manage the settings that are currently applied across supported screens.
        </Text>

        <TouchableOpacity
          style={styles.cardRow}
          onPress={() => setIsUnitSheetVisible(true)}
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

        <View style={styles.infoCard}>
          <MaterialCommunityIcons
            name="information-outline"
            size={20}
            color={BRAND_COLOR}
            style={styles.infoIcon}
          />
          <Text style={styles.infoText}>
            This setting is now applied in the dashboard weather card and is
            ready for the rest of the app as device views move out of preview mode.
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={isUnitSheetVisible}
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
              <Text style={styles.modalTitle}>Select Temperature Unit</Text>
              <TouchableOpacity onPress={closeSheet} style={styles.modalCloseBtn}>
                <MaterialCommunityIcons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>

            {renderOption('Celsius', temperatureUnit === 'Celsius', () => {
              setTemperatureUnit('Celsius');
              closeSheet();
            })}
            {renderOption('Fahrenheit', temperatureUnit === 'Fahrenheit', () => {
              setTemperatureUnit('Fahrenheit');
              closeSheet();
            })}
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
    fontWeight: '600',
    color: '#1E2A37',
    marginBottom: 4,
  },
  cardRowLabel: {
    fontSize: 14,
    color: '#7A8CA5',
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F4F8FC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E1EBF5',
  },
  infoIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#5F7085',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E2A37',
  },
  modalCloseBtn: {
    padding: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F6',
  },
  optionText: {
    fontSize: 16,
    color: '#1E2A37',
    fontWeight: '500',
  },
});
