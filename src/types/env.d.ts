declare module '@env' {
  export const SUPABASE_URL: string;
  export const SUPABASE_ANON_KEY: string;
  // Public Strava OAuth client id (not a secret). The client secret lives only
  // in Supabase function secrets, never in the app bundle.
  export const STRAVA_CLIENT_ID: string;
  // XRPL network selector: 'testnet' (default) or 'mainnet'. Optional — when
  // unset the app falls back to testnet, preserving existing behavior.
  export const XRPL_NETWORK: string;
  // Collection ("house") wallet that receives penalties with no group mates and
  // forfeited stakes. Optional — falls back to a built-in testnet address.
  export const HOUSE_WALLET: string;
  // Public address of the custodial (omnibus) treasury account that group stakes
  // are deposited into. The treasury SEED is a server-only function secret and is
  // never bundled in the app.
  export const TREASURY_ADDRESS: string;
  // Sentry DSN for crash reporting. Optional — when unset, crash reporting is a
  // no-op (dev/CI never phone home). The DSN is a publishable (non-secret) value.
  export const SENTRY_DSN: string;
}
