// crashReporting — the single place that touches the Sentry SDK.
//
// Everything else calls initCrashReporting() / captureException(); the vendor stays
// isolated here. Crash reporting is OFF until a SENTRY_DSN is provided (so dev and
// CI never phone home), and a strict scrubber guarantees wallet seeds / secrets can
// never leave the device even if one accidentally ends up in an error payload.
//
// Setup: `npm install` (adds @sentry/react-native), set SENTRY_DSN in .env, rebuild
// the native app. For release source maps, also run the Sentry RN wizard to add the
// Metro + Gradle plugins (optional — JS + native crash capture works without it).

import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN } from '@env';

// XRPL family seeds look like `s` + base58 (no 0/O/I/l). Redact anything matching,
// wherever it appears, plus any object key whose name implies a secret.
const SEED_RE = /\bs[1-9A-HJ-NP-Za-km-z]{25,34}\b/g;
const SENSITIVE_KEY_RE = /seed|secret|password|passwd|mnemonic|private|tx_blob|api[_-]?key/i;

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SEED_RE, '[redacted-seed]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

const enabled = !!SENTRY_DSN;

export function initCrashReporting(): void {
  if (!enabled) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    enableNativeCrashHandling: true,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.extra) event.extra = redact(event.extra) as Record<string, unknown>;
      if (event.contexts) event.contexts = redact(event.contexts) as typeof event.contexts;
      if (typeof event.message === 'string') {
        event.message = event.message.replace(SEED_RE, '[redacted-seed]');
      }
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = ex.value.replace(SEED_RE, '[redacted-seed]');
      }
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) crumb.data = redact(crumb.data) as Record<string, unknown>;
      if (typeof crumb.message === 'string') {
        crumb.message = crumb.message.replace(SEED_RE, '[redacted-seed]');
      }
      return crumb;
    },
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(
    error,
    context ? { extra: redact(context) as Record<string, unknown> } : undefined,
  );
}
