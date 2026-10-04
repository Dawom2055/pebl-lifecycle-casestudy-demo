import { aiConfigured, aiErrorResponse, AiError, claudeJson } from "@/lib/ai";
import type { AiRead } from "@/lib/types";

const SYSTEM = `You transcribe expense receipts for Pebl's expense intake (EXP-1). Read the image and return each field with a confidence between 0 and 1.

- Transcribe only what the receipt shows. Never guess a value to fill a gap: if a field isn't visible, return null (taxId) or your best reading with low confidence.
- amount is the final total paid, as a number, in the receipt's currency.
- currency is an ISO code: GBP, USD, CAD, EUR or JPY. Infer it from the symbol, address or tax number.
- date is ISO format YYYY-MM-DD.
- taxId is the supplier's VAT, GST/HST or invoice registration number exactly as printed, or null if none is printed.
- category is one of meals, travel, lodging, office, other.
- attendees is the number of people the bill covers (covers, guests or items), 1 if unclear.
- Confidence below 0.8 means a person should look at that field. Blurry, cropped or handwritten values should score low.
- If the image is not a receipt, set isReceipt to false.`;

const field = (value: Record<string, unknown>) => ({
  type: "object",
  properties: { value, confidence: { type: "number" } },
  required: ["value", "confidence"],
  additionalProperties: false,
});

const SCHEMA = {
  type: "object",
  properties: {
    isReceipt: { type: "boolean" },
    merchant: field({ type: "string" }),
    amount: field({ type: "number" }),
    currency: field({ type: "string", enum: ["GBP", "USD", "CAD", "EUR", "JPY"] }),
    date: field({ type: "string" }),
    taxId: field({ anyOf: [{ type: "string" }, { type: "null" }] }),
    category: field({ type: "string", enum: ["meals", "travel", "lodging", "office", "other"] }),
    attendees: field({ type: "integer" }),
  },
  required: ["isReceipt", "merchant", "amount", "currency", "date", "taxId", "category", "attendees"],
  additionalProperties: false,
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export async function POST(request: Request) {
  if (!aiConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });

  try {
    const { imageDataUrl } = (await request.json()) as { imageDataUrl: string };
    const match = /^data:([^;]+);base64,(.+)$/.exec(imageDataUrl ?? "");
    if (!match) throw new AiError("Expected an image data URL.", 400);
    const mediaType = match[1] as ImageType;
    if (!IMAGE_TYPES.includes(mediaType)) throw new AiError("Upload a JPEG, PNG, GIF or WebP image.", 400);

    const out = await claudeJson<Omit<AiRead, "source"> & { isReceipt: boolean }>({
      system: SYSTEM,
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } },
        { type: "text", text: "Transcribe this receipt." },
      ],
      schema: SCHEMA,
      effort: "medium",
    });

    if (!out.isReceipt) throw new AiError("That image doesn't look like a receipt.", 422);
    const { isReceipt: _, ...fields } = out;
    void _;
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    for (const f of Object.values(fields)) f.confidence = clamp(f.confidence);
    return Response.json({ ...fields, source: "claude" } satisfies AiRead);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
