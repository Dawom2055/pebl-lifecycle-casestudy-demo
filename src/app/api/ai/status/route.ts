import { aiConfigured, MODEL } from "@/lib/ai";

export async function GET() {
  return Response.json({ connected: aiConfigured(), model: MODEL });
}
