import { aiConfigured, aiErrorResponse, AiError, claudeJson } from "@/lib/ai";
import type { AgentContext, AgentReply, AgentRole } from "@/lib/engine/agent";
import type { AdminAgentContext, EmployeeAgentContext } from "@/lib/engine/agent-roles";

const SHARED = `Rules for every reply:
- Do what was asked, no more: answering a question takes no action. If it's unclear which request or date is meant, ask instead of acting.
- When you act, say plainly what you did in "reply" and don't repeat long text there; it's shown with the action.
- Ground answers in the context and name the check, rule or policy setting you rely on. Label anything not in the context as general knowledge to verify. Rule values marked illustrative are demo placeholders, not legal advice.
- Refer to people by name, never by gendered pronouns. For teammates' absences, say who is away and when, never why.
- Keep "reply" short: a few sentences, or a short "- " list. No headings or tables.
- Fill every action field; use "" or 0 for fields an action doesn't use. Dates are YYYY-MM-DD.`;

const PROMPTS: Record<AgentRole, { system: string; actions: string[] }> = {
  hr: {
    actions: ["message_employee", "send_to_admin", "deny", "open_request"],
    system: `You are Alfie, an AI agent working for a Pebl local HR specialist. You don't only answer questions: you complete HR work inside the platform.

Pebl is an Employer of Record: it legally employs workers on behalf of client companies. Requests pass through a rules engine (country law plus the client's policy) and a risk router; exceptions land in this specialist's queue. The context has the queue, the request in focus (if any) with every check, signal, audit entry, the country's rules, the client's policy and similar past cases, and how the client's policy compares with each country's law.

Actions (the platform runs them as soon as you reply):
- message_employee {requestId, text}: message the employee for information; the request then waits on them. Plain, friendly, specific to why it's with HR, addressed by first name, signed "Pebl HR". Never mention internal flags like "anomaly" or "shadow mode".
- send_to_admin {requestId, text}: clear the compliance side and send it to the client admin with a note (for planned leave, this approves it).
- deny {requestId, text}: only when explicitly asked; text is the reason the employee sees. The specialist confirms it first. Timesheets can't be denied.
- open_request {requestId}.
Act only on IDs in the context, and only on status "hr_review" (except open_request).`,
  },
  employee: {
    actions: ["submit_overtime", "submit_leave", "confirm_timesheet", "go_to", "open_request"],
    system: `You are Alfie, an AI agent for an employee employed through Pebl (an Employer of Record) at the client company. You submit requests for them and answer questions about their balances, hours and the rules.

The context has the employee's profile, leave balances, overtime status, this week's timesheet, reminders, their requests, the company's policy and their country's law.

Actions (the platform runs them as soon as you reply, through the same checks as the forms):
- submit_overtime {date, hours, text}: request overtime before it's worked; text is the reason. Only future dates, within the remaining monthly hours; if it won't fit, explain instead.
- submit_leave {leaveType, start, end, text}: leaveType is one of vacation, sick, bereavement, floating, birthday, volunteer, unpaid, paternity, parental.
- confirm_timesheet {}: submit this week's pre-filled timesheet.
- go_to {section}: open a page ("new" for a new expense, "leave", "time", "expenses", "home"). Expenses need a receipt photo, so for an expense open "new" instead of submitting one.
- open_request {requestId}: open one of their requests.`,
  },
  admin: {
    actions: ["approve", "decline", "contact_hr", "open_request"],
    system: `You are Alfie, an AI agent for a client admin (the hiring company's HR, finance or a manager) at the client company. Pebl employs the company's workers as their Employer of Record. You look things up about employees and requests, and act on the admin's decisions.

The context has what's waiting for the admin (with AI suggestions and disclaimers), a profile of every employee (role, country, leave balances, overtime, open and recent requests), and who's away in the next 30 days.

Actions (the platform runs them as soon as you reply):
- approve {requestId}: approve a request waiting for the admin.
- decline {requestId, text}: only when explicitly asked; text is the reason the employee sees. The admin confirms it first. Timesheets can't be declined: hours worked must be paid.
- contact_hr {requestId, text}: send Pebl HR a question about a request.
- open_request {requestId}.
Act only on requests with status "awaiting_admin" (except open_request). The law isn't the admin's call: protected leave can't be refused and hours worked must be paid.`,
  },
};

const schemaFor = (role: AgentRole) => ({
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: PROMPTS[role].actions },
          requestId: { type: "string" },
          text: { type: "string" },
          date: { type: "string" },
          hours: { type: "number" },
          leaveType: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          section: { type: "string" },
        },
        required: ["type", "requestId", "text", "date", "hours", "leaveType", "start", "end", "section"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
});

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: Request) {
  if (!aiConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });

  try {
    const { context, messages } = (await request.json()) as { context: AgentContext | EmployeeAgentContext | AdminAgentContext; messages: Turn[] };
    const role: AgentRole = context?.role === "employee" || context?.role === "admin" ? context.role : "hr";
    const turns = (messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
    if (!context || !turns.length || turns.at(-1)!.role !== "user") throw new AiError("Send the context and a conversation that ends with an instruction.", 400);

    // The context carries the facts, so older turns are safe to drop.
    const recent = turns.slice(-20);
    while (recent[0]?.role !== "user") recent.shift();

    const out = await claudeJson<AgentReply>({
      system: `${PROMPTS[role].system}\n\n${SHARED}\n\n<context>\n${JSON.stringify(context, null, 2)}\n</context>`,
      content: [],
      messages: recent.map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })),
      schema: schemaFor(role),
      effort: "medium",
    });
    // Drop empty fields Claude filled to satisfy the schema.
    out.actions = out.actions.map((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== "" && v !== 0)) as typeof a);
    return Response.json(out);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
