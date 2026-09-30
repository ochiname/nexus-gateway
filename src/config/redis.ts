import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const isCloud = REDIS_URL.includes('upstash.io');

export const redis = new Redis(REDIS_URL, {
  tls: isCloud ? {} : undefined,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 2) return null;
    return Math.min(times * 50, 2000);
  },
});

redis.on('connect', () => {
  console.log('🔴 Connected to Cloud Redis state store successfully.');
});

redis.on('error', (err) => {
  console.error('⚠️ Redis connection warning:', err.message);
});