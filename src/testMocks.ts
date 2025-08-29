import * as billing from "./mocks/billing";
import * as issues from "./mocks/issues";

console.log("All invoices:", billing.listInvoices());
console.log("Usage (acme):", billing.getUsage("acme"));

console.log("All issues:", issues.listIssues());
console.log("Issues (globex):", issues.getIssuesByCustomer("globex"));
