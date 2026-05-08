import { Stack } from "expo-router";

export default function PayLayout() {
  return (
    <Stack>
      <Stack.Screen 
        name="scan" 
        options={{ 
          title: "Scan to Pay",
          headerShown: true,
          // Use standard iOS modal presentation for the whole pay flow
          presentation: "modal"
        }} 
      />
      <Stack.Screen 
        name="confirm" 
        options={{ 
          title: "Confirm Payment",
          headerShown: true,
          // Prevent swiping back once we're on the confirm screen (must tap back)
          gestureEnabled: false
        }} 
      />
      <Stack.Screen 
        name="display" 
        options={{ 
          title: "Payment QR",
          headerShown: true,
          // Once signed, no going back to the confirm screen
          headerBackVisible: false,
          gestureEnabled: false
        }} 
      />
    </Stack>
  );
}
