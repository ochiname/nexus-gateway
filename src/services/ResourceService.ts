export class ResourceService {
  public static fetchTieredData(role: string) {
    if (role === 'free') {
      return {
        tier: 'free',
        message: 'Access granted to standard tier resource.',
        data: [
          { id: 1, metric: 'Basic System Load', value: 'Normal' },
          { id: 2, metric: 'Active Nodes', value: 2 }
        ],
        upgradePrompt: 'Upgrade to Enterprise to unlock full analytics data dumps and higher rate limits.'
      };
    }

    // Enterprise full data dump
    return {
      tier: 'enterprise',
      message: 'Access granted to full enterprise resource data dump.',
      metadata: {
        totalRecords: 10,
        exportFormat: 'json',
        securityStatus: 'WAF Verified',
        generatedAt: new Date().toISOString()
      },
      data: Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
        nodeName: `Enterprise-Edge-Node-0${index + 1}`,
        latencyMs: Math.floor(Math.random() * 25) + 5,
        throughputRps: Math.floor(Math.random() * 5000) + 1000,
        healthStatus: 'Optimal',
        logs: ['Proxy verified', 'Cache hit: true', 'Rate limit quota: healthy']
      }))
    };
  }
}