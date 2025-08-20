let counter = 1000;
export async function createIssue(args: { title: string, body: string, labels?: string[] }) {
  return { id: `ISS-${counter++}`, ...args };
}
