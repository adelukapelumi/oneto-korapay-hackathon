import type { ExpoConfig } from "expo/config";

const buildProfile =
  process.env.EAS_BUILD_PROFILE ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
const isProductionBuild = buildProfile === "production";

function getPinnedApiHostname(): string | null {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl) {
    return null;
  }

  try {
    return new URL(apiUrl).hostname;
  } catch {
    return null;
  }
}

function getSslPinHashes(): string[] {
  return [
    process.env.API_SSL_PIN_PRIMARY,
    process.env.API_SSL_PIN_BACKUP,
    process.env.API_SSL_PIN_EXTRA,
  ]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);
}

const pinnedApiHostname = getPinnedApiHostname();
const sslPinHashes = getSslPinHashes();

if (isProductionBuild && (!pinnedApiHostname || sslPinHashes.length < 2)) {
  throw new Error(
    "Production builds require SSL pinning. Set EXPO_PUBLIC_API_URL plus at least API_SSL_PIN_PRIMARY and API_SSL_PIN_BACKUP.",
  );
}

const securityPlugins: NonNullable<ExpoConfig["plugins"]> =
  pinnedApiHostname && sslPinHashes.length >= 2
    ? [
        [
          "@bam.tech/react-native-app-security",
          {
            sslPinning: {
              [pinnedApiHostname]: sslPinHashes,
            },
          },
        ],
      ]
    : [];

const config: ExpoConfig = {
  name: "oneto",
  slug: "oneto",
  version: "0.0.1",
  orientation: "portrait",
  icon: "./assets/icon.jpg",
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
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    ...securityPlugins,
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "5c9e1e6e-8718-4049-a2cc-7c3aff2296b8",
    },
  },
};

export default config;
