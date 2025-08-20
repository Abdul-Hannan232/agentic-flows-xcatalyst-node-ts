export async function getInvoice(args: { customer: string, month: string }) {
  // Mocked invoice response
  return {
    customer: args.customer,
    month: args.month,
    items: [
      { sku: "SUBSCRIPTION_BASE", qty: 1, price: 1200 },
      { sku: "OVERAGE_API_CALLS", qty: 5000, price: 0.05 }
    ],
    total: 1450
  };
}
