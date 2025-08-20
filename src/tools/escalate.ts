export async function escalate(args: { queue: "billing"|"support"|"oncall", reason: string }) {
  return { escalated: true, queue: args.queue, reason: args.reason, ticket: `E-${Math.floor(Math.random()*1e6)}` };
}
