// src/memory/short.ts
export interface ShortObservation {
  step: number;
  tool: string;
  args: any;
  observation: any;
  timestamp: string;
}

export interface ShortTermMemory {
  ticket_id: string;
  observations: ShortObservation[];
  assumptions: string[];
  actions: string[];
}

let memory: ShortTermMemory | null = null;

export function initShortMemory(ticket_id: string) {
  memory = {
    ticket_id,
    observations: [],
    assumptions: [],
    actions: [],
  };
  return memory;
}

export function getShortMemory() {
  return memory;
}

export function pushObservation(step: number, tool: string, args: any, observation: any) {
  if (!memory) return;
  memory.observations.push({
    step,
    tool,
    args,
    observation,
    timestamp: new Date().toISOString(),
  });
}

export function pushAssumption(text: string) {
  if (!memory) return;
  memory.assumptions.push(text);
}

export function pushAction(text: string) {
  if (!memory) return;
  memory.actions.push(text);
}

export function getFacts(): string[] {
  if (!memory) return [];
  const facts: string[] = [];
  for (const a of memory.assumptions) facts.push(a);
  for (const o of memory.observations) {
    try {
      // keep observation text short
      facts.push(JSON.stringify(o.observation).slice(0, 800));
    } catch {
      // ignore bad serializations
    }
  }
  for (const act of memory.actions) facts.push(act);
  return facts;
}

export function resetShortMemory() {
  memory = null;
}
