/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-disable camelcase */
import { AzureOpenAIClient } from '@adobe/spacecat-shared-gpt-client';

export class CustomerAnalysis {
  constructor(domain, context) {
    this.domain = domain;
    this.context = context;
    this.log = context.log;
    this.azureClient = AzureOpenAIClient.createFrom(context);
    this.companyName = ''; // Will be set after product discovery

    // Token usage tracking
    this.tokenUsage = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      apiCalls: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Execute a prompt and extract JSON response
   */
  async executePrompt(prompt, systemMessage = null) {
    try {
      let fullPrompt = prompt;
      if (systemMessage) {
        fullPrompt = `${systemMessage}\n\n${prompt}`;
      }

      this.log.info(`Executing prompt (${fullPrompt.length} chars)`);

      const response = await this.azureClient.fetchChatCompletion(fullPrompt);

      if (!response?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from Azure OpenAI');
      }

      // Track token usage
      if (response.usage) {
        this.tokenUsage.totalPromptTokens += response.usage.prompt_tokens || 0;
        this.tokenUsage.totalCompletionTokens += response.usage.completion_tokens || 0;
        this.tokenUsage.totalTokens += response.usage.total_tokens || 0;
        this.tokenUsage.apiCalls += 1;

        this.log.debug(`Token usage for this call: ${response.usage.prompt_tokens || 0} prompt + ${response.usage.completion_tokens || 0} completion = ${response.usage.total_tokens || 0} total`);
      }

      const { content } = response.choices[0].message;
      const parsed = JSON.parse(content);

      this.log.info('Response parsed successfully');
      return parsed;
    } catch (error) {
      this.log.error(`Prompt execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get token usage summary
   */
  getTokenUsageSummary() {
    const endTime = Date.now();
    const duration = endTime - this.tokenUsage.startTime;

    return {
      apiCalls: this.tokenUsage.apiCalls,
      totalPromptTokens: this.tokenUsage.totalPromptTokens,
      totalCompletionTokens: this.tokenUsage.totalCompletionTokens,
      totalTokens: this.tokenUsage.totalTokens,
      durationMs: duration,
      durationSeconds: Math.round(duration / 1000),
      averageTokensPerCall: this.tokenUsage.apiCalls > 0
        ? Math.round(this.tokenUsage.totalTokens / this.tokenUsage.apiCalls) : 0,
    };
  }

  /**
   * Print token usage summary
   */
  printTokenUsageSummary() {
    const summary = this.getTokenUsageSummary();

    this.log.info('🔍 Token Usage Summary:');
    this.log.info(`   API Calls: ${summary.apiCalls}`);
    this.log.info(`   Total Prompt Tokens: ${summary.totalPromptTokens.toLocaleString()}`);
    this.log.info(`   Total Completion Tokens: ${summary.totalCompletionTokens.toLocaleString()}`);
    this.log.info(`   Total Tokens: ${summary.totalTokens.toLocaleString()}`);
    this.log.info(`   Average Tokens per Call: ${summary.averageTokensPerCall.toLocaleString()}`);
    this.log.info(`   Total Duration: ${summary.durationSeconds}s`);

    // Estimate costs (rough approximation - adjust rates as needed)
    const estimatedCost = this
      .estimateCost(summary.totalPromptTokens, summary.totalCompletionTokens);
    if (estimatedCost > 0) {
      this.log.info(`   Estimated Cost: $${estimatedCost.toFixed(4)}`);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  estimateCost(promptTokens, completionTokens) {
    const promptTokenRate = 0.002;
    const completionTokenRate = 0.001;
    const promptCost = (promptTokens / 1000) * promptTokenRate;
    const completionCost = (completionTokens / 1000) * completionTokenRate;
    return promptCost + completionCost;
  }

  /**
   * Step 1: Discover products for the domain
   */
  async discoverProducts() {
    const prompt = `
### ROLE
You are a precise product-offering extraction agent. Operate with strict first‑party verification, zero hallucinations, and strict JSON schema compliance. Follow the instructions below exactly without broadening scope or inferring unverified items.

### GOAL
Return up to 5 top-level "products" or "offerings" that the given domain actively markets or sells. A "product" is the highest-level item a visitor could buy, subscribe to, or learn about (e.g., iPhone, Microsoft 365, Enterprise Hosting, Beach Resort Stay). For service businesses (SaaS, agency, airline, hospital, etc.), treat each major service line, edition, plan, or package as a product if it is marketed as a distinct offering.

### DEFINITIONS
- Product vs. feature: Include primary offerings; exclude individual features unless marketed as standalone editions or modules with their own landing pages.
- Products vs. solutions: Prefer “Products” over “Solutions.” Include an industry “Solution” only if it is sold/packaged as a discrete offering (own hero page, pricing/CTA, and positioning).
- Variants/SKUs: For ecommerce, select the brand’s **hero SKUs** (e.g., “Pure Whey Protein,” “Clear Whey Isolate”), not the abstract family (e.g., “Protein”). For SaaS/plans, include editions (e.g., “Pro,” “Enterprise”) only if they have distinct positioning beyond a pricing table.  
- Naming: Use the brand’s own casing and phrasing; omit ® and ™ symbols; avoid reseller/press nicknames.

### NAV-CENTRIC ECOMMERCE MODE (retail/catalog sites like bulk.com)
When the site’s primary navigation clearly enumerates the store’s core catalogue families, treat those top‑navigation category families as eligible top‑level “offerings,” provided ALL of the following are true:
1) Prominence: The category is in the main header/mega‑menu or homepage hero tiles (not just a sidebar filter).
2) Canonical landing: The category links to a dedicated landing page (PLP or hub) with clear branding copy or value proposition (not just a filtered search).
3) Portfolio coverage: The category represents a broad, intentional product family (e.g., “Protein,” “Vitamins & Supplements,” “Healthy Snacks,” “Gym Accessories,” “Clothing”), not a transient promo (e.g., “New In,” “Sale,” “Bundles”).
4) Non‑duplication: Merge synonyms or nested labels into one family (e.g., “Protein” and “Protein Powders” → “Protein”), preferring the site’s canonical wording.

If both “shop by goal” and “shop by category” exist, prefer stable product families over goals (e.g., choose “Protein” over “Weight Gain”), unless goals are presented as primary, persistent families with dedicated hubs and CTAs.

### METHOD (in order)
1) Discover candidates
   - Check any of:
     • /sitemap.xml or /sitemap_index.xml
     • Main navigation (“Products,” “Shop,” “Platform,” “Plans,” “Rooms,” “Services,” “Pricing”) and mega‑menu flyouts
     • Footer taxonomy and homepage hero CTAs/tiles
     • First‑party “Products” or “Shop” hub pages/directories
   - Optionally confirm with first‑party structured data (JSON‑LD Product/Service/SiteNavigationElement) and breadcrumbs.

2) Verify recency
   - Prefer first‑party pages reachable from the current home page.
   - Exclude discontinued/EOL items (signals like “retired,” “legacy,” “end‑of‑life” on first‑party pages).
   - If ambiguous, corroborate naming/current availability with recent, reputable first‑party sources (docs, pricing, newsroom). Avoid forums/cached pages.

3) Choose granularity
   - Pick one canonical page per product family (family root or primary landing page).
   - Include sub‑families as separate products only if:
     • they have distinct root slugs AND
     • each is marketed as its own offering with a hero and CTA.
   - SaaS plans/editions (Free/Pro/Enterprise): only separate if each has distinct positioning/landing detail beyond a pricing table.

4) Limit and prioritize (max 5)
   - Rank by prominence and strategic emphasis: main nav placement, dedicated hero/landing, pricing/CTA presence, and homepage visibility.
   - For large catalogs, prefer the 3–5 most universal families over niche/seasonal ones.

### EXCLUSIONS
- Exclude corporate pages (About, Careers, Blog, Press, Investors), generic resources (Docs, Help Center), community/partners, and purely informational articles.
- Exclude transient or merchandising constructs: “Sale,” “New In,” “Clearance,” “Bundles,” “Gift Cards,” “Outlet,” and tag‑only or filtered search pages without a canonical hub.
- For marketplaces/retailers with many SKUs, capture top parent offerings (e.g., “Marketplace,” “Membership,” “Fulfillment Service”) rather than listing individual SKUs; for D2C retail brands, capture the top navigation families per the nav‑centric mode above.

### COMPANY NAME
- Extract from the home page title, header logo alt text, or footer legal entity. If unclear, use the most authoritative first‑party naming on the homepage. As a last resort, derive from the domain (strip TLD and separators, title‑case words).

### OUTPUT
- Respond with ONLY the following JSON (no extra keys, comments, or URLs):
{
  "main_domain": "${this.domain}",
  "company_name": "Company Name",
  "products": [
    {
      "product": "Product Name exactly as branded (no ™/®)",
      "description": "15–30 word plain-English description of what this product does and for whom; avoid hype and jargon."
    }
  ]
}
- products must contain 0–5 items.
- No URLs in output.
- Use sentence case in descriptions and preserve branded casing for product names.
- If fewer than 5 verified products exist, return fewer; never invent.

### QUALITY GUARDRAILS
- Verify each product name and status with first‑party evidence; use external sources only to confirm current naming/availability.
- Prefer canonical, top‑level names; avoid feature‑level or SKU‑level labels.
- Ensure the JSON is valid and strictly matches the schema (no trailing commas or additional fields).

### INPUT
${this.domain}

### CRITICAL
- Use web search and first‑party pages to confirm current, accurate product information.
- Only include products that can be verified as current and actively marketed.
- Do NOT hallucinate or infer unverified products.
`;

    try {
      const result = await this.executePrompt(prompt);
      this.log.info(`Discovered ${result.products?.length || 0} products`);
      this.companyName = result.company_name; // Store company name
      return result;
    } catch (error) {
      this.log.error(`Product discovery failed: ${error.message}`);
      return { main_domain: this.domain, company_name: '', products: [] };
    }
  }

  /**
   * Step 2: Find markets for a specific product
   */
  async findMarketsForProduct(productName, productDescription) {
    const prompt = `
### ROLE
You are a senior market analysis agent. Operate with strict verification, no hallucination, and quality over quantity. Follow the instructions below exactly and do not broaden scope.

### GOAL
Identify up to 5 geographical markets—ranked by sales volume, demand, or market share—where the specified product from ${this.companyName || 'the company'} has a significant presence.

### DEFINITIONS
- “Market”: A distinct geography (country, multi-country region, or economic zone) where the company demonstrably sells, distributes, or operates the product.
- “Significant presence”: Evidence of active availability plus signals of commercial traction (e.g., revenue disclosures, market-share statements, local operations, distribution footprint).

### INPUT
Company: ${this.companyName || 'Company'}
Product to analyze:
• ${productName}: ${productDescription}

### METHOD (in order)
1) Discover evidence
   - Prefer first-party sources: product/availability pages, regional pricing or store finders, investor reports, earnings calls, press releases, official blogs, local subsidiaries.
   - Use reputable corroboration only when needed: major business media, regulatory filings, major analyst reports. Avoid forums and unverified third-party blogs.
   - Ensure recency: prioritize sources from the last 24 months; exclude discontinued/EOL markets.

2) Verify availability
   - Confirm the product is currently offered in the market (e.g., “available/shipping,” local SKU/pricing, carrier/retail partners, official launch PR).
   - Exclude geographies with unclear, historic, or out-of-date availability.

3) Rank markets (up to 5)
   - Rank by strength of commercial presence using the best available mix of:
     • Reported regional sales/revenue or market share
     • Official market-launch emphasis and sustained availability
     • Density of authorized retail/partner channels
     • Local pricing pages or store locators for the product
     • Regulatory approvals enabling distribution (where applicable)
   - When exact figures are unavailable, triangulate from multiple high-quality signals; prefer fewer high-confidence markets over speculative ones.

4) Assign confidence
   - High: Explicit, current availability plus strong traction signals (e.g., regional revenue/market share, widespread distribution, recurring launches/support).
   - Medium: Clear, current availability with partial or indirect traction signals; not speculative.
   - Do not use Low. If insufficient evidence, omit the market.

5) Normalize names
   - Use standard country or region names (e.g., “United States,” “India,” “European Union,” “Latin America”).
   - Avoid overlapping entries (e.g., do not list both “EU” and “Germany” unless the product is distinctly evidenced for both and non-duplicative).

### OUTPUT
Return ONLY this exact JSON structure (keys, order, and types must match; no extra fields):
{
  "analysis_summary": "Brief overview of market presence",
  "results": [
    {
      "product_name": "Exact Product Name",
      "markets": [
        {
          "name": "Market Name (e.g., United States, India)",
          "iso_code": "Lower case ISO 3166-1 alpha-2 (e.g., us|in|eu|null)",
          "confidence": "High|Medium",
          "evidence": "Concise reason citing first-party availability and traction signals"
        }
      ]
    }
  ]
}

### CONSTRAINTS
- Maximum 5 markets per product; include fewer if evidence is limited.
- Include only High or Medium confidence markets.
- Evidence must reflect current availability and presence; exclude legacy/discontinued markets.
- Quality over quantity; never guess or infer beyond evidence.
- If no verified markets are found, return an empty “markets” array with an honest analysis_summary explaining evidence gaps.

### QUALITY GUARDRAILS
- Prefer first-party, recent, and directly relevant documentation.
- Resolve conflicts by favoring canonical, newer sources over older or secondary ones.
- Be concise, neutral, and specific in “evidence”; avoid marketing language and vague claims.
`;

    try {
      const result = await this.executePrompt(prompt);
      this.log.info(`Found ${result.results?.[0]?.markets?.length || 0} markets for ${productName}`);
      return result.results?.[0]?.markets || [];
    } catch (error) {
      this.log.error(`Market analysis failed for ${productName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Step 3: Find URL for product in specific market
   */
  async findProductUrl(productName, marketName) {
    const prompt = `
### ROLE
You are a localization-aware URL discovery agent. Operate with strict verification, zero hallucination, and quality over quantity. Follow these instructions exactly and do not broaden scope.

### GOAL
Find a market-specific or localized URL for the product named "${productName}" in the "${marketName}" market on ${this.domain}. Return only the required JSON.

### INPUTS
- Domain: ${this.domain}
- Product name: ${productName}
- Market name: ${marketName}

### WHAT COUNTS AS “MARKET-SPECIFIC OR LOCALIZED”
A URL on the same domain or its subdomains that clearly targets the specified market via at least one of:
- Country/region code in path: /us/, /uk/, /de/, /jp/, /en-us/, /de-de/, etc.
- Localized subdomain: de.${this.domain}, fr.${this.domain}, jp.${this.domain}, etc.
- Explicit locale/region parameters: ?lang=de-DE, ?locale=en-US, ?region=DE (keep only if the URL reliably loads localized content without cookies).
- hreflang/alternate tags on the page that include the market’s locale and point to that same URL.
Do not return generic/global URLs with no stable market signal.

### NORMALIZATION
- Map ${marketName} to ISO 3166-1 alpha-2 (country) and common locale(s) where applicable (e.g., Germany → DE → de-DE; United States → US → en-US).
- For multi-language markets (e.g., Switzerland, Canada, Belgium), accept any official locale tied to the correct country code (e.g., de-CH, fr-CH, it-CH; en-CA, fr-CA).
- Prefer country-specific over broad region (e.g., “EU”) unless the marketName is itself a region and the site uses a region code path (e.g., /eu/).

### DISCOVERY METHOD (in order)
1) On-domain exploration
   - Try common locale folders and subdomains combining product terms, e.g.:
     • https://{ccTLD or subdomain}.{domain}/[...product...]
     • https://{domain}/{cc or locale}/[...product...]
     • https://{domain}/[...product...]?locale={locale}
   - Check top navigation language/region switchers, footer selectors, and product/category hubs for localized paths.
2) Structured signals
   - Inspect hreflang rel="alternate" tags for the market’s locale; prefer the URL whose hreflang matches the target market.
   - Look for meta html[lang], Content-Language, or visible currency/region indicators that match the market.
3) Disambiguation
   - If multiple candidates exist, choose the one that:
     • Matches the market’s exact country code and locale, then
     • Is the canonical or primary product landing page (not a variant or promo), and
     • Uses a clean, stable path (avoid session or tracking parameters).
   - If only global pages exist and require geolocation or cookies to localize without a stable URL signal, treat as not found.

### TOPIC EXTRACTION (offering-focused)
Return a topic that describes the offering represented by the found page (not the page type). Apply these rules:
- Product detail page: topic = the exact localized product name as branded (e.g., “Whey Protein 80”).
- Product family/series landing: topic = the family/series offering (pluralized when appropriate, e.g., “Protein powders”).
- Category/collection page: topic = the category offering label as shown on the page (e.g., “Vitamins & supplements”).
- Regional market hub: topic = the specific offering section name on that hub that corresponds to the product (e.g., “Smartphones” or “Enterprise hosting”), not a generic “market hub.”
- Pricing/plans page: topic = the family/plan offering (e.g., “Pro plan” or “Microsoft 365 Business”).
- If multiple distinct offerings are presented on the same URL and clearly map to the provided product name, select the offering that best matches ${productName}.

Uniqueness rule: Treat the combination of url + topic as unique. The same url may be valid for different topics across different runs; do not deduplicate by URL alone.

### SELECTION RULES
- Must be on ${this.domain} or its subdomains; do not return external domains.
- Prefer HTTPS and absolute URLs; strip tracking parameters (utm_*, gclid, fbclid) and session IDs.
- Accept SKU pages only if the site markets the product at SKU-level by market and the URL clearly encodes the locale.

### OUTPUT
Return ONLY one of the following JSON objects (no extra fields, comments, or whitespace beyond standard JSON formatting):

FOUND:
{
  "url": "https://example.com/us/products/product-name",
  "topic": "Offering shown on the page (e.g., 'Protein powders', 'iPhone 15 Pro', 'Enterprise hosting', 'Pro plan')",
  "found": true
}

NOT FOUND:
{
  "url": "",
  "found": false
}

### EDGE CASES
- If the market has multiple official languages, any correct country-locale variant is acceptable.
- If the site uses region → country routing (e.g., /europe/de/), ensure the final URL still clearly encodes the target country.
- If the product is listed only on a category page for that market, return that localized category URL and set topic to the category’s offering label.
- If redirects occur, return the final resolved URL.
- If the product is discontinued or unavailable in the market, return not found.

### QUALITY GUARDRAILS
- Do not guess or fabricate URLs.
- Do not return generic/global pages with no persistent market indicator.
- Prefer fewer results over uncertain matches—return not found if evidence is insufficient.
`;

    try {
      const result = await this.executePrompt(prompt);
      if (result.found && result.url) {
        this.log.info(`Found URL for ${productName} in ${marketName}: ${result.url}`);
        return { url: result.url, topic: result.topic };
      } else {
        this.log.info(`No market-specific URL found for ${productName} in ${marketName}`);
        return '';
      }
    } catch (error) {
      this.log.error(`URL finding failed for ${productName} in ${marketName}: ${error.message}`);
      return '';
    }
  }

  /**
   * Run the complete analysis flow
   */
  async runAnalysis() {
    this.log.info(`🚀 Starting customer analysis for: ${this.domain}`);

    try {
      // Step 1: Discover products
      this.log.info('Step 1: Discovering products...');
      const { company_name, products } = await this.discoverProducts();

      if (!products || products.length === 0) {
        this.log.warn('No products found');
        return { domain: this.domain, products: [] };
      }

      this.log.info(`Found ${products.length} products for ${company_name}`);

      // Step 2 & 3: Analyze markets and find URLs for each product
      const results = [];

      for (const product of products) {
        this.log.info(`Analyzing markets for: ${product.product}`);

        // eslint-disable-next-line no-await-in-loop
        const markets = await this.findMarketsForProduct(product.product, product.description);

        for (const market of markets) {
          // eslint-disable-next-line no-await-in-loop
          const url = await this.findProductUrl(product.product, market.name);

          results.push({
            product: product.product,
            market: market.iso_code,
            topic: url.topic,
            url: url.url || this.domain, // Fallback to main domain if no market-specific URL
          });
        }
      }

      this.log.info(`✅ Analysis completed! Found ${results.length} product-market combinations`);

      // Print token usage summary
      this.printTokenUsageSummary();

      return {
        domain: this.domain,
        company_name,
        products: results,
        tokenUsage: this.getTokenUsageSummary(),
      };
    } catch (error) {
      this.log.error(`Analysis failed: ${error.message}`);

      // Print token usage summary even on error
      this.printTokenUsageSummary();

      return {
        domain: this.domain,
        products: [],
        error: error.message,
        tokenUsage: this.getTokenUsageSummary(),
      };
    }
  }
}
/* eslint-enable camelcase */
