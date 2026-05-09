import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
  shadows,
} from "../../src/theme/tokens";

const STEPS = [
  {
    icon: "🔑",
    title: "Create a keypair",
    desc: "A secure signing key is generated on this device — it never leaves your phone",
  },
  {
    icon: "🔐",
    title: "Set a 6-digit PIN",
    desc: "Your PIN encrypts and protects the key. Only you can unlock it",
  },
  {
    icon: "📷",
    title: "Pay offline",
    desc: "Scan a merchant QR, confirm with your PIN, and you're done — no internet needed",
  },
];

function StepCard({
  icon,
  title,
  desc,
  index,
}: {
  icon: string;
  title: string;
  desc: string;
  index: number;
}): React.ReactElement {
  const translateY = useRef(new Animated.Value(30)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    const staggerMs = 300 + index * 180;
    Animated.sequence([
      Animated.delay(staggerMs),
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 9,
        }),
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          tension: 80,
          friction: 9,
        }),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        styles.card,
        { opacity, transform: [{ translateY }, { scale }] },
      ]}
    >
      <View style={styles.cardIcon}>
        <Text style={styles.cardIconText}>{icon}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardStep}>{index + 1}.</Text>
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        <Text style={styles.cardDesc}>{desc}</Text>
      </View>
    </Animated.View>
  );
}

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();

  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerY = useRef(new Animated.Value(-16)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
      Animated.spring(headerY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 8,
      }),
    ]).start();

    Animated.sequence([
      Animated.delay(300 + STEPS.length * 180 + 400),
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.headerSection,
            { opacity: headerOpacity, transform: [{ translateY: headerY }] },
          ]}
        >
          <Text style={styles.pixelLabel}>LET'S GO</Text>
          <Text style={styles.title}>
            Welcome to <Text style={styles.titleAccent}>oneto</Text>
          </Text>
          <Text style={styles.subtitle}>
            Here's how we'll set up your account
          </Text>
        </Animated.View>

        <View style={styles.stepsContainer}>
          {STEPS.map((s, i) => (
            <StepCard key={i} icon={s.icon} title={s.title} desc={s.desc} index={i} />
          ))}
        </View>

        <View style={styles.spacer} />

        <Animated.View style={{ opacity: buttonOpacity, width: "100%" }}>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => router.push("/(onboarding)/pin-setup")}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.light.bg },
  container: {
    flex: 1,
    paddingHorizontal: spacing.screenHorizontal,
    paddingTop: spacing["4xl"],
    paddingBottom: spacing["2xl"],
    alignItems: "stretch",
  },
  headerSection: { alignItems: "center" },
  pixelLabel: { fontFamily: fonts.pixel, fontSize: pixelFontSizes.lg, color: colors.primary, marginBottom: spacing.md },
  title: { fontFamily: fonts.bold, fontSize: fontSizes.h2Lg, color: colors.light.text, textAlign: "center" },
  titleAccent: { color: colors.primary },
  subtitle: { fontFamily: fonts.regular, fontSize: fontSizes.body, color: colors.light.textSec, marginTop: spacing.sm, textAlign: "center" },
  stepsContainer: { gap: spacing.lg, marginTop: spacing["3xl"] },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.lg,
    backgroundColor: colors.light.card, borderWidth: borders.standard, borderColor: colors.light.border,
    borderRadius: radii.xl, padding: spacing.cardPad, ...shadows.neu.light,
  },
  cardIcon: { width: 52, height: 52, borderRadius: radii.lg, borderWidth: borders.medium, borderColor: colors.light.border, backgroundColor: colors.light.cardAlt, alignItems: "center", justifyContent: "center" },
  cardIconText: { fontSize: 24 },
  cardBody: { flex: 1 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardStep: { fontFamily: fonts.pixel, fontSize: pixelFontSizes.sm, color: colors.light.textMut },
  cardTitle: { fontFamily: fonts.bold, fontSize: fontSizes.sectionTitle, color: colors.light.text },
  cardDesc: { fontFamily: fonts.regular, fontSize: fontSizes.caption, color: colors.light.textSec, marginTop: spacing.xs, lineHeight: 18 },
  spacer: { flex: 1 },
  button: { height: 52, backgroundColor: colors.primary, borderRadius: radii.pill, borderWidth: borders.standard, borderColor: colors.light.border, alignItems: "center", justifyContent: "center", ...shadows.neu.light },
  buttonPressed: { transform: [{ translateX: 3 }, { translateY: 3 }], shadowOffset: { width: 0, height: 0 } },
  buttonText: { fontFamily: fonts.bold, fontSize: fontSizes.button, color: colors.primaryText },
});
