import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Screen } from "../../components/Screen";
import { NetworkError } from "../../src/api/errors";
import {
  createSupportTicket,
  type SupportTicketCategory,
} from "../../src/api/support";
import {
  DASHBOARD_SUPPORT_LABEL,
  SUPPORT_CONFIRMATION_LINES,
  SUPPORT_TICKET_CATEGORIES,
} from "../../src/support/support-ui";
import { useThemeMode } from "../../src/theme/theme-provider";
import {
  borders,
  colors,
  fontSizes,
  fonts,
  getTheme,
  radii,
  spacing,
} from "../../src/theme/tokens";

export default function SupportScreen(): React.ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);
  const [category, setCategory] = useState<SupportTicketCategory>("OTHER");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await createSupportTicket({
        category,
        subject: subject.trim(),
        message: message.trim(),
      });
      setTicketNumber(result.ticketNumber);
      setSubject("");
      setMessage("");
      setCategory("OTHER");
    } catch (err) {
      if (err instanceof NetworkError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Couldn't submit your support request. Try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Screen scroll keyboard contentContainerStyle={styles.content}>
      <View style={styles.container}>
        <View style={[styles.heroCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={styles.eyebrow}>SUPPORT</Text>
          <Text style={[styles.title, { color: t.text }]}>{DASHBOARD_SUPPORT_LABEL}</Text>
          <Text style={[styles.body, { color: t.textSec }]}>
            Tell us what went wrong and Oneto Support will review it by email.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: t.text }]}>Category</Text>
          <View style={styles.chipWrap}>
            {SUPPORT_TICKET_CATEGORIES.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                onPress={() => setCategory(option.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: category === option.value ? colors.secondary : t.cardAlt,
                    borderColor: category === option.value ? colors.secondary : t.border,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: category === option.value ? "#1B1208" : t.text }]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <InputField label="Subject" value={subject} onChangeText={setSubject} />
        <InputField
          label="Message"
          value={message}
          onChangeText={setMessage}
          multiline
        />

        {ticketNumber ? (
          <View style={[styles.noticeCard, { backgroundColor: t.cardAlt, borderColor: t.border }]}>
            <Text style={[styles.noticeTitle, { color: t.text }]}>Ticket submitted</Text>
            <Text style={[styles.noticeBody, { color: t.textSec }]}>
              Ticket number: {ticketNumber}
            </Text>
            {SUPPORT_CONFIRMATION_LINES.map((line) => (
              <Text key={line} style={[styles.noticeBody, { color: t.textSec }]}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() => {
            void submit();
          }}
          style={({ pressed }) => [
            styles.submitButton,
            pressed && !isSubmitting && styles.submitButtonPressed,
            isSubmitting && styles.submitButtonDisabled,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.primaryText} />
          ) : (
            <Text style={styles.submitButtonText}>Send support request</Text>
          )}
        </Pressable>
      </View>
    </Screen>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  multiline = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly multiline?: boolean;
}): React.ReactElement {
  const { mode } = useThemeMode();
  const t = getTheme(mode);

  return (
    <View style={styles.inputWrap}>
      <Text style={[styles.inputLabel, { color: t.textSec }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          {
            color: t.text,
            backgroundColor: t.inputBg,
            borderColor: t.border,
            minHeight: multiline ? 140 : 52,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  container: {
    gap: spacing.lg,
  },
  heroCard: {
    borderWidth: borders.standard,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  eyebrow: {
    fontFamily: fonts.pixel,
    fontSize: fontSizes.sm,
    color: colors.primary,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.h2,
    lineHeight: 34,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 24,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    borderWidth: borders.standard,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
  },
  inputWrap: {
    gap: spacing.xs,
  },
  inputLabel: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.sm,
  },
  input: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
  },
  noticeCard: {
    borderWidth: borders.standard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  noticeTitle: {
    fontFamily: fonts.bold,
    fontSize: fontSizes.bodyLg,
  },
  noticeBody: {
    fontFamily: fonts.regular,
    fontSize: fontSizes.body,
    lineHeight: 22,
  },
  error: {
    color: colors.error,
    fontFamily: fonts.semibold,
    fontSize: fontSizes.sm,
    textAlign: "center",
  },
  submitButton: {
    minHeight: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xl,
  },
  submitButtonPressed: {
    opacity: 0.92,
    transform: [{ translateY: 1 }],
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: colors.primaryText,
    fontFamily: fonts.bold,
    fontSize: fontSizes.button,
  },
});
