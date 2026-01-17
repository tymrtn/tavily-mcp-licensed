#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { LicenseService } from "./services/license-service.js";
import { licensedFetchText } from "./services/licensed-fetcher.js";
import type {
  TavilyResponse,
  TavilyCrawlResponse,
  TavilyMapResponse,
  LicenseStage,
  Distribution,
  LicensedFetchResult,
  LicenseInfo
} from "./types.js";

dotenv.config();

const API_KEY = process.env.TAVILY_API_KEY;
if (!API_KEY) {
  throw new Error("TAVILY_API_KEY environment variable is required");
}

class TavilyClient {
  private server: Server;
  private axiosInstance;
  private licenseService: LicenseService;
  private baseURLs = {
    search: "https://api.tavily.com/search",
    extract: "https://api.tavily.com/extract",
    crawl: "https://api.tavily.com/crawl",
    map: "https://api.tavily.com/map"
  };

  constructor() {
    this.server = new Server(
      {
        name: "tavily-mcp-licensed",
        version: "0.2.12",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "X-Client-Source": "MCP"
      }
    });

    this.licenseService = new LicenseService();

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    const shutdown = async () => {
      this.licenseService.cleanup();
      await this.server.close();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  private getDefaultParameters(): Record<string, any> {
    try {
      const parametersEnv = process.env.DEFAULT_PARAMETERS;

      if (!parametersEnv) {
        return {};
      }

      const defaults = JSON.parse(parametersEnv);

      if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
        console.warn(`DEFAULT_PARAMETERS is not a valid JSON object: ${parametersEnv}`);
        return {};
      }

      return defaults;
    } catch (error: any) {
      console.warn(`Failed to parse DEFAULT_PARAMETERS as JSON: ${error.message}`);
      return {};
    }
  }

  private setupHandlers(): void {
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: "tavily-search",
          description: "A powerful web search tool that provides comprehensive, real-time results using Tavily's AI search engine. Includes optional Copyright.sh license discovery, usage logging, and x402-aware fetch.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query"
              },
              search_depth: {
                type: "string",
                enum: ["basic", "advanced", "fast", "ultra-fast"],
                description: "The depth of the search. 'basic' for generic results, 'advanced' for more thorough search, 'fast' for optimized low latency with high relevance, 'ultra-fast' for prioritizing latency above all else",
                default: "basic"
              },
              topic: {
                type: "string",
                enum: ["general", "news"],
                description: "The category of the search. This will determine which of our agents will be used for the search",
                default: "general"
              },
              days: {
                type: "number",
                description: "The number of days back from the current date to include in the search results. This specifies the time frame of data to be retrieved. Please note that this feature is only available when using the 'news' search topic",
                default: 3
              },
              time_range: {
                type: "string",
                description: "The time range back from the current date to include in the search results. This feature is available for both 'general' and 'news' search topics",
                enum: ["day", "week", "month", "year", "d", "w", "m", "y"],
              },
              start_date: {
                type: "string",
                description: "Will return all results after the specified start date. Required to be written in the format YYYY-MM-DD.",
                default: "",
              },
              end_date: {
                type: "string",
                description: "Will return all results before the specified end date. Required to be written in the format YYYY-MM-DD",
                default: "",
              },
              max_results: {
                type: "number",
                description: "The maximum number of search results to return",
                default: 10,
                minimum: 5,
                maximum: 20
              },
              include_images: {
                type: "boolean",
                description: "Include a list of query-related images in the response",
                default: false,
              },
              include_image_descriptions: {
                type: "boolean",
                description: "Include a list of query-related images and their descriptions in the response",
                default: false,
              },
              include_raw_content: {
                type: "boolean",
                description: "Include the cleaned and parsed HTML content of each search result",
                default: false,
              },
              include_domains: {
                type: "array",
                items: { type: "string" },
                description: "A list of domains to specifically include in the search results, if the user asks to search on specific sites set this to the domain of the site",
                default: []
              },
              exclude_domains: {
                type: "array",
                items: { type: "string" },
                description: "List of domains to specifically exclude, if the user asks to exclude a domain set this to the domain of the site",
                default: []
              },
              country: {
                type: "string",
                enum: ["afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia", "australia", "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus", "belgium", "belize", "benin", "bhutan", "bolivia", "bosnia and herzegovina", "botswana", "brazil", "brunei", "bulgaria", "burkina faso", "burundi", "cambodia", "cameroon", "canada", "cape verde", "central african republic", "chad", "chile", "china", "colombia", "comoros", "congo", "costa rica", "croatia", "cuba", "cyprus", "czech republic", "denmark", "djibouti", "dominican republic", "ecuador", "egypt", "el salvador", "equatorial guinea", "eritrea", "estonia", "ethiopia", "fiji", "finland", "france", "gabon", "gambia", "georgia", "germany", "ghana", "greece", "guatemala", "guinea", "haiti", "honduras", "hungary", "iceland", "india", "indonesia", "iran", "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan", "kenya", "kuwait", "kyrgyzstan", "latvia", "lebanon", "lesotho", "liberia", "libya", "liechtenstein", "lithuania", "luxembourg", "madagascar", "malawi", "malaysia", "maldives", "mali", "malta", "mauritania", "mauritius", "mexico", "moldova", "monaco", "mongolia", "montenegro", "morocco", "mozambique", "myanmar", "namibia", "nepal", "netherlands", "new zealand", "nicaragua", "niger", "nigeria", "north korea", "north macedonia", "norway", "oman", "pakistan", "panama", "papua new guinea", "paraguay", "peru", "philippines", "poland", "portugal", "qatar", "romania", "russia", "rwanda", "saudi arabia", "senegal", "serbia", "singapore", "slovakia", "slovenia", "somalia", "south africa", "south korea", "south sudan", "spain", "sri lanka", "sudan", "sweden", "switzerland", "syria", "taiwan", "tajikistan", "tanzania", "thailand", "togo", "trinidad and tobago", "tunisia", "turkey", "turkmenistan", "uganda", "ukraine", "united arab emirates", "united kingdom", "united states", "uruguay", "uzbekistan", "venezuela", "vietnam", "yemen", "zambia", "zimbabwe"],
                description: "Boost search results from a specific country. This will prioritize content from the selected country in the search results. Available only if topic is general. Country names MUST be written in lowercase, plain English, with spaces and no underscores.",
                default: ""
              },
              include_favicon: {
                type: "boolean",
                description: "Whether to include the favicon URL for each result",
                default: false,
              },
              fetch: {
                type: "boolean",
                description: "If true: fetch each result URL directly with x402 support and log usage from fetched content",
                default: false
              },
              stage: {
                type: "string",
                enum: ["infer", "embed", "tune", "train"],
                description: "License stage for usage logging and x402 acquisition",
                default: "infer"
              },
              distribution: {
                type: "string",
                enum: ["private", "public"],
                description: "License distribution for usage logging and x402 acquisition",
                default: "private"
              },
              estimated_tokens: {
                type: "number",
                description: "Token estimate used for license acquisition when a 402 paywall is encountered",
                default: 1500
              },
              max_chars: {
                type: "number",
                description: "Max chars to return per fetched document when fetch=true",
                default: 200000
              },
              payment_method: {
                type: "string",
                enum: ["account_balance", "x402"],
                description: "Preferred payment rail when an x402 offer is encountered",
                default: "account_balance"
              }
            },
            required: ["query"]
          }
        },
        {
          name: "tavily-extract",
          description: "Extracts and processes content from specified URLs with advanced parsing capabilities. Includes optional Copyright.sh license discovery, usage logging, and x402-aware fetch.",
          inputSchema: {
            type: "object",
            properties: {
              urls: {
                type: "array",
                items: { type: "string" },
                description: "List of URLs to extract content from"
              },
              extract_depth: {
                type: "string",
                enum: ["basic", "advanced"],
                description: "Depth of extraction - 'basic' for standard extraction, 'advanced' for deeper analysis",
                default: "basic"
              },
              include_images: {
                type: "boolean",
                description: "Include images in extracted content",
                default: false,
              },
              format: {
                type: "string",
                enum: ["markdown", "text"],
                description: "Output format for extracted content",
                default: "markdown"
              },
              include_favicon: {
                type: "boolean",
                description: "Whether to include the favicon URL for each result",
                default: false,
              },
              query: {
                type: "string",
                description: "Optional query for focused extraction"
              },
              fetch: {
                type: "boolean",
                description: "If true: bypass Tavily extraction and fetch directly with x402 support",
                default: false
              },
              stage: {
                type: "string",
                enum: ["infer", "embed", "tune", "train"],
                description: "License stage for usage logging and x402 acquisition",
                default: "infer"
              },
              distribution: {
                type: "string",
                enum: ["private", "public"],
                description: "License distribution for usage logging and x402 acquisition",
                default: "private"
              },
              estimated_tokens: {
                type: "number",
                description: "Token estimate used for license acquisition when a 402 paywall is encountered",
                default: 1500
              },
              max_chars: {
                type: "number",
                description: "Max chars to return per fetched document when fetch=true",
                default: 200000
              },
              payment_method: {
                type: "string",
                enum: ["account_balance", "x402"],
                description: "Preferred payment rail when an x402 offer is encountered",
                default: "account_balance"
              }
            },
            required: ["urls"]
          }
        },
        {
          name: "tavily-crawl",
          description: "A sophisticated web crawler that systematically explores websites starting from a base URL. Includes optional Copyright.sh license discovery, usage logging, and x402-aware fetch.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The root URL to start crawling from" },
              max_depth: { type: "number", description: "Maximum depth to crawl", default: 2, minimum: 1 },
              max_breadth: { type: "number", description: "Maximum pages to crawl per depth level", default: 20, minimum: 1 },
              limit: { type: "number", description: "Maximum number of pages to crawl", default: 50, minimum: 1 },
              instructions: { type: "string", description: "Natural language instructions for the crawler" },
              select_paths: {
                type: "array",
                items: { type: "string" },
                description: "Regex patterns to select only URLs with specific path patterns (e.g., /docs/.*, /api/v1.*)",
                default: []
              },
              select_domains: {
                type: "array",
                items: { type: "string" },
                description: "Regex patterns to restrict crawling to specific domains or subdomains (e.g., ^docs\\.example\\.com$)",
                default: []
              },
              allow_external: {
                type: "boolean",
                description: "Whether to return external links in the final response",
                default: true
              },
              extract_depth: {
                type: "string",
                enum: ["basic", "advanced"],
                description: "Depth of extraction",
                default: "basic"
              },
              format: {
                type: "string",
                enum: ["markdown", "text"],
                description: "Output format for extracted content",
                default: "markdown"
              },
              include_favicon: {
                type: "boolean",
                description: "Whether to include the favicon URL for each result",
                default: false,
              },
              fetch: {
                type: "boolean",
                description: "If true: re-fetch crawled URLs directly with x402 support",
                default: false
              },
              stage: {
                type: "string",
                enum: ["infer", "embed", "tune", "train"],
                description: "License stage for usage logging and x402 acquisition",
                default: "infer"
              },
              distribution: {
                type: "string",
                enum: ["private", "public"],
                description: "License distribution for usage logging and x402 acquisition",
                default: "private"
              },
              estimated_tokens: {
                type: "number",
                description: "Token estimate used for license acquisition when a 402 paywall is encountered",
                default: 1500
              },
              max_chars: {
                type: "number",
                description: "Max chars to return per fetched document when fetch=true",
                default: 200000
              },
              payment_method: {
                type: "string",
                enum: ["account_balance", "x402"],
                description: "Preferred payment rail when an x402 offer is encountered",
                default: "account_balance"
              }
            },
            required: ["url"]
          }
        },
        {
          name: "tavily-map",
          description: "Creates detailed site maps by analyzing website structure and navigation paths. Offers configurable exploration depth, domain restrictions, and category filtering.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "The root URL to start mapping from" },
              max_depth: { type: "number", description: "Maximum depth to explore", default: 3, minimum: 1 },
              max_breadth: { type: "number", description: "Maximum pages to explore per depth level", default: 20, minimum: 1 },
              limit: { type: "number", description: "Maximum number of pages to map", default: 50, minimum: 1 },
              instructions: { type: "string", description: "Natural language instructions for the mapper" },
              select_paths: {
                type: "array",
                items: { type: "string" },
                description: "Regex patterns to select only URLs with specific path patterns",
                default: []
              },
              select_domains: {
                type: "array",
                items: { type: "string" },
                description: "Regex patterns to restrict mapping to specific domains or subdomains",
                default: []
              },
              allow_external: {
                type: "boolean",
                description: "Whether to return external links in the final response",
                default: true
              }
            },
            required: ["url"]
          }
        }
      ];
      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const args = request.params.arguments ?? {};

        switch (request.params.name) {
          case "tavily-search":
            return await this.handleSearch(args);
          case "tavily-extract":
            return await this.handleExtract(args);
          case "tavily-crawl":
            return await this.handleCrawl(args);
          case "tavily-map":
            return await this.handleMap(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: any) {
        if (axios.isAxiosError(error)) {
          return {
            content: [{
              type: "text",
              text: `Tavily API error: ${error.response?.data?.message ?? error.message}`
            }],
            isError: true,
          };
        }
        throw error;
      }
    });
  }

  private getFetchOptions(args: any): {
    fetch: boolean;
    stage: LicenseStage;
    distribution: Distribution;
    estimatedTokens: number;
    maxChars: number;
    paymentMethod: "account_balance" | "x402";
  } {
    return {
      fetch: Boolean(args.fetch ?? false),
      stage: (args.stage ?? "infer") as LicenseStage,
      distribution: (args.distribution ?? "private") as Distribution,
      estimatedTokens: Number(args.estimated_tokens ?? 1500),
      maxChars: Number(args.max_chars ?? 200000),
      paymentMethod: (args.payment_method ?? "account_balance") as "account_balance" | "x402"
    };
  }

  private buildUsageLicense(url: string, license?: LicenseInfo, fetched?: LicensedFetchResult): LicenseInfo | undefined {
    if (license?.license_version_id) {
      return license;
    }

    if (fetched?.acquire?.license_version_id) {
      return {
        url,
        license_found: true,
        action: "allow",
        license_version_id: fetched.acquire.license_version_id,
        license_sig: fetched.acquire.license_sig,
        license_type: "x402"
      };
    }

    return license;
  }

  private async logUsageFromContent(
    url: string,
    content: string,
    license: LicenseInfo | undefined,
    stage: LicenseStage,
    distribution: Distribution
  ): Promise<void> {
    if (!license) return;

    const tokens = this.licenseService.estimateTokens(content);
    if (tokens === 0) return;

    await this.licenseService.logUsage(url, tokens, license, stage, distribution);
  }

  private formatFetchedResult(fetched?: LicensedFetchResult): string[] {
    if (!fetched) return [];

    const lines: string[] = [];
    lines.push(`Fetched Status: ${fetched.status} (${fetched.final_url})`);

    if (fetched.content_text) {
      const preview = fetched.content_text.length > 200
        ? `${fetched.content_text.substring(0, 200)}...`
        : fetched.content_text;
      lines.push(`Fetched Content: ${preview}`);
    }

    if (fetched.acquire) {
      lines.push(`x402 Licensed URL: ${fetched.acquire.licensed_url}`);
      lines.push(`x402 Cost: ${fetched.acquire.cost} ${fetched.acquire.currency}`);
    }

    if (fetched.error) {
      lines.push(`Fetch Error: ${fetched.error}`);
    }

    return lines;
  }

  private async handleSearch(args: any) {
    if (args.country) {
      args.topic = "general";
    }

    const { fetch, stage, distribution, estimatedTokens, maxChars, paymentMethod } = this.getFetchOptions(args);

    const response = await this.search({
      query: args.query,
      search_depth: args.search_depth,
      topic: args.topic,
      days: args.days,
      time_range: args.time_range,
      max_results: args.max_results,
      include_images: args.include_images,
      include_image_descriptions: args.include_image_descriptions,
      include_raw_content: args.include_raw_content,
      include_domains: Array.isArray(args.include_domains) ? args.include_domains : [],
      exclude_domains: Array.isArray(args.exclude_domains) ? args.exclude_domains : [],
      country: args.country,
      include_favicon: args.include_favicon,
      start_date: args.start_date,
      end_date: args.end_date
    });

    const urls = response.results.map((result) => result.url);
    const licenses = await this.licenseService.checkLicenseBatch(urls);
    const fetchedByUrl: Record<string, LicensedFetchResult> = {};

    if (fetch) {
      for (const url of urls) {
        const fetched = await licensedFetchText(url, {
          ledger: this.licenseService,
          stage,
          distribution,
          estimatedTokens,
          maxChars,
          paymentMethod
        });
        fetchedByUrl[url] = fetched;

        if (fetched.content_text && fetched.status >= 200 && fetched.status < 300) {
          const usageLicense = this.buildUsageLicense(url, licenses.get(url), fetched);
          await this.logUsageFromContent(url, fetched.content_text, usageLicense, stage, distribution);
        }
      }
    } else {
      for (const result of response.results) {
        const license = licenses.get(result.url);
        if (license) {
          await this.logUsageFromContent(
            result.url,
            result.content || result.raw_content || "",
            license,
            stage,
            distribution
          );
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: this.formatSearchResults(response, licenses, fetch ? fetchedByUrl : undefined)
      }]
    };
  }

  private async handleExtract(args: any) {
    const { fetch, stage, distribution, estimatedTokens, maxChars, paymentMethod } = this.getFetchOptions(args);
    const urls = args.urls as string[];
    const licenses = await this.licenseService.checkLicenseBatch(urls);

    let response: any;
    const fetchedByUrl: Record<string, LicensedFetchResult> = {};

    if (fetch) {
      const results: Array<{ url: string; content?: string; raw_content?: string }> = [];
      for (const url of urls) {
        const fetched = await licensedFetchText(url, {
          ledger: this.licenseService,
          stage,
          distribution,
          estimatedTokens,
          maxChars,
          paymentMethod
        });
        fetchedByUrl[url] = fetched;

        if (fetched.content_text && fetched.status >= 200 && fetched.status < 300) {
          const usageLicense = this.buildUsageLicense(url, licenses.get(url), fetched);
          await this.logUsageFromContent(url, fetched.content_text, usageLicense, stage, distribution);
        }

        results.push({
          url,
          content: fetched.content_text || "",
          raw_content: fetched.content_text || ""
        });
      }
      response = { results };
    } else {
      response = await this.extract({
        urls: args.urls,
        extract_depth: args.extract_depth,
        include_images: args.include_images,
        format: args.format,
        include_favicon: args.include_favicon,
        query: args.query
      });

      for (const result of response.results) {
        const license = licenses.get(result.url);
        if (license) {
          await this.logUsageFromContent(
            result.url,
            result.content || result.raw_content || "",
            license,
            stage,
            distribution
          );
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: this.formatExtractResults(response, licenses, fetch ? fetchedByUrl : undefined)
      }]
    };
  }

  private async handleCrawl(args: any) {
    const { fetch, stage, distribution, estimatedTokens, maxChars, paymentMethod } = this.getFetchOptions(args);
    const crawlResponse = await this.crawl({
      url: args.url,
      max_depth: args.max_depth,
      max_breadth: args.max_breadth,
      limit: args.limit,
      instructions: args.instructions,
      select_paths: Array.isArray(args.select_paths) ? args.select_paths : [],
      select_domains: Array.isArray(args.select_domains) ? args.select_domains : [],
      allow_external: args.allow_external,
      extract_depth: args.extract_depth,
      format: args.format,
      include_favicon: args.include_favicon,
      chunks_per_source: 3,
    });

    const urls = crawlResponse.results.map(r => r.url);
    const licenses = await this.licenseService.checkLicenseBatch(urls);
    const fetchedByUrl: Record<string, LicensedFetchResult> = {};

    if (fetch) {
      for (const result of crawlResponse.results) {
        const fetched = await licensedFetchText(result.url, {
          ledger: this.licenseService,
          stage,
          distribution,
          estimatedTokens,
          maxChars,
          paymentMethod
        });
        fetchedByUrl[result.url] = fetched;

        if (fetched.content_text && fetched.status >= 200 && fetched.status < 300) {
          const usageLicense = this.buildUsageLicense(result.url, licenses.get(result.url), fetched);
          await this.logUsageFromContent(result.url, fetched.content_text, usageLicense, stage, distribution);
        }
      }
    } else {
      for (const result of crawlResponse.results) {
        const license = licenses.get(result.url);
        if (license) {
          await this.logUsageFromContent(
            result.url,
            result.raw_content || "",
            license,
            stage,
            distribution
          );
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: this.formatCrawlResults(crawlResponse, licenses, fetch ? fetchedByUrl : undefined)
      }]
    };
  }

  private async handleMap(args: any) {
    const mapResponse = await this.map({
      url: args.url,
      max_depth: args.max_depth,
      max_breadth: args.max_breadth,
      limit: args.limit,
      instructions: args.instructions,
      select_paths: Array.isArray(args.select_paths) ? args.select_paths : [],
      select_domains: Array.isArray(args.select_domains) ? args.select_domains : [],
      allow_external: args.allow_external
    });

    return {
      content: [{
        type: "text",
        text: this.formatMapResults(mapResponse)
      }]
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Tavily MCP server running on stdio");
    console.error(
      `License tracking: ${this.licenseService.getSessionSummary().tracking_enabled ? "ENABLED" : "DISABLED"}`
    );
  }

  async search(params: any): Promise<TavilyResponse> {
    try {
      const endpoint = this.baseURLs.search;

      const defaults = this.getDefaultParameters();

      const searchParams: any = {
        query: params.query,
        search_depth: params.search_depth,
        topic: params.topic,
        days: params.days,
        time_range: params.time_range,
        max_results: params.max_results,
        include_images: params.include_images,
        include_image_descriptions: params.include_image_descriptions,
        include_raw_content: params.include_raw_content,
        include_domains: params.include_domains || [],
        exclude_domains: params.exclude_domains || [],
        country: params.country,
        include_favicon: params.include_favicon,
        start_date: params.start_date,
        end_date: params.end_date,
        api_key: API_KEY,
      };

      for (const key in searchParams) {
        if (key in defaults) {
          searchParams[key] = defaults[key];
        }
      }

      if ((searchParams.start_date || searchParams.end_date) && (searchParams.time_range || searchParams.days)) {
        searchParams.days = undefined;
        searchParams.time_range = undefined;
      }

      const cleanedParams: any = {};
      for (const key in searchParams) {
        const value = searchParams[key];
        if (value !== "" && value !== null && value !== undefined &&
            !(Array.isArray(value) && value.length === 0)) {
          cleanedParams[key] = value;
        }
      }

      const response = await this.axiosInstance.post(endpoint, cleanedParams);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error("Invalid API key");
      } else if (error.response?.status === 429) {
        throw new Error("Usage limit exceeded");
      }
      throw error;
    }
  }

  async extract(params: any): Promise<TavilyResponse> {
    try {
      const response = await this.axiosInstance.post(this.baseURLs.extract, {
        ...params,
        api_key: API_KEY
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error("Invalid API key");
      } else if (error.response?.status === 429) {
        throw new Error("Usage limit exceeded");
      }
      throw error;
    }
  }

  async crawl(params: any): Promise<TavilyCrawlResponse> {
    try {
      const response = await this.axiosInstance.post(this.baseURLs.crawl, {
        ...params,
        api_key: API_KEY
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error("Invalid API key");
      } else if (error.response?.status === 429) {
        throw new Error("Usage limit exceeded");
      }
      throw error;
    }
  }

  async map(params: any): Promise<TavilyMapResponse> {
    try {
      const response = await this.axiosInstance.post(this.baseURLs.map, {
        ...params,
        api_key: API_KEY
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error("Invalid API key");
      } else if (error.response?.status === 429) {
        throw new Error("Usage limit exceeded");
      }
      throw error;
    }
  }

  private formatSearchResults(
    response: TavilyResponse,
    licenses: Map<string, LicenseInfo>,
    fetchedByUrl?: Record<string, LicensedFetchResult>
  ): string {
    const output: string[] = [];

    if (response.answer) {
      output.push(`Answer: ${response.answer}`);
      output.push("");
    }

    output.push("Detailed Results:");
    response.results.forEach((result) => {
      const license = licenses.get(result.url);
      const fetched = fetchedByUrl ? fetchedByUrl[result.url] : undefined;
      const tokens = this.licenseService.estimateTokens(
        fetched?.content_text || result.content || result.raw_content || ""
      );

      output.push(`\nTitle: ${result.title}`);
      output.push(`URL: ${result.url}`);
      output.push(`Content: ${result.content}`);
      if (result.raw_content) {
        output.push(`Raw Content: ${result.raw_content}`);
      }
      if (result.favicon) {
        output.push(`Favicon: ${result.favicon}`);
      }

      if (fetched) {
        output.push(...this.formatFetchedResult(fetched));
      }

      if (license) {
        output.push(this.licenseService.formatLicenseInfo(license, tokens));
      }
    });

    if (response.images && response.images.length > 0) {
      output.push("\nImages:");
      response.images.forEach((image, index) => {
        if (typeof image === "string") {
          output.push(`\n[${index + 1}] URL: ${image}`);
        } else {
          output.push(`\n[${index + 1}] URL: ${image.url}`);
          if (image.description) {
            output.push(`   Description: ${image.description}`);
          }
        }
      });
    }

    output.push("");
    output.push(this.licenseService.formatSessionSummary());

    return output.join("\n");
  }

  private formatExtractResults(
    response: any,
    licenses: Map<string, LicenseInfo>,
    fetchedByUrl?: Record<string, LicensedFetchResult>
  ): string {
    const output: string[] = [];

    output.push("Extracted Content:");
    output.push("");

    response.results.forEach((result: any, index: number) => {
      const license = licenses.get(result.url);
      const fetched = fetchedByUrl ? fetchedByUrl[result.url] : undefined;
      const tokens = this.licenseService.estimateTokens(
        fetched?.content_text || result.content || result.raw_content || ""
      );

      output.push(`[${index + 1}] ${result.url}`);
      output.push(result.content || result.raw_content || "(no content)");

      if (result.favicon) {
        output.push(`Favicon: ${result.favicon}`);
      }

      if (fetched) {
        output.push(...this.formatFetchedResult(fetched));
      }

      if (license) {
        output.push(this.licenseService.formatLicenseInfo(license, tokens));
      }

      output.push("");
    });

    output.push(this.licenseService.formatSessionSummary());

    return output.join("\n");
  }

  private formatCrawlResults(
    response: TavilyCrawlResponse,
    licenses: Map<string, LicenseInfo>,
    fetchedByUrl?: Record<string, LicensedFetchResult>
  ): string {
    const output: string[] = [];

    output.push(`Crawl Results for: ${response.base_url}`);
    output.push("");

    response.results.forEach((page, index) => {
      const license = licenses.get(page.url);
      const fetched = fetchedByUrl ? fetchedByUrl[page.url] : undefined;
      const tokens = this.licenseService.estimateTokens(fetched?.content_text || page.raw_content || "");

      output.push(`[${index + 1}] ${page.url}`);

      const preview = page.raw_content?.length > 200
        ? page.raw_content.substring(0, 200) + "..."
        : page.raw_content;
      output.push(`Content: ${preview || "(no content)"}`);

      if (page.favicon) {
        output.push(`Favicon: ${page.favicon}`);
      }

      if (fetched) {
        output.push(...this.formatFetchedResult(fetched));
      }

      if (license) {
        output.push(this.licenseService.formatLicenseInfo(license, tokens));
      }

      output.push("");
    });

    output.push(this.licenseService.formatSessionSummary());

    return output.join("\n");
  }

  private formatMapResults(response: TavilyMapResponse): string {
    const output: string[] = [];

    output.push("Site Map Results:");
    output.push(`Base URL: ${response.base_url}`);

    output.push("\nMapped Pages:");
    response.results.forEach((page, index) => {
      output.push(`\n[${index + 1}] URL: ${page}`);
    });

    return output.join("\n");
  }
}

function listTools(): void {
  const tools = [
    {
      name: "tavily-search",
      description: "A real-time web search tool powered by Tavily's AI engine. Features include customizable search depth (basic/advanced/fast/ultra-fast), domain filtering, time-based filtering, and support for both general and news-specific searches. Returns comprehensive results with titles, URLs, content snippets, and optional image results."
    },
    {
      name: "tavily-extract",
      description: "Extracts and processes content from specified URLs with advanced parsing capabilities. Supports both basic and advanced extraction modes, with the latter providing enhanced data retrieval including tables and embedded content. Ideal for data collection, content analysis, and research tasks."
    },
    {
      name: "tavily-crawl",
      description: "A sophisticated web crawler that systematically explores websites starting from a base URL. Features include configurable depth and breadth limits, domain filtering, path pattern matching, and category-based filtering. Perfect for comprehensive site analysis, content discovery, and structured data collection."
    },
    {
      name: "tavily-map",
      description: "Creates detailed site maps by analyzing website structure and navigation paths. Offers configurable exploration depth, domain restrictions, and category filtering. Ideal for site audits, content organization analysis, and understanding website architecture and navigation patterns."
    }
  ];

  console.log("Available tools:");
  tools.forEach(tool => {
    console.log(`\n- ${tool.name}`);
    console.log(`  Description: ${tool.description}`);
  });
  process.exit(0);
}

interface Arguments {
  "list-tools": boolean;
  _: (string | number)[];
  $0: string;
}

const argv = yargs(hideBin(process.argv))
  .option("list-tools", {
    type: "boolean",
    description: "List all available tools and exit",
    default: false
  })
  .help()
  .parse() as Arguments;

if (argv["list-tools"]) {
  listTools();
}

const server = new TavilyClient();
server.run().catch(console.error);
