/**
 * sanitizer.js — Shared sanitization module for Bug Report Extension
 *
 * Implements multi-layer privacy protection:
 *   Layer 1: Data minimization (handled at collection sites)
 *   Layer 2: Allowlist-based collection (handled at collection sites)
 *   Layer 3: Field-level exclusion (handled at collection sites)
 *   Layer 4: Pattern sanitization (this module)
 *   Layer 5: Final JSON validation (this module)
 */

const Sanitizer = (() => {
  // ── Query Parameter Allowlist & Blocklist ──────────────────────────

  const SAFE_QUERY_PARAMS = new Set([
    'page', 'p', 'per_page', 'limit', 'offset',
    'sort', 'order', 'orderby', 'sortby', 'dir', 'direction',
    'filter', 'q', 'query', 'search',
    'tab', 'view', 'mode', 'display',
    'lang', 'locale', 'language', 'hl',
    'feature', 'flag', 'variant', 'experiment',
    'category', 'type', 'status', 'state',
    'ref', 'source', 'utm_source', 'utm_medium', 'utm_campaign',
    'step', 'section', 'anchor',
    'eventorigin',
  ]);

  const SENSITIVE_QUERY_PARAMS = new Set([
    'token', 'access_token', 'refresh_token', 'id_token', 'auth_token',
    'session', 'sessionid', 'session_id', 'sid',
    'apikey', 'api_key', 'key', 'client_secret', 'secret',
    'password', 'passwd', 'pwd',
    'email', 'mail', 'e-mail',
    'userid', 'user_id', 'uid', 'customerid', 'customer_id',
    'orderid', 'order_id',
    'ssn', 'credit_card', 'cc', 'cvv',
    'auth', 'authorization', 'bearer',
    'code', 'otp', 'verification', 'reset_token',
    'nonce', 'csrf', 'xsrf',
  ]);

  // ── Regex Patterns for Sensitive Data ──────────────────────────────

  const SANITIZATION_PATTERNS = [
    {
      name: 'email',
      pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      replacement: '[REDACTED_EMAIL]',
    },
    {
      name: 'phone',
      pattern: /(?<![a-zA-Z0-9])(?:\+?\d{1,4}[\s\-.]?)?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,5}(?![a-zA-Z0-9])/g,
      replacement: '[REDACTED_PHONE]',
    },
    {
      name: 'bearer_token',
      pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
      replacement: 'Bearer [REDACTED_TOKEN]',
    },
    {
      name: 'jwt',
      pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*/g,
      replacement: '[REDACTED_JWT]',
    },
    {
      name: 'api_key',
      pattern: /(?:api[_\-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi,
      replacement: '[REDACTED_API_KEY]',
    },
    {
      name: 'generic_secret',
      pattern: /(?:secret|private[_\-]?key|client[_\-]?secret)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi,
      replacement: '[REDACTED_SECRET]',
    },
    {
      name: 'password_field',
      pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"',}{]{1,}["']?/gi,
      replacement: '[REDACTED_PASSWORD]',
    },
    {
      name: 'session_id',
      pattern: /(?:session[_\-]?id|sid|jsessionid|phpsessid)\s*[:=]\s*["']?[A-Za-z0-9\-._]{8,}["']?/gi,
      replacement: '[REDACTED_SESSION]',
    },
    {
      name: 'cookie',
      pattern: /(?:cookie|set-cookie)\s*[:=]\s*["']?[^\n"']{8,}["']?/gi,
      replacement: '[REDACTED_COOKIE]',
    },
    {
      name: 'authorization',
      pattern: /(?:authorization)\s*[:=]\s*["']?[^\n"']{8,}["']?/gi,
      replacement: '[REDACTED_AUTH]',
    },
  ];

  // ── URL Sanitization ───────────────────────────────────────────────

  /**
   * Sanitize a URL: preserve path, sanitize query parameters.
   * - Safe params: kept as-is
   * - Sensitive params: removed entirely
   * - Unknown params: value replaced with [PARAM_REMOVED]
   */
  function sanitizeUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') return urlString;

    try {
      const url = new URL(urlString);
      const sanitizedParams = new URLSearchParams();
      let hadParams = false;

      for (const [key, value] of url.searchParams) {
        hadParams = true;
        const keyLower = key.toLowerCase();

        if (SENSITIVE_QUERY_PARAMS.has(keyLower)) {
          // Sensitive: remove entirely (don't even include the key)
          continue;
        } else if (SAFE_QUERY_PARAMS.has(keyLower)) {
          // Safe: keep as-is
          sanitizedParams.set(key, value);
        } else {
          // Unknown: keep key, mask value
          sanitizedParams.set(key, '[PARAM_REMOVED]');
        }
      }

      url.search = sanitizedParams.toString();

      // Also strip hash if it looks like it contains sensitive data
      if (url.hash && url.hash.length > 100) {
        url.hash = '';
      }

      return url.toString();
    } catch {
      // Not a valid URL — apply text sanitization instead
      return sanitizeText(urlString);
    }
  }

  // ── Text Sanitization ──────────────────────────────────────────────

  /**
   * Sanitize a text string by applying all regex patterns.
   * Returns { text, redactions } where redactions counts per pattern.
   */
  function sanitizeText(text, redactions = null) {
    if (!text || typeof text !== 'string') return text;

    let result = text;
    for (const { name, pattern, replacement } of SANITIZATION_PATTERNS) {
      const before = result;
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement);
      if (redactions && result !== before) {
        const count = (before.match(pattern) || []).length;
        pattern.lastIndex = 0;
        redactions[name] = (redactions[name] || 0) + count;
      }
    }

    return result;
  }

  // ── Deep Sanitization ──────────────────────────────────────────────

  /**
   * Recursively sanitize all string values in an object/array.
   * URL fields get URL-specific sanitization.
   */
  function sanitizeDeep(obj, redactions = {}) {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return sanitizeText(obj, redactions);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeDeep(item, redactions));
    }

    if (typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();

        // URL fields get URL-specific sanitization
        if (keyLower === 'url' || keyLower.endsWith('url') || keyLower === 'href') {
          result[key] = typeof value === 'string' ? sanitizeUrl(value) : sanitizeDeep(value, redactions);
        } else {
          result[key] = sanitizeDeep(value, redactions);
        }
      }
      return result;
    }

    return obj;
  }

  // ── Final Validation (Layer 5) ─────────────────────────────────────

  /**
   * Walk the entire JSON tree and flag any remaining suspicious patterns.
   * Returns true if the data passes validation.
   */
  function validateFinalReport(report) {
    const issues = [];
    const jsonStr = JSON.stringify(report);

    // Check for any remaining email-like patterns
    const emailCheck = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emailMatches = jsonStr.match(emailCheck);
    if (emailMatches) {
      issues.push(`Found ${emailMatches.length} potential email address(es)`);
    }

    // Check for any remaining JWT-like patterns
    const jwtCheck = /eyJ[A-Za-z0-9\-_]{10,}/g;
    const jwtMatches = jsonStr.match(jwtCheck);
    if (jwtMatches) {
      issues.push(`Found ${jwtMatches.length} potential JWT token(s)`);
    }

    return {
      passed: issues.length === 0,
      issues,
    };
  }

  // ── Build Sanitization Summary ─────────────────────────────────────

  function buildSummary(redactions) {
    const totalRedactions = Object.values(redactions).reduce((a, b) => a + b, 0);
    return {
      totalRedactions,
      redactionsByType: { ...redactions },
    };
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    sanitizeUrl,
    sanitizeText,
    sanitizeDeep,
    validateFinalReport,
    buildSummary,
    SAFE_QUERY_PARAMS,
    SENSITIVE_QUERY_PARAMS,
  };
})();

// Make available in different contexts
if (typeof globalThis !== 'undefined') {
  globalThis.Sanitizer = Sanitizer;
}
