"use strict";
// Worker V2 Configuration
// Clean, focused configuration for the new worker
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RETRY_ATTEMPTS = exports.HEALTH_CHECK_TIMEOUT = exports.SKIP_HEALTH_CHECK = exports.ADDR_BATCH_LIMIT = exports.REORG_CUSHION = exports.HEADER_SLEEP_MS = exports.DEFAULT_DEX_CHUNK = exports.DEFAULT_CHUNK = exports.ONLY_TOKEN_ID = void 0;
exports.getChunkSize = getChunkSize;
exports.getDexChunkSize = getDexChunkSize;
exports.getSleepMs = getSleepMs;
// Environment variables
exports.ONLY_TOKEN_ID = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : undefined;
// Tunables
exports.DEFAULT_CHUNK = Number(process.env.WORKER_CHUNK ?? 10000);
exports.DEFAULT_DEX_CHUNK = Number(process.env.DEX_CHUNK ?? 500);
exports.HEADER_SLEEP_MS = Number(process.env.WORKER_SLEEP_MS ?? 200);
// Chain-specific rate limiting (configurable via environment variables)
function getChunkSize(chainId) {
    if (chainId === 6342)
        return Number(process.env.MEGAETH_CHUNK ?? 1000); // MegaETH: moderate chunks for balanced processing
    if (chainId === 11155111)
        return Number(process.env.SEPOLIA_CHUNK ?? 5000); // Sepolia: smaller chunks
    return exports.DEFAULT_CHUNK;
}
function getDexChunkSize(chainId) {
    if (chainId === 6342)
        return Number(process.env.MEGAETH_DEX_CHUNK ?? 500); // MegaETH: moderate chunks for balanced processing
    if (chainId === 11155111)
        return Number(process.env.SEPOLIA_DEX_CHUNK ?? 1000); // Sepolia: normal chunks
    return exports.DEFAULT_DEX_CHUNK;
}
function getSleepMs(chainId) {
    if (chainId === 6342)
        return Number(process.env.MEGAETH_SLEEP_MS ?? 3000); // MegaETH: very conservative delays
    if (chainId === 11155111)
        return Number(process.env.SEPOLIA_SLEEP_MS ?? 500); // Sepolia: more conservative delays
    return exports.HEADER_SLEEP_MS;
}
// Other settings
exports.REORG_CUSHION = Math.max(0, Number(process.env.REORG_CUSHION ?? 5));
exports.ADDR_BATCH_LIMIT = Math.max(1, Number(process.env.ADDR_BATCH_LIMIT ?? 200));
exports.SKIP_HEALTH_CHECK = process.env.SKIP_HEALTH_CHECK === 'true';
exports.HEALTH_CHECK_TIMEOUT = Number(process.env.HEALTH_CHECK_TIMEOUT ?? 10000);
// Retry configuration
exports.MAX_RETRY_ATTEMPTS = Math.max(1, Number(process.env.MAX_RETRY_ATTEMPTS ?? 9));
