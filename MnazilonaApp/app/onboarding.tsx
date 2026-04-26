import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { setOnboardingSeen } from '../utils/onboarding';

const { width, height } = Dimensions.get('window');

const BRAND_COLOR = '#2E5B8E';

type Slide = {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  soft: string;
};

const slides: Slide[] = [
  {
    id: '1',
    title: 'Welcome to Mnazilona',
    subtitle: 'A simple and modern way to manage your smart home.',
    accent: '#2E5B8E',
    soft: '#EAF2FB',
  },
  {
    id: '2',
    title: 'Control Devices Easily',
    subtitle: 'Manage connected devices through a smooth and clear experience.',
    accent: '#35679D',
    soft: '#EEF5FC',
  },
  {
    id: '3',
    title: 'Stay Updated at a Glance',
    subtitle: 'See weather, status, and home activity in one organized place.',
    accent: '#2C5A8C',
    soft: '#EAF3FA',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const flatListRef = useRef<FlatList<Slide>>(null);

  const [currentIndex, setCurrentIndex] = useState(0);

  const currentSlide = slides[currentIndex];
  const isLastSlide = useMemo(
    () => currentIndex === slides.length - 1,
    [currentIndex]
  );

  const handleFinish = useCallback(async () => {
    try {
      await setOnboardingSeen(true);
      router.replace('/login');
    } catch (error) {
      if (__DEV__) console.error('Failed to save onboarding state:', error);
      router.replace('/login');
    }
  }, [router]);

  const handleSkip = useCallback(() => {
    handleFinish();
  }, [handleFinish]);

  const handleNext = useCallback(() => {
    if (isLastSlide) {
      handleFinish();
      return;
    }

    flatListRef.current?.scrollToIndex({
      index: currentIndex + 1,
      animated: true,
    });
  }, [currentIndex, isLastSlide, handleFinish]);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / width);
      setCurrentIndex(index);
    },
    []
  );

  const renderHero = (item: Slide, index: number) => {
    if (index === 0) {
      return (
        <View style={styles.heroArea}>
          <View style={[styles.glowLarge, { backgroundColor: item.soft }]} />
          <View style={[styles.glowSmall, { backgroundColor: '#F6FAFE' }]} />

          <View style={styles.mainMockCard}>
            <View style={[styles.mainMockInner, { backgroundColor: item.soft }]}>
              <View style={styles.homeIconCircle}>
                <MaterialCommunityIcons
                  name="home-variant-outline"
                  size={82}
                  color={item.accent}
                />
              </View>

              <View style={styles.featureBadgeRow}>
                <View style={styles.featureBadge}>
                  <MaterialCommunityIcons
                    name="shield-check-outline"
                    size={15}
                    color={item.accent}
                  />
                  <Text style={[styles.featureBadgeText, { color: item.accent }]}>
                    Secure
                  </Text>
                </View>

                <View style={styles.featureBadge}>
                  <MaterialCommunityIcons
                    name="flash-outline"
                    size={15}
                    color={item.accent}
                  />
                  <Text style={[styles.featureBadgeText, { color: item.accent }]}>
                    Smart
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      );
    }

    if (index === 1) {
      return (
        <View style={styles.heroArea}>
          <View style={[styles.glowLarge, { backgroundColor: item.soft }]} />

          <View style={styles.devicesPanel}>
            <View style={styles.devicesHeader}>
              <Text style={styles.devicesHeaderTitle}>Connected Devices</Text>
              <View style={[styles.livePill, { backgroundColor: item.soft }]}>
                <Text style={[styles.livePillText, { color: item.accent }]}>Live</Text>
              </View>
            </View>

            <View style={styles.deviceTile}>
              <View style={[styles.deviceIconWrap, { backgroundColor: item.soft }]}>
                <MaterialCommunityIcons
                  name="lightbulb-outline"
                  size={24}
                  color={item.accent}
                />
              </View>
              <View style={styles.deviceTileText}>
                <Text style={styles.deviceName}>Living Room Light</Text>
                <Text style={styles.deviceStatus}>Online</Text>
              </View>
              <View style={[styles.toggleMock, { backgroundColor: item.accent }]} />
            </View>

            <View style={styles.deviceTile}>
              <View style={[styles.deviceIconWrap, { backgroundColor: item.soft }]}>
                <MaterialCommunityIcons
                  name="air-conditioner"
                  size={24}
                  color={item.accent}
                />
              </View>
              <View style={styles.deviceTileText}>
                <Text style={styles.deviceName}>Air Conditioner</Text>
                <Text style={styles.deviceStatus}>Running</Text>
              </View>
              <View style={styles.toggleMockOff} />
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.heroArea}>
        <View style={[styles.glowLarge, { backgroundColor: item.soft }]} />

        <View style={styles.dashboardMock}>
          <View style={styles.dashboardTopRow}>
            <View style={styles.weatherMiniCard}>
              <View style={styles.weatherHeaderMini}>
                <Text style={styles.weatherMiniTitle}>Weather</Text>
                <Text style={styles.weatherMiniMeta}>Dammam</Text>
              </View>

              <View style={styles.weatherTempRow}>
                <MaterialCommunityIcons
                  name="weather-partly-cloudy"
                  size={28}
                  color={item.accent}
                />
                <Text style={[styles.weatherMiniTemp, { color: item.accent }]}>27°</Text>
              </View>

              <Text style={styles.weatherMiniSub}>Clear sky • Feels like 29°</Text>
            </View>

            <View style={styles.statusMiniCard}>
              <Text style={styles.statusMiniTitle}>Status</Text>
              <Text style={[styles.statusMiniMain, { color: item.accent }]}>4 online</Text>
              <Text style={styles.statusMiniSub}>1 offline</Text>
            </View>
          </View>

          <View style={styles.activityBar}>
            <MaterialCommunityIcons
              name="home-analytics"
              size={18}
              color={item.accent}
            />
            <Text style={styles.activityText}>All home updates in one place</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderItem = ({ item, index }: { item: Slide; index: number }) => {
    return (
      <View style={styles.slide}>
        {renderHero(item, index)}

        <View style={styles.textBlock}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.subtitle}>{item.subtitle}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topDecorRight} />
      <View style={[styles.topDecorLeft, { backgroundColor: currentSlide.soft }]} />

      <View style={styles.topRow}>
        <View>
          <Text style={styles.brandText}>Mnazilona</Text>
          <Text style={styles.brandSubText}>Smart home made simple</Text>
        </View>

        {!isLastSlide ? (
          <TouchableOpacity
            onPress={handleSkip}
            activeOpacity={0.8}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.skipPlaceholder} />
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={slides}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
      />

      <View style={styles.bottomSection}>
        <View style={styles.pagination}>
          {slides.map((slide, index) => {
            const active = index === currentIndex;

            return (
              <View
                key={slide.id}
                style={[
                  styles.dot,
                  active && styles.activeDot,
                  active && { backgroundColor: currentSlide.accent },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.footerRow}>
          <View style={styles.stepWrap}>
            <Text style={styles.stepText}>
              {currentIndex + 1} / {slides.length}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: currentSlide.accent }]}
            onPress={handleNext}
            activeOpacity={0.88}
          >
            <Text style={styles.primaryButtonText}>
              {isLastSlide ? 'Get Started' : 'Next'}
            </Text>

            <MaterialCommunityIcons
              name={isLastSlide ? 'arrow-right-circle-outline' : 'arrow-right'}
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'ios' ? 68 : 36,
    paddingBottom: 28,
  },

  topDecorRight: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#F3F8FD',
  },

  topDecorLeft: {
    position: 'absolute',
    top: 90,
    left: -70,
    width: 150,
    height: 150,
    borderRadius: 75,
    opacity: 0.55,
  },

  topRow: {
    paddingHorizontal: 24,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  brandText: {
    fontSize: 22,
    fontWeight: '800',
    color: BRAND_COLOR,
    letterSpacing: 0.2,
  },

  brandSubText: {
    marginTop: 4,
    fontSize: 13,
    color: '#7A8CA5',
    fontWeight: '500',
  },

  skipButton: {
    minWidth: 64,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F8FC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },

  skipText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6F8197',
  },

  skipPlaceholder: {
    width: 64,
  },

  slide: {
    width,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },

  heroArea: {
    width: '100%',
    height: height * 0.43,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },

  glowLarge: {
    position: 'absolute',
    width: 285,
    height: 285,
    borderRadius: 142.5,
    opacity: 0.95,
  },

  glowSmall: {
    position: 'absolute',
    top: 44,
    right: 46,
    width: 90,
    height: 90,
    borderRadius: 45,
    opacity: 0.85,
  },

  mainMockCard: {
    width: 292,
    height: 292,
    borderRadius: 34,
    padding: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  mainMockInner: {
    flex: 1,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E7EEF6',
  },

  homeIconCircle: {
    width: 134,
    height: 134,
    borderRadius: 67,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  featureBadgeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },

  featureBadge: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5EDF5',
  },

  featureBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },

  devicesPanel: {
    width: 302,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    padding: 16,
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  devicesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },

  devicesHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#244B6B',
  },

  livePill: {
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  livePillText: {
    fontSize: 12,
    fontWeight: '800',
  },

  deviceTile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFCFE',
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ECF2F7',
  },

  deviceIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  deviceTileText: {
    flex: 1,
  },

  deviceName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#284766',
  },

  deviceStatus: {
    fontSize: 12,
    color: '#7A8A99',
    marginTop: 3,
  },

  toggleMock: {
    width: 42,
    height: 24,
    borderRadius: 12,
  },

  toggleMockOff: {
    width: 42,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#D8E1EA',
  },

  dashboardMock: {
    width: 306,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    padding: 16,
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  dashboardTopRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },

  weatherMiniCard: {
    flex: 1.2,
    borderRadius: 20,
    backgroundColor: '#F9FBFD',
    padding: 14,
    borderWidth: 1,
    borderColor: '#ECF2F7',
  },

  weatherHeaderMini: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  weatherMiniTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#274867',
  },

  weatherMiniMeta: {
    fontSize: 11,
    color: '#8392A1',
  },

  weatherTempRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },

  weatherMiniTemp: {
    fontSize: 28,
    fontWeight: '900',
  },

  weatherMiniSub: {
    marginTop: 8,
    fontSize: 11,
    color: '#8191A0',
    lineHeight: 16,
  },

  statusMiniCard: {
    flex: 0.9,
    borderRadius: 20,
    backgroundColor: '#F9FBFD',
    padding: 14,
    borderWidth: 1,
    borderColor: '#ECF2F7',
    justifyContent: 'center',
  },

  statusMiniTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#274867',
  },

  statusMiniMain: {
    marginTop: 12,
    fontSize: 24,
    fontWeight: '900',
  },

  statusMiniSub: {
    marginTop: 6,
    fontSize: 12,
    color: '#8392A1',
  },

  activityBar: {
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F9FBFD',
    borderWidth: 1,
    borderColor: '#ECF2F7',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  activityText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#49657F',
  },

  textBlock: {
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 8,
  },

  title: {
    fontSize: 31,
    fontWeight: '800',
    color: '#1F3550',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 39,
    letterSpacing: 0.1,
  },

  subtitle: {
    fontSize: 16,
    color: '#6F8197',
    textAlign: 'center',
    lineHeight: 25,
    maxWidth: 325,
    fontWeight: '500',
  },

  bottomSection: {
    paddingHorizontal: 24,
    marginTop: 8,
  },

  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 22,
  },

  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D5DEE8',
    marginHorizontal: 5,
  },

  activeDot: {
    width: 30,
    borderRadius: 8,
  },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  stepWrap: {
    height: 56,
    minWidth: 72,
    borderRadius: 18,
    backgroundColor: '#F5F8FC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },

  stepText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#5E738C',
  },

  primaryButton: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#1E3A5F',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
