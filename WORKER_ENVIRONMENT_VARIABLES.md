# Worker Environment Variables

This document lists all environment variables that can be used to configure the Turbo Launchpad worker behavior without code changes.

## Rate Limiting Variables

### Global Rate Limiting
| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_CHUNK` | 10000 | Default block chunk size for ERC-20 transfer scanning |
| `DEX_CHUNK` | 500 | Default block chunk size for DEX operations |
| `WORKER_SLEEP_MS` | 200 | Default sleep delay between RPC calls (milliseconds) |

### MegaETH (Chain 6342) Specific
| Variable | Default | Description |
|----------|---------|-------------|
| `MEGAETH_CHUNK` | 2000 | Block chunk size for ERC-20 transfer scanning on MegaETH |
| `MEGAETH_DEX_CHUNK` | 100 | Block chunk size for DEX operations on MegaETH |
| `MEGAETH_SLEEP_MS` | 500 | Sleep delay between RPC calls on MegaETH (milliseconds) |

### Sepolia (Chain 11155111) Specific
| Variable | Default | Description |
|----------|---------|-------------|
| `SEPOLIA_CHUNK` | 20000 | Block chunk size for ERC-20 transfer scanning on Sepolia |
| `SEPOLIA_DEX_CHUNK` | 1000 | Block chunk size for DEX operations on Sepolia |
| `SEPOLIA_SLEEP_MS` | 100 | Sleep delay between RPC calls on Sepolia (milliseconds) |

## Processing Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REORG_CUSHION` | 5 | Number of blocks to re-process to handle chain reorganizations |
| `ADDR_BATCH_LIMIT` | 200 | Maximum number of addresses per getLogs call |
| `TOKEN_ID` | undefined | Process only specific token ID (for debugging) |

## Health Check Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SKIP_HEALTH_CHECK` | false | Skip chain health checks (set to 'true' to enable) |
| `HEALTH_CHECK_TIMEOUT` | 10000 | Health check timeout in milliseconds |

## Usage Examples

### Ultra-Conservative MegaETH Settings
```bash
MEGAETH_CHUNK=1000
MEGAETH_DEX_CHUNK=50
MEGAETH_SLEEP_MS=1000
```

### Aggressive Sepolia Settings
```bash
SEPOLIA_CHUNK=50000
SEPOLIA_DEX_CHUNK=2000
SEPOLIA_SLEEP_MS=50
```

### Skip Health Checks for Faster Startup
```bash
SKIP_HEALTH_CHECK=true
```

### Process Only Specific Token (Debug Mode)
```bash
TOKEN_ID=18
```

### Increase Address Batch Size for Better Performance
```bash
ADDR_BATCH_LIMIT=500
```

## Rate Limiting Strategy

The worker uses a multi-layered rate limiting approach:

1. **Chain-Specific Chunk Sizes**: Different block ranges per chain
2. **Sleep Delays**: Pauses between RPC calls
3. **Exponential Backoff**: Increasing delays on rate limit errors
4. **Retry Logic**: Automatic retries with backoff for failed requests

### Backoff Behavior
- **MegaETH**: 5-30 second backoff on rate limits
- **Sepolia**: 2-10 second backoff on rate limits
- **Max Attempts**: 10 retries per RPC call

## Monitoring

Monitor these logs to tune your settings:
- `Rate limit hit on chain X, retrying in Yms`
- `over compute unit limit` errors
- `CALL_EXCEPTION` errors
- Worker processing speed and completion rates

## Best Practices

1. **Start Conservative**: Begin with default values and increase gradually
2. **Monitor Logs**: Watch for rate limit errors and adjust accordingly
3. **Chain-Specific Tuning**: MegaETH typically needs more conservative settings
4. **Test Changes**: Deploy with new settings and monitor for 1-2 worker runs
5. **Environment-Specific**: Production may need different settings than development
