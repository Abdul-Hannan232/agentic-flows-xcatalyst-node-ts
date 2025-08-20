export async function draftReply(args: { to: string, subject?: string, body?: string, template?: string }) {
  const subject = args.subject ?? "[Xcatalyst] Re: your request";
  const body = args.body ?? `Hi,\n\nThanks for reaching out. We're looking into it.\n\n— Xcatalyst Support`;
  // In dry_run, we don't send; we just return the draft
  return { to: args.to, subject, body, template: args.template ?? null, draft_id: `r_${Math.floor(Math.random()*1e6)}` };
}
