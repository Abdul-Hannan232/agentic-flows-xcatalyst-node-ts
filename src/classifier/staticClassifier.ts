// src/classifier/staticClassifier.ts

export type Classification = {
    category: "billing" | "technical" | "account" | "other";
    severity: "low" | "medium" | "high";
  };
  
  export type Plan = {
    goal: string;
    assumptions: string[];
    steps: { tool: string; args: Record<string, any> }[];
    stopping_conditions: string[];
  };
  
  export type ClassifiedPlan = {
    classification: Classification;
    plan: Plan;
  };
  
  /**
   * Very simple rule-based classifier
   */
  export function classifyTicket(ticket: { subject?: string; body?: string }): Classification {
    const text = `${ticket.subject ?? ""} ${ticket.body ?? ""}`.toLowerCase();
  
    // Default classification
    let category: Classification["category"] = "other";
    let severity: Classification["severity"] = "medium";
  
    // Category rules
    if (/\b(invoice|billing|charge|payment)\b/.test(text)) {
      category = "billing";
    } else if (/\b(error|bug|crash|fail)\b/.test(text)) {
      category = "technical";
    } else if (/\b(login|password|account|signup)\b/.test(text)) {
      category = "account";
    }
  
    // Severity rules
    if (/\b(urgent|asap|immediately|critical|down)\b/.test(text)) {
      severity = "high";
    } else if (/\b(minor|low)\b/.test(text)) {
      severity = "low";
    }
  
    return { category, severity };
  }
  
  /**
   * Generates a static plan given classification
   */
  export function generateStaticPlan(
    ticket: { id?: string; subject?: string; body?: string },
    classification: Classification
  ): Plan {
    const ticketId = ticket.id ?? "unknown";
  
    return {
      goal: `Escalate ${classification.category} issue for human review.`,
      assumptions: ["Static fallback plan used."],
      steps: [
        {
          tool: "escalate.toHuman",
          args: {
            ticket_id: ticketId,
            reason: `Static demo plan for ${classification.category} issue`,
          },
        },
      ],
      stopping_conditions: ["Ticket has been escalated to a human agent."],
    };
  }
  