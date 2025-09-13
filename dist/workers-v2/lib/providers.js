"use strict";
// Shared provider utilities for both frontend and backend
// Centralizes RPC configuration to avoid duplication
Object.defineProperty(exports, "__esModule", { value: true });
exports.rpcByChain = void 0;
exports.providerFor = providerFor;
exports.getRpcUrl = getRpcUrl;
const ethers_1 = require("ethers");
const chains_1 = require("./chains");
// RPCs per chain (prefer env override, fall back to lib/chains)
exports.rpcByChain = {
    6342: process.env.MEGAETH_RPC_URL ?? chains_1.megaethTestnet.rpcUrls.default.http[0],
    9999: process.env.MEGAETH_MAINNET_RPC ?? chains_1.megaethMainnet.rpcUrls.default.http[0],
    11155111: process.env.SEPOLIA_RPC_URL ?? chains_1.sepoliaTestnet.rpcUrls.default.http[0],
};
// Backend provider for workers
function providerFor(chainId) {
    const url = exports.rpcByChain[chainId];
    if (!url)
        throw new Error(`No RPC for chain ${chainId}`);
    return new ethers_1.ethers.JsonRpcProvider(url, { chainId, name: `chain-${chainId}` });
}
// Frontend RPC URLs for Wagmi
function getRpcUrl(chainId) {
    const url = exports.rpcByChain[chainId];
    if (!url)
        throw new Error(`No RPC for chain ${chainId}`);
    return url;
}
