// src/mocks/billing.ts

export interface Invoice {
    id: string;
    customer: string;
    amount: number;
    status: "paid" | "unpaid" | "overdue";
  }
  
  export interface Usage {
    customer: string;
    apiCalls: number;
    storageGB: number;
  }
  
  const invoices: Invoice[] = [
    { id: "inv001", customer: "acme", amount: 1200, status: "paid" },
    { id: "inv002", customer: "globex", amount: 800, status: "overdue" },
  ];
  
  const usage: Usage[] = [
    { customer: "acme", apiCalls: 5000, storageGB: 12 },
    { customer: "globex", apiCalls: 2000, storageGB: 5 },
  ];
  
  export function listInvoices() {
    return invoices;
  }
  
  export function getInvoice(id: string) {
    return invoices.find((inv) => inv.id === id);
  }
  
  export function getUsage(customer: string) {
    return usage.find((u) => u.customer === customer);
  }
  