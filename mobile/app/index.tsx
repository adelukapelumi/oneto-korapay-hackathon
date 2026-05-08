import { Redirect } from "expo-router";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef } from "react";
import { useAuth } from "../src/auth/auth-state";
import { colors, fonts, pixelFontSizes, spacing } from "../src/theme/tokens";

// Decides where to send the user based on app state. While bootstrap
// is in flight we render a tiny splash so the user doesn't see a flash
// of /sign-in before we've checked storage.
export default function Index(): React.ReactElement {
  const { state } = useAuth();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    ).start();
  }, [fadeAnim, pulseAnim]);

  if (state.status === "loading") {
    return (
      <View style={styles.container}>
        {/* Radial glow */}
        <Animated.View
          style={[styles.glow, { transform: [{ scale: pulseAnim }] }]}
        />

        {/* Logo */}
        <Animated.View style={[styles.logoWrap, { opacity: fadeAnim }]}>
          <Text style={styles.logo}>
            <Text style={styles.logoOne}>one</Text>
            <Text style={styles.logoTo}>to</Text>
          </Text>
        </Animated.View>

        {/* Pixel dots */}
        <View style={styles.dots}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i % 2 === 0 ? colors.primary : colors.secondary },
              ]}
            />
          ))}
        </View>

        {/* Tagline */}
        <Text style={styles.tagline}>PAY OFFLINE. PAY EVERYWHERE.</Text>

        {/* Pixel corner decorations */}
        <View style={styles.cornerTopLeft}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.cornerPixel} />
          ))}
        </View>
        <View style={styles.cornerBottomRight}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.cornerPixelAmber} />
          ))}
        </View>
      </View>
    );
  }
  if (state.status === "authed") {
    return <Redirect href="/(app)/home" />;
  }
  if (state.status === "locked") {
    return <Redirect href="/(locked)/pin-entry" />;
  }
  if (state.status === "onboarding") {
    return <Redirect href="/(onboarding)/welcome" />;
  }
  return <Redirect href="/(auth)/sign-in" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.primary,
    opacity: 0.15,
  },
  logoWrap: {
    alignItems: "center",
  },
  logo: {
    fontSize: 60,
    fontFamily: fonts.bold,
    letterSpacing: -3,
  },
  logoOne: {
    color: "#FFFFFF",
  },
  logoTo: {
    color: colors.primary,
  },
  dots: {
    flexDirection: "row",
    gap: 4,
    marginTop: spacing.xl,
  },
  dot: {
    width: 6,
    height: 6,
  },
  tagline: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.dark.textMut,
    marginTop: spacing['2xl'],
    letterSpacing: 1,
  },
  cornerTopLeft: {
    position: "absolute",
    top: 40,
    left: 20,
    opacity: 0.15,
  },
  cornerBottomRight: {
    position: "absolute",
    bottom: 40,
    right: 20,
    opacity: 0.15,
  },
  cornerPixel: {
    width: 8,
    height: 8,
    backgroundColor: colors.primary,
    marginBottom: 4,
  },
  cornerPixelAmber: {
    width: 8,
    height: 8,
    backgroundColor: colors.secondary,
    marginBottom: 4,
  },
});
