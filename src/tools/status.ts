export async function getStatus() {
  return { service: "core-api", status: "green", updated_at: new Date().toISOString() };
}
