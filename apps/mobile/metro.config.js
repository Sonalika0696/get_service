// Metro config for an Expo app inside an npm-workspaces monorepo. Watches the
// whole repo so edits in packages/tokens etc. hot-reload; declares BOTH
// candidate node_modules paths so Metro finds workspace-hoisted deps at
// root and workspace-local ones inside apps/mobile.
//
// Hierarchical lookup is intentionally LEFT ON (Metro's default). Turning
// it off is the "safer" monorepo recipe you see in older docs, but it also
// blocks Metro from resolving transitive deps that npm nests under a
// package's own node_modules/ (color -> color-string -> simple-swizzle ->
// is-arrayish is a real case that surfaced with expo-router on SDK 57).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
