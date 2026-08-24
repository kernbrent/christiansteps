import { AdminError } from "./security";

const TRANSACTION_SEARCH_SCOPE = "https://uri.paypal.com/services/reporting/search/read";
const MAX_PAGES_PER_WINDOW = 10;
const PAGE_SIZE = 500;
const WINDOW_DAYS = 30;
const WINDOW_CONCURRENCY = 5;
const MAX_RETURNED_TRANSACTIONS = 20_000;
const DAY_MILLISECONDS = 86_400_000;

export const PRODUCTS = [
  "HopeSojourns",
  "JoshBeyondBorders",
  "ChristianSteps",
  "Unassigned",
] as const;

export type Product = typeof PRODUCTS[number];
export type TransactionDirection = "received" | "sent";

type NormalizedName = {
  fullName: string;
  givenName: string;
  surname: string;
};

type NormalizedAddress = {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
};

export type NormalizedTransaction = {
  id: string;
  transactionId: string;
  referenceTransactionId: string;
  eventCode: string;
  transactionDate: string;
  updatedDate: string;
  type: string;
  status: string;
  direction: TransactionDirection;
  currency: string;
  gross: number;
  fee: number;
  net: number;
  counterpartyName: string;
  counterpartyEmail: string;
  counterpartyPhone: string;
  addressStatus: string;
  shippingName: string;
  address: NormalizedAddress;
  itemTitle: string;
  itemId: string;
  itemDetails: Record<string, unknown>[];
  productDetected: Product;
  invoiceNumber: string;
  customNumber: string;
  subject: string;
  note: string;
  endingBalance: number | null;
  rawJson: string;
};

export type TransactionSearchResult = {
  transactions: NormalizedTransaction[];
  searchedFrom: string;
  searchedThrough: string;
  scope: "recent" | "full";
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const objectValue = (value: unknown): Record<string, unknown> => isObject(value) ? value : {};

const textValue = (value: unknown, maximum = 4_000): string =>
  typeof value === "string" ? value.normalize("NFKC").trim().slice(0, maximum) : "";

const numberValue = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundedMoney = (value: number): number => Math.round(value * 100) / 100;

const moneyValue = (value: unknown): { currency: string; amount: number } => {
  const money = objectValue(value);
  return {
    currency: textValue(money.currency_code, 10).toUpperCase(),
    amount: roundedMoney(numberValue(money.value)),
  };
};

const normalizeName = (value: unknown): NormalizedName => {
  if (typeof value === "string") return { fullName: textValue(value, 300), givenName: "", surname: "" };
  const name = objectValue(value);
  const givenName = textValue(name.given_name, 150);
  const surname = textValue(name.surname, 150);
  return {
    fullName: textValue(name.full_name || name.alternate_full_name || `${givenName} ${surname}`, 300),
    givenName,
    surname,
  };
};

const normalizeAddress = (value: unknown): NormalizedAddress => {
  const address = objectValue(value);
  return {
    line1: textValue(address.address_line_1 || address.line1, 300),
    line2: textValue(address.address_line_2 || address.line2, 300),
    city: textValue(address.admin_area_2 || address.city, 200),
    region: textValue(address.admin_area_1 || address.state || address.region, 200),
    postalCode: textValue(address.postal_code || address.postalCode, 60),
    countryCode: textValue(address.country_code || address.countryCode, 10).toUpperCase(),
  };
};

const normalizePhone = (value: unknown): string => {
  if (typeof value === "string") return textValue(value, 80);
  const phone = objectValue(value);
  return textValue(phone.national_number || phone.phone_number || phone.phone || phone.value, 80);
};

const statusLabel = (status: string): string => ({
  S: "Completed",
  D: "Denied",
  P: "Pending",
  V: "Reversed",
  F: "Partially Refunded",
}[status] || status || "Unknown");

const eventType = (eventCode: string): string => ({
  T0000: "General Payment",
  T0001: "Mass Payment",
  T0002: "Subscription Payment",
  T0003: "Preapproved Payment",
  T0004: "eBay Auction Payment",
  T0005: "Direct Payment API",
  T0006: "Express Checkout Payment",
  T0013: "Donation Payment",
  T1106: "Payment Reversal",
  T1107: "Payment Refund",
  T0400: "Withdrawal",
  T0300: "Bank Deposit",
}[eventCode] || `PayPal ${eventCode || "Transaction"}`);

const productKey = (value: unknown): string => textValue(value, 1_000)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "");

export function detectProduct(values: unknown[]): Product {
  const keys = values.map(productKey).filter(Boolean);
  if (keys.some(value => value.includes("hopesojourns"))) return "HopeSojourns";
  if (keys.some(value => value.includes("joshbeyondborders") || value.includes("beyondborders"))) {
    return "JoshBeyondBorders";
  }
  if (keys.some(value => value.includes("christiansteps"))) return "ChristianSteps";
  return "Unassigned";
}

const uniqueText = (values: unknown[], maximum = 500): string => Array.from(new Map(
  values
    .map(value => textValue(value, maximum))
    .filter(Boolean)
    .map(value => [value.toLocaleLowerCase("en-US"), value]),
).values()).join("; ").slice(0, maximum);

export function normalizeTransaction(candidate: unknown): NormalizedTransaction | null {
  const detail = objectValue(candidate);
  const transaction = objectValue(detail.transaction_info);
  const payer = objectValue(detail.payer_info);
  const shipping = objectValue(detail.shipping_info);
  const cart = objectValue(detail.cart_info);
  const itemDetails = (Array.isArray(cart.item_details) ? cart.item_details : [])
    .filter(isObject)
    .slice(0, 100);

  const transactionId = textValue(transaction.transaction_id, 128);
  const eventCode = textValue(transaction.transaction_event_code, 20);
  const transactionDate = textValue(transaction.transaction_initiation_date, 80);
  if (!transactionId || !eventCode || Number.isNaN(Date.parse(transactionDate))) return null;

  const amount = moneyValue(transaction.transaction_amount);
  if (!amount.currency) return null;
  const feeMoney = moneyValue(transaction.fee_amount);
  const fee = feeMoney.currency && feeMoney.currency !== amount.currency ? 0 : feeMoney.amount;
  const payerName = normalizeName(payer.payer_name || payer.name);
  const shippingName = normalizeName(shipping.name || shipping.shipping_name);
  const itemTitles = itemDetails.map(item => item.item_name || item.description);
  const itemIds = itemDetails.map(item => item.item_code || item.sku);
  const subject = textValue(transaction.transaction_subject, 500);
  const customNumber = textValue(transaction.custom_field, 500);
  const invoiceNumber = textValue(transaction.invoice_id || cart.invoice_id, 200);
  const itemTitle = uniqueText(itemTitles.length ? itemTitles : [subject], 1_000);
  const itemId = uniqueText(itemIds, 500);
  const productDetected = detectProduct([
    ...itemTitles,
    ...itemIds,
    subject,
    customNumber,
    invoiceNumber,
  ]);
  const endingBalanceMoney = moneyValue(transaction.ending_balance);
  const address = normalizeAddress(shipping.address || payer.address);
  const status = statusLabel(textValue(transaction.transaction_status, 10).toUpperCase());

  return {
    id: `${transactionId}:${eventCode}`,
    transactionId,
    referenceTransactionId: textValue(transaction.paypal_reference_id, 128),
    eventCode,
    transactionDate,
    updatedDate: textValue(transaction.transaction_updated_date, 80),
    type: eventType(eventCode),
    status,
    direction: amount.amount < 0 ? "sent" : "received",
    currency: amount.currency,
    gross: amount.amount,
    fee,
    net: roundedMoney(amount.amount + fee),
    counterpartyName: payerName.fullName || shippingName.fullName,
    counterpartyEmail: textValue(payer.email_address || payer.email, 320),
    counterpartyPhone: normalizePhone(payer.phone_number || payer.phone),
    addressStatus: textValue(payer.address_status, 50),
    shippingName: shippingName.fullName,
    address,
    itemTitle,
    itemId,
    itemDetails,
    productDetected,
    invoiceNumber,
    customNumber,
    subject,
    note: textValue(transaction.transaction_note, 4_000),
    endingBalance: endingBalanceMoney.currency === amount.currency ? endingBalanceMoney.amount : null,
    rawJson: JSON.stringify(detail),
  };
}

const requirePayPalCredentials = (env: Env): void => {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new AdminError(503, "PAYPAL_NOT_CONFIGURED", "The PayPal connection is not configured yet.");
  }
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
};

async function getAccessToken(env: Env): Promise<string> {
  if (env.JBB_PAYPAL) {
    const response = await env.JBB_PAYPAL.fetch(
      new Request("https://jbb-paypal.internal/_internal/paypal-access-token", {
        headers: { "Accept": "application/json" },
      }),
    );
    if (!response.ok) {
      throw new AdminError(503, "PAYPAL_AUTH_FAILED", "The shared PayPal connection needs attention.");
    }
    const result: unknown = await response.json();
    if (!isObject(result) || !textValue(result.accessToken, 4_000)) {
      throw new AdminError(503, "PAYPAL_AUTH_FAILED", "The shared PayPal connection returned an invalid response.");
    }
    return textValue(result.accessToken, 4_000);
  }
  requirePayPalCredentials(env);
  const authorization = bytesToBase64(
    new TextEncoder().encode(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`),
  );
  const response = await fetch(`${env.PAYPAL_API_ORIGIN}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-Language": "en_US",
      "Authorization": `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    throw new AdminError(
      503,
      "PAYPAL_AUTH_FAILED",
      response.status === 401 || response.status === 403
        ? "The PayPal connection needs attention."
        : "PayPal could not be reached. Please try again shortly.",
    );
  }
  const result: unknown = await response.json();
  if (!isObject(result) || !textValue(result.access_token, 4_000)) {
    throw new AdminError(503, "PAYPAL_AUTH_FAILED", "PayPal returned an invalid sign-in response.");
  }
  const grantedScopes = textValue(result.scope, 20_000).split(/\s+/);
  if (grantedScopes.length > 1 && !grantedScopes.includes(TRANSACTION_SEARCH_SCOPE)) {
    throw new AdminError(503, "PAYPAL_SCOPE_MISSING", "The PayPal app does not have Transaction Search access.");
  }
  return textValue(result.access_token, 4_000);
}

async function fetchTransactionWindow(
  accessToken: string,
  startDate: Date,
  endDate: Date,
  env: Env,
): Promise<NormalizedTransaction[]> {
  const transactions: NormalizedTransaction[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_WINDOW; page += 1) {
    const url = new URL(`${env.PAYPAL_API_ORIGIN}/v1/reporting/transactions`);
    url.searchParams.set("start_date", startDate.toISOString());
    url.searchParams.set("end_date", endDate.toISOString());
    url.searchParams.set("fields", "all");
    url.searchParams.set("balance_affecting_records_only", "Y");
    url.searchParams.set("page_size", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: { "Accept": "application/json", "Authorization": `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new AdminError(
        503,
        "PAYPAL_SEARCH_FAILED",
        response.status === 401 || response.status === 403
          ? "The PayPal connection needs attention."
          : "PayPal transactions could not be loaded. Please try again shortly.",
      );
    }
    const result: unknown = await response.json();
    if (!isObject(result)) {
      throw new AdminError(503, "PAYPAL_INVALID_REPORT", "PayPal returned an invalid transaction report.");
    }
    const details = Array.isArray(result.transaction_details) ? result.transaction_details : [];
    for (const detail of details) {
      const transaction = normalizeTransaction(detail);
      if (transaction) transactions.push(transaction);
    }
    const totalPages = Math.max(1, Math.trunc(numberValue(result.total_pages, 1)));
    if (page >= totalPages) return transactions;
  }
  throw new AdminError(503, "PAYPAL_REPORT_TOO_LARGE", "A PayPal report window is too large to sync safely.");
}

function windowRanges(start: Date, end: Date): Array<{ start: Date; end: Date }> {
  const ranges: Array<{ start: Date; end: Date }> = [];
  let windowEnd = new Date(end);
  while (windowEnd > start) {
    const windowStart = new Date(Math.max(start.getTime(), windowEnd.getTime() - WINDOW_DAYS * DAY_MILLISECONDS));
    ranges.push({ start: windowStart, end: windowEnd });
    windowEnd = new Date(windowStart.getTime() - 1);
  }
  return ranges;
}

export async function fetchPayPalTransactions(
  env: Env,
  scope: "recent" | "full",
  now = new Date(),
): Promise<TransactionSearchResult> {
  const configuredDays = Number(scope === "full" ? env.PAYPAL_HISTORY_DAYS : env.PAYPAL_RECENT_DAYS);
  const maximumDays = scope === "full" ? 1_095 : 365;
  const minimumDays = scope === "full" ? 365 : 7;
  const lookbackDays = Math.min(maximumDays, Math.max(minimumDays, Math.trunc(configuredDays || maximumDays)));
  const oldest = new Date(now.getTime() - lookbackDays * DAY_MILLISECONDS);
  const accessToken = await getAccessToken(env);
  const ranges = windowRanges(oldest, now);
  const found: NormalizedTransaction[] = [];

  for (let offset = 0; offset < ranges.length; offset += WINDOW_CONCURRENCY) {
    const batch = ranges.slice(offset, offset + WINDOW_CONCURRENCY);
    const results = await Promise.all(batch.map(range =>
      fetchTransactionWindow(accessToken, range.start, range.end, env),
    ));
    for (const transactions of results) found.push(...transactions);
    if (found.length > MAX_RETURNED_TRANSACTIONS) {
      throw new AdminError(503, "PAYPAL_RESULT_TOO_LARGE", "More PayPal transactions were found than can be synced at once.");
    }
  }

  const unique = new Map<string, NormalizedTransaction>();
  for (const transaction of found) {
    const current = unique.get(transaction.id);
    if (!current || transaction.updatedDate > current.updatedDate) unique.set(transaction.id, transaction);
  }
  return {
    transactions: Array.from(unique.values()).sort((left, right) =>
      right.transactionDate.localeCompare(left.transactionDate),
    ),
    searchedFrom: oldest.toISOString(),
    searchedThrough: now.toISOString(),
    scope,
  };
}
