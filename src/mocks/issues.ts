// src/mocks/issues.ts

export interface Issue {
    id: string;
    customer: string;
    severity: "P1" | "P2" | "P3";
    status: "open" | "in_progress" | "resolved";
    description: string;
  }
  
  const issues: Issue[] = [
    { id: "iss001", customer: "acme", severity: "P1", status: "open", description: "Multi-tenant outage" },
    { id: "iss002", customer: "globex", severity: "P2", status: "in_progress", description: "Single-tenant API slowdown" },
  ];
  
  export function listIssues() {
    return issues;
  }
  
  export function getIssue(id: string) {
    return issues.find((iss) => iss.id === id);
  }
  
  export function getIssuesByCustomer(customer: string) {
    return issues.filter((iss) => iss.customer === customer);
  }
  