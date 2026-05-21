import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../../components/Screen";
import {
  useCompactLayout,
  type CompactLayoutMetrics,
} from "../../src/ui/responsive";
import { useThemeMode } from "../../src/theme/theme-provider";
import {
  getTheme,
  colors,
  fonts,
  fontSizes,
  pixelFontSizes,
  spacing,
  radii,
  borders,
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
  theme,
  compact,
}: {
  icon: string;
  title: string;
  desc: string;
  index: number;
  theme: ReturnType<typeof getTheme>;
  compact: CompactLayoutMetrics;
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
        { backgroundColor: theme.card, borderColor: theme.border },
        theme.shadow,
        {
          gap: compact.isVeryShort ? spacing.md : spacing.lg,
          padding: compact.isVeryShort ? spacing.md : spacing.cardPad,
        },
        { opacity, transform: [{ translateY }, { scale }] },
      ]}
    >
      <View
        style={[
          styles.cardIcon,
          {
            width: compact.isVeryShort ? 44 : 52,
            height: compact.isVeryShort ? 44 : 52,
            borderColor: theme.border,
            backgroundColor: theme.cardAlt,
          },
        ]}
      >
        <Text
          style={[
            styles.cardIconText,
            { fontSize: compact.isVeryShort ? 20 : 24 },
          ]}
        >
          {icon}
        </Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardStep, { color: theme.textMut }]}>{index + 1}.</Text>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{title}</Text>
        </View>
        <Text style={[styles.cardDesc, { color: theme.textSec }]}>{desc}</Text>
      </View>
    </Animated.View>
  );
}

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const compact = useCompactLayout();

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
    <Screen
      scroll
      contentContainerStyle={[
        styles.container,
        {
          paddingHorizontal: compact.horizontalPadding,
          paddingTop: compact.topPadding,
          paddingBottom: spacing["2xl"],
        },
      ]}
    >
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.headerSection,
            { opacity: headerOpacity, transform: [{ translateY: headerY }] },
          ]}
        >
          <Text style={styles.pixelLabel}>LET'S GO</Text>
          <Text
            style={[
              styles.title,
              { color: t.text, fontSize: compact.isVeryShort ? fontSizes.h2 : fontSizes.h2Lg },
            ]}
          >
            Welcome to <Text style={styles.titleAccent}>oneto</Text>
          </Text>
          <Text style={[styles.subtitle, { color: t.textSec }]}>
            Here's how we'll set up your account
          </Text>
        </Animated.View>

        <View
          style={[
            styles.stepsContainer,
            { gap: compact.isVeryShort ? spacing.md : spacing.lg, marginTop: compact.sectionGap },
          ]}
        >
          {STEPS.map((s, i) => (
            <StepCard
              key={i}
              icon={s.icon}
              title={s.title}
              desc={s.desc}
              index={i}
              theme={t}
              compact={compact}
            />
          ))}
        </View>

        <View style={styles.spacer} />

        <Animated.View style={{ opacity: buttonOpacity, width: "100%" }}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              { height: compact.buttonHeight },
              { borderColor: t.border },
              t.shadow,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => router.push("/(onboarding)/pin-setup")}
            accessibilityRole="button"
          >
          <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "stretch",
  },
  headerSection: { alignItems: "center" },
  pixelLabel: { fontFamily: fonts.pixel, fontSize: pixelFontSizes.lg, color: colors.primary, marginBottom: spacing.md },
  title: { fontFamily: fonts.bold, fontSize: fontSizes.h2Lg, textAlign: "center" },
  titleAccent: { color: colors.primary },
  subtitle: { fontFamily: fonts.regular, fontSize: fontSizes.body, marginTop: spacing.sm, textAlign: "center" },
  stepsContainer: {},
  card: {
    flexDirection: "row", alignItems: "center",
    borderWidth: borders.standard,
    borderRadius: radii.xl,
  },
  cardIcon: { borderRadius: radii.lg, borderWidth: borders.medium, alignItems: "center", justifyContent: "center" },
  cardIconText: {},
  cardBody: { flex: 1 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardStep: { fontFamily: fonts.pixel, fontSize: pixelFontSizes.sm },
  cardTitle: { fontFamily: fonts.bold, fontSize: fontSizes.sectionTitle },
  cardDesc: { fontFamily: fonts.regular, fontSize: fontSizes.caption, marginTop: spacing.xs, lineHeight: 18 },
  spacer: { flex: 1 },
  button: { height: 52, backgroundColor: colors.primary, borderRadius: radii.pill, borderWidth: borders.standard, alignItems: "center", justifyContent: "center" },
  buttonPressed: { transform: [{ translateX: 3 }, { translateY: 3 }], shadowOffset: { width: 0, height: 0 } },
  buttonText: { fontFamily: fonts.bold, fontSize: fontSizes.button, color: colors.primaryText },
});
