// Metro config tuned for pnpm workspaces.
//
// pnpm uses symlinks aggressively. Without these tweaks Metro fails to find
// @oneto/shared (or worse, finds it but cannot resolve its transitive deps).
//
// Relevant docs:
//   https://docs.expo.dev/guides/monorepos/
//   https://metrobundler.dev/docs/configuration

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Watch the entire workspace so changes to @oneto/shared trigger reloads.
config.watchFolders = [workspaceRoot];

// Resolve modules from both the local node_modules and the workspace root.
// pnpm hoists some deps; this catches both layouts.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// pnpm relies on symlinks to share packages. Without this, Metro's resolver
// walks up from the symlinked location and misses the real module location.
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
