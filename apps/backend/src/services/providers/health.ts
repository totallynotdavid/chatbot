type ProviderName = "fnb" | "gaso" | "powerbi";

type HealthStatus = {
  status: "healthy" | "blocked";
  lastError: string | null;
  blockedUntil: Date | null;
};

const BLOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

class ProviderHealthService {
  private providers: Map<ProviderName, HealthStatus> = new Map([
    ["fnb", { status: "healthy", lastError: null, blockedUntil: null }],
    ["gaso", { status: "healthy", lastError: null, blockedUntil: null }],
    ["powerbi", { status: "healthy", lastError: null, blockedUntil: null }],
  ]);

  isAvailable(provider: ProviderName): boolean {
    const health = this.providers.get(provider)!;
    if (health.status === "healthy") return true;
    if (health.blockedUntil && new Date() > health.blockedUntil) {
      this.markHealthy(provider);
      return true;
    }
    return false;
  }

  markBlocked(provider: ProviderName, errorMsg: string): void {
    const health = this.providers.get(provider)!;
    const wasHealthy = health.status === "healthy";
    
    health.status = "blocked";
    health.lastError = errorMsg;
    health.blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);

    if (wasHealthy) {
      console.error(`[${provider.toUpperCase()}] BLOCKED for 30min - ${errorMsg}`);
    }
  }

  markHealthy(provider: ProviderName): void {
    const health = this.providers.get(provider)!;
    health.status = "healthy";
    health.lastError = null;
    health.blockedUntil = null;
  }

  getStatus(provider: ProviderName) {
    const health = this.providers.get(provider)!;
    return {
      status: health.status,
      available: this.isAvailable(provider),
      lastError: health.lastError,
      blockedUntil: health.blockedUntil?.toISOString() || null,
    };
  }

  getAllStatus() {
    return {
      fnb: this.getStatus("fnb"),
      gaso: this.getStatus("gaso"),
      powerbi: this.getStatus("powerbi"),
    };
  }
}

export const health = new ProviderHealthService();
