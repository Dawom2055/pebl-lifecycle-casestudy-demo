import { aiConfigured, aiErrorResponse, AiError, claudeChat } from "@/lib/ai";
import type { ChatContext } from "@/lib/engine/chat-context";

const SYSTEM = `You are Pebl AI, an assistant for a Pebl local HR specialist reviewing one request in Pebl's lifecycle compliance system.

Pebl is an Employer of Record: it legally employs workers on behalf of client companies. Every expense, leave request, overtime request and timesheet passes through intake, a rules engine (country law plus the client's own policy), and a risk router. The request context below holds everything the system knows about this one request: the request, the worker, every rule check, the routing signals, disclaimers for the client admin, the audit trail, the country's rules, the client's policy, how similar past cases were resolved, and the worker's other requests.

How to help:
- Answer the specialist's questions about this request. Ground every answer in the request context and name the check, rule ID or policy setting you're relying on.
- The specialist decides. You can recommend clearing, asking the worker for information, or denying, and say why, but never present a decision as made. Only people deny requests.
- If the context doesn't contain something, say so. You may add general knowledge of employment law or tax, but label it as general knowledge to verify, not as a rule the system checked. Rule values marked illustrative are demo placeholders, not legal advice; say so when it matters.
- Don't invent facts about the worker, the client or past requests.
- Refer to people by name, never by gendered pronouns. For teammates' absences, say who is away and when, never why.
- Keep answers short: a few sentences, or a short list when comparing things. Plain text; simple "- " bullets are fine, no headings or tables.`;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: Request) {
  if (!aiConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });

  try {
    const { context, messages } = (await request.json()) as { context: ChatContext; messages: ChatTurn[] };
    const turns = (messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
    if (!context || !turns.length || turns[0].role !== "user" || turns.at(-1)!.role !== "user") {
      throw new AiError("Send the request context and a conversation that starts and ends with a question.", 400);
    }

    // Keep the last 20 turns; the request context carries the facts, so older chat is safe to drop.
    const recent = turns.slice(-20);
    while (recent[0]?.role !== "user") recent.shift();

    const reply = await claudeChat({
      system: `${SYSTEM}\n\n<request_context>\n${JSON.stringify(context, null, 2)}\n</request_context>`,
      messages: recent.map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
      effort: "medium",
    });
    return Response.json({ reply });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
