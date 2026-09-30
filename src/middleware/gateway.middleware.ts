import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { redis } from '../config/redis';
import dotenv from 'dotenv';

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

const tokenBucketLua = `
local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last_updated')
local tokens = tonumber(data[1])
local last_updated = tonumber(data[2])

if tokens == nil then
    tokens = max_tokens
    last_updated = now
else
    local elapsed = now - last_updated
    local generated = elapsed * refill_rate
    tokens = math.min(max_tokens, tokens + generated)
    last_updated = now
end

if tokens < requested then
    return {0, tokens}
else
    tokens = tokens - requested
    redis.call('HMSET', key, 'tokens', tokens, 'last_updated', last_updated)
    redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate))
    return {1, tokens}
end
`;

export async function gatewaySecurityMiddleware(req: Request, res: Response, next: NextFunction) {
  // Ensure req.body exists (safeguard for GET requests which don't parse a body by default)
  if (!req.body) {
    req.body = {};
  }

  const startTime = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  const traceSteps: any[] = [];

  try {
    // Step 1: Extract and Verify JWT Token to determine Tier
    let tier = 'free';
    const authHeader = req.headers['authorization'];
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        tier = decoded.tier || 'free';
        traceSteps.push({ step: 'JWT Verification', status: `Valid (${tier.toUpperCase()} Tier)`, latencyMs: Date.now() - startTime });
      } catch (err) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired access token.' });
      }
    } else {
      traceSteps.push({ step: 'JWT Verification', status: 'Missing token, defaulting to Free tier', latencyMs: Date.now() - startTime });
    }

    // Step 2: Check IP Blacklist in Cloud Redis
    const isBlacklisted = await redis.sismember('blacklist:ips', clientIp);
    if (isBlacklisted) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your IP address has been blacklisted due to suspicious activity.'
      });
    }
    traceSteps.push({ step: 'IP Blacklist Check', status: 'Clean', latencyMs: Date.now() - startTime });

    // Step 3: Tier Scope & Rate Limits Allocation (Enterprise = 100 tokens, Free = 5 tokens)
    const maxTokens = tier === 'enterprise' ? 100 : 5;
    const refillRate = tier === 'enterprise' ? 1.66 : 0.083;
    
    // Keying by token identifier or IP + tier combination
    const rateLimitKey = `limit:token:${clientIp}:${tier}`;

    // Step 4: Execute Redis Lua Rate Limiter Script atomically
    const now = Math.floor(Date.now() / 1000);
    const luaResult = (await redis.eval(
      tokenBucketLua,
      1,
      rateLimitKey,
      maxTokens,
      refillRate,
      now,
      1
    )) as [number, number];

    const allowed = luaResult[0] === 1;
    const tokensRemaining = Math.floor(luaResult[1]);

    traceSteps.push({ 
      step: 'Redis Token-Bucket Check', 
      status: allowed ? `Allowed (Tokens left: ${tokensRemaining})` : 'Rate limit exceeded', 
      latencyMs: Date.now() - startTime 
    });

    if (!allowed) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit threshold reached. Try again shortly.',
        tier,
        retryAfter: 30
      });
    }

    // Attach trace metadata to response body for testing visibility
    req.body.traceSteps = traceSteps;
    next();
  } catch (err: any) {
    // Fail-open circuit breaker pattern: if cloud Redis hiccups, keep the gateway open
    console.error('Gateway Middleware Error (Fail-Open Triggered):', err.message);
    next();
  }
}