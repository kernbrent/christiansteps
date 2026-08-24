interface Env {
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  JBB_PAYPAL: Fetcher;
  HOPE_ADMIN: Fetcher;
  CSM_DISTRIBUTION_SECRET?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_API_ORIGIN: string;
  PAYPAL_HISTORY_DAYS: string;
  PAYPAL_RECENT_DAYS: string;
  ALLOWED_ORIGINS: string;
  DISPLAY_TIME_ZONE: string;
}
