import { Pressable, StyleSheet, Text, View } from "react-native";
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
  { icon: "🔑", title: "Create a keypair", desc: "A secure signing key is generated on this device — it never leaves your phone" },
  { icon: "🔐", title: "Set a 6-digit PIN", desc: "Your PIN encrypts and protects the key. Only you can unlock it" },
  { icon: "📷", title: "Pay offline", desc: "Scan a merchant QR, confirm with your PIN, and you're done — no internet needed" },
];

export default function WelcomeScreen(): React.ReactElement {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.container}>
        {/* Header text */}
        <View style={styles.headerSection}>
          <Text style={styles.pixelLabel}>LET'S GO</Text>
          <Text style={styles.title}>
            Welcome to <Text style={styles.titleAccent}>oneto</Text>
          </Text>
          <Text style={styles.subtitle}>
            Here's how we'll set up your account
          </Text>
        </View>

        {/* Step cards */}
        <View style={styles.stepsContainer}>
          {STEPS.map((s, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardIcon}>
                <Text style={styles.cardIconText}>{s.icon}</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardStep}>{i + 1}.</Text>
                  <Text style={styles.cardTitle}>{s.title}</Text>
                </View>
                <Text style={styles.cardDesc}>{s.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.spacer} />

        {/* Continue button */}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => router.push("/(onboarding)/pin-setup")}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
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
  },
  headerSection: {
    alignItems: "center",
  },
  pixelLabel: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.lg,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2Lg,
    color: colors.light.text,
    textAlign: "center",
  },
  titleAccent: {
    color: colors.primary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    color: colors.light.textSec,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  stepsContainer: {
    gap: spacing.lg,
    marginTop: spacing["3xl"],
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.light.card,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    borderRadius: radii.xl,
    padding: spacing.cardPad,
    ...shadows.neu.light,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    borderWidth: borders.medium,
    borderColor: colors.light.border,
    backgroundColor: colors.light.cardAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  cardIconText: {
    fontSize: 24,
  },
  cardBody: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardStep: {
    fontFamily: fonts.pixel,
    fontSize: pixelFontSizes.sm,
    color: colors.light.textMut,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.sectionTitle,
    color: colors.light.text,
  },
  cardDesc: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.caption,
    color: colors.light.textSec,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  spacer: {
    flex: 1,
  },
  button: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: borders.standard,
    borderColor: colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.neu.light,
  },
  buttonPressed: {
    transform: [{ translateX: 3 }, { translateY: 3 }],
    shadowOffset: { width: 0, height: 0 },
  },
  buttonText: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
    color: colors.primaryText,
  },
});
