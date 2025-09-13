"use strict";
// Rate limiting utilities for Worker V2
// Clean, focused rate limiting with chain-specific backoff
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = sleep;
exports.isRateLimit = isRateLimit;
exports.withRateLimit = withRateLimit;
const config_1 = require("./config");
function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}
function isRateLimit(e) {
    const error = e;
    const code = error?.code ?? error?.error?.code;
    const msg = (error?.message ?? error?.error?.message ?? '').toLowerCase();
    return code === -32016 || code === -32822 || msg.includes('rate limit') || msg.includes('over compute unit limit');
}
async function withRateLimit(rpcCall, maxAttempts = 2, chainId) {
    let attempts = 0;
    while (true) {
        try {
            const result = await rpcCall();
            const sleepMs = chainId ? (0, config_1.getSleepMs)(chainId) : 200;
            await sleep(sleepMs);
            return result;
        }
        catch (e) {
            attempts++;
            if (isRateLimit(e) && attempts <= maxAttempts) {
                // 2000ms delay, max 2 attempts
                const backoff = 2000;
                console.log(`Rate limit hit on chain ${chainId}, retrying in ${backoff}ms (attempt ${attempts}/${maxAttempts})`);
                await sleep(backoff);
                continue;
            }
            throw e;
        }
    }
}
