import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken'; 
import { AuthService } from './services/AuthService';
import { ResourceService } from './services/ResourceService';
import { gatewaySecurityMiddleware } from './middleware/gateway.middleware';
import { redis } from './config/redis'; // Make sure this points to your shared redis client config

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// 1. Configure trust proxy early so Express handles client IPs correctly from the start
app.set('trust proxy', 1);

app.use(express.json());
app.use(cors());

let activeConnections = 0;
const GLOBAL_CONCURRENCY_LIMIT = parseInt(process.env.GLOBAL_CONCURRENCY_LIMIT || '2000', 10);

app.use((req: Request, res: Response, next: Function) => {
  if (activeConnections >= GLOBAL_CONCURRENCY_LIMIT) {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'Server is experiencing high traffic volume. Please try again shortly.'
    });
  }

  activeConnections++;
  res.on('finish', () => {
    activeConnections--;
  });

  next();
});

// 2. Authentication Route (Issues JWT for free or enterprise mock users)
app.post('/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  const authResult = AuthService.authenticate(username, password);

  if (!authResult) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid username or password.'
    });
  }

  return res.status(200).json({
    message: 'Login successful',
    ...authResult
  });
});

// 3. Tier-Gated Resource Route with Redis Response Caching & Trace Steps
app.get('/api/v1/resource', gatewaySecurityMiddleware, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const traceSteps = req.body.traceSteps || [];

  const authHeader = req.headers['authorization'];
  let tier = 'free';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
      tier = decoded.tier || decoded.role || 'free';
    } catch (e) {}
  }

  const cacheKey = `cache:resource:${tier}`;

  try {
    // Step 5 Check: Try fetching from Redis response cache
    const cachedResponse = await redis.get(cacheKey);

    if (cachedResponse) {
      traceSteps.push({
        step: 'Redis Response Cache',
        status: 'Cache Hit (Served from memory in <2ms)',
        latencyMs: Date.now() - startTime
      });

      const parsedData = JSON.parse(cachedResponse);
      return res.status(200).json({
        traceSteps,
        cacheStatus: 'HIT',
        ...parsedData
      });
    }

    // Cache Miss: Generate data via ResourceService
    const responseData = ResourceService.fetchTieredData(tier);

    // Save response into Redis cache with a 30-second TTL
    await redis.setex(cacheKey, 30, JSON.stringify(responseData));

    traceSteps.push({
      step: 'Redis Response Cache',
      status: 'Cache Miss (Generated & Cached for 30s)',
      latencyMs: Date.now() - startTime
    });

    return res.status(200).json({
      traceSteps,
      cacheStatus: 'MISS',
      ...responseData
    });

  } catch (err: any) {
    // Fail-open cache fallback if cache layer encounters an issue
    console.error('Cache Layer Error (Bypassing Cache):', err.message);
    const responseData = ResourceService.fetchTieredData(tier);
    return res.status(200).json({
      traceSteps,
      cacheStatus: 'BYPASSED_ERROR',
      ...responseData
    });
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'online',
    activeConnections,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 NexusGateway running on port ${PORT}`);
});