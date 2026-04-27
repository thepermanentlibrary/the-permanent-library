/**
 * The Permanent Library — Indexer Entry Point
 *
 * Starts:
 *   1. PostgreSQL connection and schema initialization
 *   2. Chain scanners for Ethereum, Polygon, and Arbitrum
 *   3. Express REST API + search portal
 *
 * Security measures:
 *   - Rate limiting (per-IP, in-memory sliding window)
 *   - Security headers (CSP, HSTS, X-Frame-Options, etc.)
 *   - CORS policy (configurable via ALLOWED_ORIGINS env var)
 *   - Request timeout
 *   - Static asset caching
 *
 * Per master doc § Indexer Security Note:
 *   The indexer has NO write access to the blockchain.
 *   It is read-only. Compromising it cannot modify or delete on-chain data.
 *   The indexer is like a library catalog — burning the catalog
 *   doesn't burn the books.
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ENV, BURN_ADDRESS } from './config.js';
import { initDatabase } from './db.js';
import { startAllScanners } from './scanner.js';
import apiRouter from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Rate Limiter (in-memory, no dependencies)
// ============================================================================

/**
 * Simple sliding window rate limiter per IP address.
 * Tracks request timestamps per IP and rejects requests that exceed the limit.
 * Automatically cleans up old entries to prevent memory leaks.
 *
 * @param {number} windowMs — Time window in milliseconds
 * @param {number} maxRequests — Max requests per IP per window
 * @returns {Function} Express middleware
 */
function createRateLimiter(windowMs, maxRequests) {
  const requests = new Map(); // IP -> [timestamp, timestamp, ...]

  // Periodic cleanup to prevent memory growth from abandoned IPs
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requests) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) {
        requests.delete(ip);
      } else {
        requests.set(ip, valid);
      }
    }
  }, 60000);

  // Don't let the cleanup timer prevent Node.js from exiting
  cleanupTimer.unref();

  return (req, res, next) => {
    // Use CF-Connecting-IP (Cloudflare's guaranteed real client IP, cannot be forged),
    // fallback to X-Forwarded-For for non-Cloudflare setups, then socket IP.
    const ip = req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';

    const now = Date.now();
    const windowStart = now - windowMs;

    // Get existing timestamps and filter to current window
    const timestamps = (requests.get(ip) || []).filter(t => t > windowStart);

    if (timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter,
      });
      return;
    }

    timestamps.push(now);
    requests.set(ip, timestamps);
    next();
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('The Permanent Library — Indexer');
  console.log('='.repeat(60));
  console.log(`Burn address: ${BURN_ADDRESS}`);
  console.log(`Database: ${ENV.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`API: http://${ENV.HOST}:${ENV.PORT}`);
  console.log('');

  // 1. Initialize database
  console.log('[Init] Connecting to PostgreSQL…');
  await initDatabase();

  // 2. Start chain scanners
  console.log('[Init] Starting chain scanners…');
  const stopScanners = await startAllScanners();

  // 3. Start API server
  const app = express();

  // Disable X-Powered-By header (defense-in-depth — also stripped by nginx)
  app.disable('x-powered-by');
  // --- Security headers ---
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // CSP: data: URIs allowed in img-src for embedded Base64 images in documents
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "font-src 'self'; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'"
    );
    // HSTS — enforce HTTPS for 1 year (effective once behind HTTPS/Cloudflare)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Disable unnecessary browser features
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // --- CORS ---
  // Default: allow all origins (needed for standalone reader.html opened from local files).
  // Production: set ALLOWED_ORIGINS in .env to restrict (e.g. "https://thepermanentlibrary.org")
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : null;

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (allowedOrigins) {
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  // --- Request timeout (30 seconds) ---
  app.use((req, res, next) => {
    res.setTimeout(30000, () => {
      res.status(408).json({ error: 'Request timeout' });
    });
    next();
  });

  // --- Rate limiting on API endpoints ---
  // 60 requests per minute per IP (1 per second average)
  // Generous enough for browsing, tight enough to prevent abuse
  const apiLimiter = createRateLimiter(60000, 60);
  app.use('/api', apiLimiter);

  // --- API routes ---
  app.use('/api', apiRouter);

  // --- Static search portal ---
  // Cache static assets for 1 hour (Cloudflare respects this)
  app.use(express.static(join(__dirname, '..', 'public'), {
    maxAge: '1h',
    etag: true,
    lastModified: true,
  }));

  // --- Fallback to portal for non-API routes ---
  app.get('/{*path}', (req, res) => {
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  });

  // Start listening
  app.listen(ENV.PORT, ENV.HOST, () => {
    console.log(`[API] Server listening on http://${ENV.HOST}:${ENV.PORT}`);
    console.log('');
    console.log('Ready. The indexer is scanning for documents.');
    console.log('Search portal: http://' + ENV.HOST + ':' + ENV.PORT);
    console.log('API: http://' + ENV.HOST + ':' + ENV.PORT + '/api/');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Shutdown] Stopping scanners…');
    stopScanners();
    console.log('[Shutdown] Done.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Fatal]', err);
  process.exit(1);
});
