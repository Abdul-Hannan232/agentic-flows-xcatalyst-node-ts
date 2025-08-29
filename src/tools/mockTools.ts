// src/tools/mockTools.ts
import { listInvoices, getUsage } from "../mocks/billing";
import { listIssues, getIssue } from "../mocks/issues";

// Billing
export async function listInvoicesTool() {
  return listInvoices();
}

export async function getUsageTool({ customer }: { customer: string }) {
  return getUsage(customer);
}

// Support
export async function listIssuesTool() {
  return listIssues();
}

export async function getIssuesTool({ customer }: { customer: string }) {
  return getIssue(customer);
}
