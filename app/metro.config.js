// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite on web ships a wasm build (wa-sqlite) that Metro must treat as an
// asset, served with cross-origin isolation headers for SharedArrayBuffer.
config.resolver.assetExts.push("wasm");
config.server = config.server ?? {};
const prevEnhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const base = prevEnhance ? prevEnhance(middleware, server) : middleware;
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    return base(req, res, next);
  };
};

module.exports = config;
