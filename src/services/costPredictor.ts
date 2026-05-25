/**
 * Cost Predictor Service
 * Estimates tokens and costs based on official Google AI Studio Gemini API pricing (May 2026).
 */

export interface TokenEstimation {
  inputTokens: number;
  outputTokens: number;
  hasGrounding: boolean;
}

// Rates per 1 Million tokens in USD
export const PRICING_RATES: Record<
  string,
  { input: number; output: number; cachedRead?: number; groundingQuery?: number }
> = {
  'gemini-3.5-flash': {
    input: 1.50,
    output: 9.00,
    cachedRead: 0.15,
    groundingQuery: 14.00 / 1000 // $0.014 per query
  },
  'gemini-3.1-flash-lite': {
    input: 0.25, // $0.25 per 1M tokens (6x cheaper than 3.5 Flash!)
    output: 1.50, // $1.50 per 1M tokens
    cachedRead: 0.025,
    groundingQuery: 14.00 / 1000
  },
  'gemini-3-flash-preview': {
    input: 1.50,
    output: 9.00,
    cachedRead: 0.15,
    groundingQuery: 14.00 / 1000
  },
  'gemini-3.1-pro-preview': {
    input: 2.00, // <= 200k tokens standard rate
    output: 12.00,
    cachedRead: 0.20,
    groundingQuery: 14.00 / 1000
  },
  // Default fallback for any unspecified model (using Flash rates)
  'default': {
    input: 1.50,
    output: 9.00,
    cachedRead: 0.15,
    groundingQuery: 14.00 / 1000
  }
};

/**
 * Robust heuristic to estimate tokens for a given text string.
 * On average, 1 token ≈ 4 characters for English/Portuguese text.
 */
export const estimateTextTokens = (text: string): number => {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};

/**
 * Estimates tokens for video input.
 * Gemini samples video at roughly 1 frame per second.
 * Each frame is represented by approximately 258 tokens.
 */
export const estimateVideoTokens = (durationSec: number): number => {
  if (!durationSec || durationSec <= 0) return 0;
  return Math.ceil(durationSec * 258);
};

/**
 * Estimates tokens for an image.
 * Gemini represents images as a fixed count of 258 tokens.
 */
export const estimateImageTokens = (count: number = 1): number => {
  if (count <= 0) return 0;
  return count * 258;
};

/**
 * Calculates the exact cost in USD for a given token count and model.
 * Supports standard, cached, and search grounding billing.
 */
export const calculateActualCost = (
  model: string,
  promptTokens: number | undefined | null,
  candidatesTokens: number | undefined | null,
  groundingQueriesCount: number = 0,
  cachedTokens: number = 0
): number => {
  const rates = PRICING_RATES[model] || PRICING_RATES.default;
  const prompt = promptTokens ?? 0;
  const candidates = candidatesTokens ?? 0;
  
  // Calculate input cost: regular input + cached input (discounted)
  const regularInputCost = ((prompt - cachedTokens) * rates.input) / 1000000;
  const cachedInputCost = rates.cachedRead 
    ? (cachedTokens * rates.cachedRead) / 1000000 
    : 0;
  
  // Calculate output cost
  const outputCost = (candidates * rates.output) / 1000000;
  
  // Calculate grounding cost ($0.014 per query if applicable)
  const groundingCost = groundingQueriesCount * (rates.groundingQuery || (14.00 / 1000));
  
  return regularInputCost + cachedInputCost + outputCost + groundingCost;
};

/**
 * Logs actual token usage and USD cost beautifully to the developer console.
 */
export const logActualCost = (
  service: string,
  model: string,
  usageMetadata?: { promptTokenCount?: number | null; candidatesTokenCount?: number | null },
  groundingQueriesCount: number = 0,
  cachedTokens: number = 0
): void => {
  if (!usageMetadata) return;
  const prompt = usageMetadata.promptTokenCount ?? 0;
  const candidates = usageMetadata.candidatesTokenCount ?? 0;
  
  const totalCost = calculateActualCost(
    model,
    prompt,
    candidates,
    groundingQueriesCount,
    cachedTokens
  );

  console.log(
    `%c[Gemini Cost Tracker] [${service}] %cModel: ${model} | Prompt: ${prompt} tokens | Output: ${candidates} tokens | Grounding: ${groundingQueriesCount} q | Cost: $${totalCost.toFixed(5)} USD`,
    'color: #10B981; font-weight: bold; background: #064E3B; padding: 4px 6px; border-radius: 4px;',
    'color: #E2E8F0; background: #1E293B; padding: 4px 6px; border-radius: 4px;'
  );
};
