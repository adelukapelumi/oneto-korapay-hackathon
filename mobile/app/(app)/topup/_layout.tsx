import { Stack } from "expo-router";

export default function TopupLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="amount"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="checkout"
        options={{
          presentation: "modal",
          headerShown: false,
        }}
      />
    </Stack>
  );
}
