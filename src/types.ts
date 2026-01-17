export type LicenseStage = 'infer' | 'embed' | 'tune' | 'train';
export type Distribution = 'private' | 'public';

/**
 * Copyright.sh License Information
 */
export interface LicenseInfo {
  url: string;
  license_found: boolean;
  action: 'allow' | 'deny' | 'unknown';
  distribution?: 'private' | 'public';
  price?: number;  // USD per 1000 tokens
  payto?: string;
  license_version_id?: number;
  license_sig?: string;
  license_type?: string;
  error?: string;
}

/**
 * Token usage log entry
 */
export interface UsageLogEntry {
  url: string;
  tokens: number;
  license_version_id?: number;
  license_sig?: string;
  stage: LicenseStage;
  distribution: Distribution;
  timestamp: string;
}

export interface LedgerAcquireResponse {
  licensed_url: string;
  license_version_id: number;
  license_sig: string;
  expires_at: string;
  cost: number;
  currency: string;
  stage: LicenseStage;
  distribution: Distribution;
  estimated_tokens: number;
  license_status: string;
  rate_per_1k_tokens: number;
}

export interface LicensedFetchResult {
  requested_url: string;
  final_url: string;
  status: number;
  content_type?: string | null;
  content_text?: string;
  payment_attempted: boolean;
  payment_required: boolean;
  x402?: {
    price?: string | null;
    payto?: string | null;
    stage?: string | null;
    distribution?: string | null;
    facilitator_url?: string | null;
  };
  acquire?: {
    licensed_url: string;
    cost: number;
    currency: string;
    expires_at: string;
    license_version_id: number;
    license_sig: string;
  };
  error?: string;
}

/**
 * Enriched search result with license metadata
 */
export interface EnrichedResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
  raw_content?: string;
  favicon?: string;
  fetched?: LicensedFetchResult;

  // Copyright.sh license metadata
  copyright_license?: {
    action: 'allow' | 'deny' | 'unknown';
    distribution?: string;
    price?: number;
    tracked: boolean;  // Whether usage was logged
    license_url?: string;
    error?: string;
    license_type?: string;
  };
}

/**
 * Session-wide license tracking summary
 */
export interface LicenseTrackingSummary {
  total_urls: number;
  licensed_content: number;
  unlicensed_content: number;
  denied_content: number;
  total_tokens: number;
  tracking_enabled: boolean;
  errors: number;
}

/**
 * Tavily API response structures
 */
export interface TavilyResponse {
  query: string;
  follow_up_questions?: Array<string>;
  answer?: string;
  images?: Array<string | {
    url: string;
    description?: string;
  }>;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
    raw_content?: string;
    favicon?: string;
  }>;
}

export interface TavilyCrawlResponse {
  base_url: string;
  results: Array<{
    url: string;
    raw_content: string;
    favicon?: string;
  }>;
  response_time: number;
}

export interface TavilyMapResponse {
  base_url: string;
  results: string[];
  response_time: number;
}

/**
 * Configuration options
 */
export interface LicenseServiceConfig {
  apiUrl: string;
  apiKey?: string;
  licenseCheckTimeout: number;
  licenseAcquireTimeout: number;
  usageLogTimeout: number;
  enableTracking: boolean;
  enableCache: boolean;
  cacheTTL: number;
}
