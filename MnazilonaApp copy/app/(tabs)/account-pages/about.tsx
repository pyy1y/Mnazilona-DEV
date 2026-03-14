import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const BRAND_COLOR = '#2E5B8E';
const SUPPORT_EMAIL = 'support@mnazilona.com';
const APP_VERSION = '1.0.0';

export default function AboutScreen() {
  const router = useRouter();

  const handleGoBack = useCallback(() => {
    router.replace('/(tabs)/account');
  }, [router]);

  const handleContactSupport = useCallback(async () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=Mnazilona%20App%20Support`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Email', `Contact us at: ${SUPPORT_EMAIL}`);
      }
    } catch {
      Alert.alert('Email', `Contact us at: ${SUPPORT_EMAIL}`);
    }
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Back Button */}
        <TouchableOpacity style={styles.backButton} onPress={handleGoBack}>
          <MaterialCommunityIcons
            name="arrow-left"
            size={22}
            color={BRAND_COLOR}
          />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Header */}
        <Text style={styles.headerTitle}>About</Text>
        <Text style={styles.headerSubtitle}>
          Information about the Mnazilona application
        </Text>

        {/* App Card */}
        <View style={styles.cardRow}>
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="application-outline"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>App</Text>
            <Text style={styles.cardRowLabel}>Mnazilona</Text>
          </View>
        </View>

        {/* Version */}
        <View style={styles.cardRow}>
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="information-outline"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Version</Text>
            <Text style={styles.cardRowLabel}>{APP_VERSION}</Text>
          </View>
        </View>

        {/* Support - Clickable */}
        <TouchableOpacity
          style={styles.cardRow}
          onPress={handleContactSupport}
          activeOpacity={0.7}
        >
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="email-outline"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Support</Text>
            <Text style={styles.cardRowLabel}>{SUPPORT_EMAIL}</Text>
          </View>

          <MaterialCommunityIcons
            name="open-in-new"
            size={20}
            color={BRAND_COLOR}
          />
        </TouchableOpacity>

        {/* Privacy */}
        <View style={styles.cardRow}>
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="shield-outline"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Privacy Policy</Text>
            <Text style={styles.cardRowLabel}>Coming soon</Text>
          </View>
        </View>

        {/* Terms */}
        <View style={styles.cardRow}>
          <View style={styles.leftIconWrap}>
            <MaterialCommunityIcons
              name="file-document-outline"
              size={24}
              color={BRAND_COLOR}
            />
          </View>

          <View style={styles.cardRowBody}>
            <Text style={styles.cardRowValue}>Terms of Use</Text>
            <Text style={styles.cardRowLabel}>Coming soon</Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 30,
  },

  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  backText: {
    marginLeft: 6,
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
    fontWeight: '700',
    color: '#333',
  },

  cardRowLabel: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },

});
