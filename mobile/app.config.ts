import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "oneto",
  slug: "oneto",
  version: "0.0.1",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "oneto",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.oneto.app",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#ffffff",
    },
    package: "com.oneto.app",
  },
  web: {
    bundler: "metro",
  },
  plugins: ["expo-router", "expo-secure-store", "expo-sqlite"],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
