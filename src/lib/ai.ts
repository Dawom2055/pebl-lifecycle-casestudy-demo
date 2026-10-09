import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

/** True when the server has credentials for Claude. Without them the app uses its templates. */
export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

/**
 * One Claude call that returns JSON matching `schema`.
 * Uses structured outputs so the reply always parses, and server-side fallbacks so a
 * safety-classifier decline is retried on Anthropic's recommended fallback model.
 */
export async function claudeJson<T>(opts: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  /** A whole conversation instead of one user turn (the last message must be from the user). */
  messages?: Anthropic.Beta.BetaMessageParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<T> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: opts.messages ?? [{ role: "user", content: opts.content }],
    output_config: {
      effort: opts.effort ?? "low",
      format: { type: "json_schema", schema: opts.schema },
    },
  });

  if (response.stop_reason === "refusal") {
    throw new AiError("Claude declined this request.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiError("Claude's reply was cut off.", 502);
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new AiError("Claude returned no text.", 502);
  return JSON.parse(text.text) as T;
}

/**
 * One conversational turn: returns Claude's reply as plain text. Same refusal fallbacks as
 * claudeJson, so a safety-classifier decline is retried on Anthropic's recommended fallback model.
 */
export async function claudeChat(opts: {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<string> {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    messages: opts.messages,
    output_config: { effort: opts.effort ?? "medium" },
  });

  if (response.stop_reason === "refusal") throw new AiError("Claude declined to answer that.", 422);
  if (response.stop_reason === "max_tokens") throw new AiError("Claude's reply was cut off.", 502);
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim();
  if (!text) throw new AiError("Claude returned no text.", 502);
  return text;
}

export class AiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Maps SDK and app errors to a JSON response the client can fall back from. */
export function aiErrorResponse(error: unknown) {
  if (error instanceof AiError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Anthropic.AuthenticationError) {
    return Response.json({ error: "The Anthropic API key was rejected." }, { status: 401 });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return Response.json({ error: "Rate limited by the Anthropic API. Try again shortly." }, { status: 429 });
  }
  if (error instanceof Anthropic.APIError) {
    return Response.json({ error: `Anthropic API error: ${error.message}` }, { status: 502 });
  }
  console.error(error);
  return Response.json({ error: "Unexpected error calling Claude." }, { status: 500 });
}
