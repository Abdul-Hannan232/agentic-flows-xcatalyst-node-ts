import { triageTicket } from "./src/agent/simpleLoop";

const mockTicket = {
  id: "t_refund_600",
  from: "jane@acme.com",
  subject: "Refund request",
  body: "Please refund me $600 for my faulty product.",
  channel: "email",
  received_at: "2025-09-09T10:00:00Z",
};

const result = await triageTicket(mockTicket);
console.log("Final Result:", result);
