// Typed errors from the LLM adapter. Messages are safe to show and never contain source text.

export type LlmErrorCode = "config" | "rate_limit" | "timeout" | "invalid_output" | "refusal" | "provider" | "budget";

export class LlmError extends Error {
  code: LlmErrorCode;
  /** Whether trying the same request again later may succeed. */
  retryable: boolean;
  constructor(code: LlmErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.retryable = retryable;
  }
}

export class LlmConfigError extends LlmError {
  constructor(message: string) {
    super("config", message, false);
    this.name = "LlmConfigError";
  }
}

export class LlmRateLimitError extends LlmError {
  retryAfterMs: number | null;
  constructor(retryAfterMs: number | null) {
    super("rate_limit", "The language model is rate limited. Try again shortly.", true);
    this.name = "LlmRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class LlmTimeoutError extends LlmError {
  constructor() {
    super("timeout", "The language model took too long to answer.", true);
    this.name = "LlmTimeoutError";
  }
}

export class LlmInvalidOutputError extends LlmError {
  issues: string[];
  constructor(issues: string[]) {
    super("invalid_output", "The language model returned output in the wrong shape twice.", false);
    this.name = "LlmInvalidOutputError";
    this.issues = issues;
  }
}

export class LlmRefusalError extends LlmError {
  category: string | null;
  constructor(category: string | null) {
    super("refusal", "The language model declined this request.", false);
    this.name = "LlmRefusalError";
    this.category = category;
  }
}

export class LlmProviderError extends LlmError {
  status: number | null;
  constructor(message: string, status: number | null, retryable: boolean) {
    super("provider", message, retryable);
    this.name = "LlmProviderError";
    this.status = status;
  }
}

export class LlmBudgetError extends LlmError {
  constructor(limit: number) {
    super("budget", `The daily limit of ${limit} language-model calls has been reached. Try again tomorrow.`, false);
    this.name = "LlmBudgetError";
  }
}
