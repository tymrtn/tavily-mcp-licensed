import type { Distribution, LicenseStage, LicensedFetchResult } from '../types.js';
import { LicenseService } from './license-service.js';

function parseStage(value: string | null | undefined, fallback: LicenseStage): LicenseStage {
  if (value === 'infer' || value === 'embed' || value === 'tune' || value === 'train') return value;
  if (value === 'default') return fallback;
  return fallback;
}

function parseDistribution(value: string | null | undefined, fallback: Distribution): Distribution {
  if (value === 'private' || value === 'public') return value;
  return fallback;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function licensedFetchText(
  url: string,
  opts: {
    ledger: LicenseService;
    stage?: LicenseStage;
    distribution?: Distribution;
    estimatedTokens?: number;
    paymentMethod?: 'account_balance' | 'x402';
    fetchTimeoutMs?: number;
    userAgent?: string;
    maxChars?: number;
  }
): Promise<LicensedFetchResult> {
  const stage = opts.stage ?? 'infer';
  const distribution = opts.distribution ?? 'private';
  const estimatedTokens = opts.estimatedTokens ?? 1500;
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? parseInt(process.env.FETCH_TIMEOUT_MS || '12000', 10);
  const userAgent = opts.userAgent ?? 'Copyright.sh Licensed Fetcher (x402)';
  const maxChars = opts.maxChars ?? 200_000;

  const init: RequestInit = {
    headers: {
      'user-agent': userAgent,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow'
  };

  let first: Response;
  try {
    first = await fetchWithTimeout(url, init, fetchTimeoutMs);
  } catch (error: any) {
    return {
      requested_url: url,
      final_url: url,
      status: 0,
      payment_attempted: false,
      payment_required: false,
      error: error?.message || String(error)
    };
  }

  const firstUrl = first.url || url;
  const contentType = first.headers.get('content-type');

  if (first.status !== 402) {
    const text = await first.text().catch(() => '');
    return {
      requested_url: url,
      final_url: firstUrl,
      status: first.status,
      content_type: contentType,
      content_text: text.slice(0, maxChars),
      payment_attempted: false,
      payment_required: false
    };
  }

  const paymentRequiredHeader = first.headers.get('payment-required');
  const paymentProtocolHeader = first.headers.get('x-payment-protocol');
  const isX402 =
    (paymentRequiredHeader || '').toLowerCase().includes('x402') ||
    (paymentProtocolHeader || '').toLowerCase().includes('x402');

  const x402 = {
    price: first.headers.get('x402-price') || first.headers.get('x-license-price'),
    payto: first.headers.get('x402-payto') || first.headers.get('x-license-payto'),
    stage: first.headers.get('x402-stage'),
    distribution: first.headers.get('x402-distribution') || first.headers.get('x-license-distribution'),
    facilitator_url: first.headers.get('x402-facilitator-url')
  };

  if (!isX402) {
    const body = await first.text().catch(() => '');
    return {
      requested_url: url,
      final_url: firstUrl,
      status: first.status,
      content_type: contentType,
      content_text: body.slice(0, maxChars),
      payment_attempted: false,
      payment_required: true,
      x402,
      error: 'HTTP 402 received but did not advertise x402 in payment-required header'
    };
  }

  try {
    const acquire = await opts.ledger.acquireLicenseToken({
      url,
      stage: parseStage(x402.stage, stage),
      distribution: parseDistribution(x402.distribution, distribution),
      estimatedTokens,
      paymentMethod: opts.paymentMethod ?? 'account_balance'
    });

    const second = await fetchWithTimeout(acquire.licensed_url, init, fetchTimeoutMs);
    const secondText = await second.text().catch(() => '');

    return {
      requested_url: url,
      final_url: second.url || acquire.licensed_url,
      status: second.status,
      content_type: second.headers.get('content-type'),
      content_text: secondText.slice(0, maxChars),
      payment_attempted: true,
      payment_required: true,
      x402,
      acquire: {
        licensed_url: acquire.licensed_url,
        cost: acquire.cost,
        currency: acquire.currency,
        expires_at: acquire.expires_at,
        license_version_id: acquire.license_version_id,
        license_sig: acquire.license_sig
      }
    };
  } catch (error: any) {
    const body = await first.text().catch(() => '');
    return {
      requested_url: url,
      final_url: firstUrl,
      status: first.status,
      content_type: contentType,
      content_text: body.slice(0, maxChars),
      payment_attempted: true,
      payment_required: true,
      x402,
      error: error?.message || String(error)
    };
  }
}
