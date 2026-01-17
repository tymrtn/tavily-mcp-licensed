#!/usr/bin/env node

import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { encoding_for_model } from 'tiktoken';
import type {
  LicenseInfo,
  UsageLogEntry,
  LicenseServiceConfig,
  LicenseTrackingSummary,
  LedgerAcquireResponse,
  LicenseStage,
  Distribution
} from '../types.js';

/**
 * Copyright.sh License Service
 *
 * Handles automatic license discovery and token usage tracking for web content.
 * Integrates with Copyright.sh AI License Ledger API.
 */
export class LicenseService {
  private axiosInstance: AxiosInstance;
  private config: LicenseServiceConfig;
  private tokenEncoder: any;
  private licenseCache: Map<string, { license: LicenseInfo; expires: number }>;
  private sessionSummary: LicenseTrackingSummary;

  constructor(config: Partial<LicenseServiceConfig> = {}) {
    this.config = {
      apiUrl: process.env.COPYRIGHTSH_LEDGER_API || 'https://ledger.copyright.sh',
      apiKey: process.env.COPYRIGHTSH_LEDGER_API_KEY,
      licenseCheckTimeout: parseInt(process.env.LICENSE_CHECK_TIMEOUT_MS || '5000'),
      licenseAcquireTimeout: parseInt(process.env.LICENSE_ACQUIRE_TIMEOUT_MS || '8000'),
      usageLogTimeout: parseInt(process.env.USAGE_LOG_TIMEOUT_MS || '3000'),
      enableTracking: process.env.ENABLE_LICENSE_TRACKING !== 'false',
      enableCache: process.env.ENABLE_LICENSE_CACHE === 'true',
      cacheTTL: parseInt(process.env.LICENSE_CACHE_TTL_SECONDS || '300'),
      ...config
    };

    // Create HTTPS agent that accepts self-signed certificates for DDEV
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false  // Accept self-signed certificates
    });

    this.axiosInstance = axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'X-API-Key': this.config.apiKey })
      },
      httpsAgent  // Use custom HTTPS agent
    });

    // Initialize tiktoken for accurate token counting (GPT-4 encoding)
    try {
      this.tokenEncoder = encoding_for_model('gpt-4');
    } catch (error) {
      console.error('[LicenseService] Failed to initialize tiktoken, falling back to estimate:', error);
      this.tokenEncoder = null;
    }

    this.licenseCache = new Map();
    this.sessionSummary = {
      total_urls: 0,
      licensed_content: 0,
      unlicensed_content: 0,
      denied_content: 0,
      total_tokens: 0,
      tracking_enabled: this.config.enableTracking,
      errors: 0
    };

    console.error('[LicenseService] Initialized with config:', {
      apiUrl: this.config.apiUrl,
      trackingEnabled: this.config.enableTracking,
      cacheEnabled: this.config.enableCache,
      hasApiKey: !!this.config.apiKey,
      apiKeyPrefix: this.config.apiKey ? this.config.apiKey.substring(0, 10) + '...' : 'MISSING'
    });
  }

  /**
   * Check license for a given URL
   */
  async checkLicense(url: string): Promise<LicenseInfo> {
    if (!this.config.enableTracking) {
      return {
        url,
        license_found: false,
        action: 'unknown'
      };
    }

    // Check cache first
    if (this.config.enableCache) {
      const cached = this.licenseCache.get(url);
      if (cached && cached.expires > Date.now()) {
        console.error(`[LicenseService] Cache hit for ${url}`);
        return cached.license;
      }
    }

    try {
      const response = await this.axiosInstance.get('/api/v1/licenses/', {
        params: { url },
        timeout: this.config.licenseCheckTimeout,
        headers: {
          'X-API-Key': this.config.apiKey
        }
      });

      // API returns array of licenses (one per stage), get the first one or general license
      const licenseArray = Array.isArray(response.data) ? response.data : [response.data];

      if (licenseArray.length === 0) {
        return {
          url,
          license_found: false,
          action: 'unknown'
        };
      }

      // Prefer the general 'ai-license' type, or take the first one
      const licenseData = licenseArray.find((l: any) => l.license_type === 'ai-license') || licenseArray[0];

      const optStatus = licenseData.opt_in_status;
      const found = optStatus === 'opt-in' || optStatus === 'opt-out';
      const action: 'allow' | 'deny' | 'unknown' =
        optStatus === 'opt-in' ? 'allow' : optStatus === 'opt-out' ? 'deny' : 'unknown';

      const license: LicenseInfo = {
        url,
        license_found: found,
        action,
        price: licenseData.rate_per_token,
        payto: licenseData.wallet_id,
        license_version_id: licenseData.id,
        license_sig: undefined,
        license_type: licenseData.license_type
      };

      // Cache the result
      if (this.config.enableCache) {
        this.licenseCache.set(url, {
          license,
          expires: Date.now() + (this.config.cacheTTL * 1000)
        });
      }

      // Update session summary
      this.sessionSummary.total_urls++;
      if (license.license_found) {
        if (license.action === 'deny') {
          this.sessionSummary.denied_content++;
        } else {
          this.sessionSummary.licensed_content++;
        }
      } else {
        this.sessionSummary.unlicensed_content++;
      }

      console.error(`[LicenseService] License check for ${url}: ${license.action} (${license.license_found ? 'licensed' : 'unlicensed'})`);
      return license;

    } catch (error: any) {
      console.error(`[LicenseService] License check failed for ${url}:`, error.message);
      this.sessionSummary.errors++;

      return {
        url,
        license_found: false,
        action: 'unknown',
        error: error.message
      };
    }
  }

  async acquireLicenseToken(params: {
    url: string;
    stage: LicenseStage;
    distribution: Distribution;
    estimatedTokens: number;
    paymentMethod: 'account_balance' | 'x402';
    paymentProof?: string;
    paymentAmount?: number;
  }): Promise<LedgerAcquireResponse> {
    if (!this.config.apiKey) {
      throw new Error('COPYRIGHTSH_LEDGER_API_KEY is required for /api/v1/licenses/acquire');
    }

    const body = {
      url: params.url,
      estimated_tokens: params.estimatedTokens,
      stage: params.stage,
      distribution: params.distribution,
      payment_method: params.paymentMethod,
      payment_proof: params.paymentProof,
      payment_amount: params.paymentAmount
    };

    const response = await this.axiosInstance.post('/api/v1/licenses/acquire', body, {
      timeout: this.config.licenseAcquireTimeout,
      headers: {
        'X-API-Key': this.config.apiKey
      }
    });

    return response.data as LedgerAcquireResponse;
  }

  /**
   * Estimate token count for content using tiktoken
   */
  estimateTokens(content: string): number {
    if (!content) return 0;

    try {
      if (this.tokenEncoder) {
        const tokens = this.tokenEncoder.encode(content);
        return tokens.length;
      }
    } catch (error) {
      console.error('[LicenseService] Token encoding failed:', error);
    }

    // Fallback: rough estimate (1 token ≈ 4 characters for English text)
    return Math.ceil(content.length / 4);
  }

  /**
   * Log token usage to Copyright.sh ledger
   */
  async logUsage(
    url: string,
    tokens: number,
    license: LicenseInfo,
    stage: 'infer' | 'embed' | 'tune' | 'train' = 'infer',
    distribution: 'private' | 'public' = 'private'
  ): Promise<boolean> {
    if (!this.config.enableTracking || !this.config.apiKey) {
      console.error('[LicenseService] Usage logging disabled (no API key or tracking disabled)');
      return false;
    }

    if (tokens === 0) {
      console.error(`[LicenseService] Skipping usage log for ${url} (zero tokens)`);
      return false;
    }

    const usageLog: UsageLogEntry = {
      url,
      tokens,
      license_version_id: license.license_version_id,
      license_sig: license.license_sig,
      stage,
      distribution,
      timestamp: new Date().toISOString()
    };

    try {
      await this.axiosInstance.post('/api/v1/usage/log', usageLog, {
        timeout: this.config.usageLogTimeout,
        headers: {
          'X-API-Key': this.config.apiKey
        }
      });

      this.sessionSummary.total_tokens += tokens;
      console.error(`[LicenseService] Logged ${tokens} tokens for ${url}`);
      return true;

    } catch (error: any) {
      console.error(`[LicenseService] Usage logging failed for ${url}:`, error.message);
      this.sessionSummary.errors++;
      return false;
    }
  }

  /**
   * Batch check licenses for multiple URLs (parallel)
   */
  async checkLicenseBatch(urls: string[]): Promise<Map<string, LicenseInfo>> {
    const results = new Map<string, LicenseInfo>();

    if (urls.length === 0) return results;

    console.error(`[LicenseService] Batch checking licenses for ${urls.length} URLs`);

    const promises = urls.map(url =>
      this.checkLicense(url)
        .then(license => results.set(url, license))
        .catch(error => {
          console.error(`[LicenseService] Batch check failed for ${url}:`, error);
          results.set(url, {
            url,
            license_found: false,
            action: 'unknown',
            error: error.message
          });
        })
    );

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Get session tracking summary
   */
  getSessionSummary(): LicenseTrackingSummary {
    return { ...this.sessionSummary };
  }

  /**
   * Reset session tracking
   */
  resetSession(): void {
    this.sessionSummary = {
      total_urls: 0,
      licensed_content: 0,
      unlicensed_content: 0,
      denied_content: 0,
      total_tokens: 0,
      tracking_enabled: this.config.enableTracking,
      errors: 0
    };
    console.error('[LicenseService] Session reset');
  }

  /**
   * Format license info for display
   */
  formatLicenseInfo(license: LicenseInfo, tokens: number = 0): string {
    if (!license.license_found) {
      return `📜 License: Unknown (content used best-effort)`;
    }

    const parts: string[] = [];

    // Action
    const actionEmoji = license.action === 'allow' ? '✅' : license.action === 'deny' ? '🚫' : '❓';
    parts.push(`${actionEmoji} ${license.action.toUpperCase()}`);

    // Distribution
    if (license.distribution) {
      parts.push(`${license.distribution} use`);
    }

    // Price
    if (license.price !== undefined && license.price > 0) {
      parts.push(`$${license.price.toFixed(2)}/1K tokens`);
    } else if (license.price === 0) {
      parts.push('Free');
    }

    // Tracking status
    const tracked = license.license_version_id ? '✓' : '✗';
    parts.push(`Tracked ${tracked}`);

    if (license.license_type) {
      parts.push(`Source ${license.license_type}`);
    }

    // Token count
    if (tokens > 0) {
      parts.push(`(~${tokens} tokens)`);
    }

    return `📜 License: ${parts.join(' | ')}`;
  }

  /**
   * Format session summary for display
   */
  formatSessionSummary(): string {
    const summary = this.sessionSummary;
    const lines: string[] = [
      '',
      '📊 License Tracking Summary:',
      `- Total URLs processed: ${summary.total_urls}`,
      `- Licensed content: ${summary.licensed_content}`,
      `- Unlicensed content: ${summary.unlicensed_content}`,
      `- Denied content: ${summary.denied_content}`,
      `- Total tokens tracked: ${summary.total_tokens.toLocaleString()}`,
      `- Tracking enabled: ${summary.tracking_enabled ? 'Yes' : 'No'}`,
    ];

    if (summary.errors > 0) {
      lines.push(`- Errors: ${summary.errors} (check logs)`);
    }

    return lines.join('\n');
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.tokenEncoder) {
      try {
        this.tokenEncoder.free();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.licenseCache.clear();
  }
}

// Singleton instance for the service
let licenseServiceInstance: LicenseService | null = null;

export function getLicenseService(): LicenseService {
  if (!licenseServiceInstance) {
    licenseServiceInstance = new LicenseService();
  }
  return licenseServiceInstance;
}

export function resetLicenseService(): void {
  if (licenseServiceInstance) {
    licenseServiceInstance.cleanup();
    licenseServiceInstance = null;
  }
}
