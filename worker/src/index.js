/**
 * CRUZE MAIL — Cloudflare Worker
 * Handles incoming emails and API requests for the temp mail service.
 */
import { handleEmail } from './email-handler.js';
import { encrypt, decrypt } from './crypto.js';
import { generateRandomName, corsHeaders, jsonResponse } from './utils.js';
import { writeDocument, readDocument, deleteByInboxId } from './firebase.js';

// Simple in-memory rate limiting (max 10 creations per hour per IP)
const rateLimits = new Map();

export default {
  /**
   * Email handler — triggered by Cloudflare Email Routing.
   */
  async email(message, env, ctx) {
    try {
      await handleEmail(message, env);
    } catch (err) {
      console.error('Email handler error:', err);
    }
  },

  /**
   * HTTP handler — API endpoints + CORS.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.FRONTEND_URL);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Route API requests
      if (url.pathname === '/api/inbox' && request.method === 'POST') {
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const nowSec = Math.floor(Date.now() / 1000);
        let rl = rateLimits.get(ip);
        if (!rl || rl.resetAt < nowSec) {
          rl = { count: 0, resetAt: nowSec + 3600 };
        }
        if (rl.count >= 50) {
          return jsonResponse({ error: 'Rate limit exceeded (50 per hour). Try again later.' }, 429, cors);
        }
        rl.count += 1;
        rateLimits.set(ip, rl);

        let body = {};
        try {
          body = await request.json();
        } catch (e) {}
        return await createInbox(env, cors, body.domain);
      }

      if (url.pathname === '/api/inbox/renew' && request.method === 'POST') {
        let body = {};
        try {
          body = await request.json();
        } catch (e) {}
        return await renewInbox(body.token, env, cors);
      }

      if (url.pathname === '/api/inbox/save' && request.method === 'POST') {
        let body = {};
        try {
          body = await request.json();
        } catch (e) {}
        return await saveInboxPermanently(body.token, env, cors);
      }

      const inboxMatch = url.pathname.match(/^\/api\/inbox\/([^/]+)$/);
      if (inboxMatch) {
        const token = decodeURIComponent(inboxMatch[1]);
        if (request.method === 'GET') return await getInboxInfo(token, env, cors);
        if (request.method === 'DELETE') return await deleteInbox(token, env, cors);
      }

      const emailMatch = url.pathname.match(/^\/api\/email\/([^/]+)\/([^/]+)$/);
      if (emailMatch && request.method === 'GET') {
        const token = decodeURIComponent(emailMatch[1]);
        const emailId = emailMatch[2];
        return await getEmail(token, emailId, env, cors);
      }

      return jsonResponse({ error: 'Not found' }, 404, cors);
    } catch (err) {
      console.error('API error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500, cors);
    }
  },
};

/**
 * POST /api/inbox — Create a new temporary inbox.
 */
async function createInbox(env, cors, requestedDomain) {
  const allowedDomains = (env.DOMAINS || '').split(',').map(d => d.trim()).filter(Boolean);
  const fallbackDomain = allowedDomains.length > 0 ? allowedDomains[0] : 'wasdmc.qzz.io';
  const domain = allowedDomains.includes(requestedDomain) ? requestedDomain : fallbackDomain;

  const name = generateRandomName();
  const email = `${name}@${domain}`;
  const inboxId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 24 * 3600;

  // Store the email → inboxId mapping
  await writeDocument(env, 'emailMap', name, {
    inboxId,
    email,
    createdAt: now,
    expiresAt,
  });

  // Encrypt the inboxId into a token
  const token = await encrypt(JSON.stringify({ inboxId, email, expiresAt }), env.ENCRYPTION_KEY);

  return jsonResponse({ token, email, expiresAt }, 201, cors);
}

/**
 * POST /api/inbox/renew — Add 24h to TTL if under 24h left.
 */
async function renewInbox(tokenStr, env, cors) {
  if (!tokenStr) return jsonResponse({ error: 'Token missing' }, 400, cors);
  try {
    const decrypted = await decrypt(tokenStr, env.ENCRYPTION_KEY);
    const { inboxId, email, expiresAt: tokenExpiresAt } = JSON.parse(decrypted);
    
    const localPart = email.split('@')[0];
    const mapping = await readDocument(env, 'emailMap', localPart);
    
    if (!mapping || mapping.inboxId !== inboxId) {
      return jsonResponse({ error: 'Inbox not found' }, 404, cors);
    }
    
    const now = Math.floor(Date.now() / 1000);
    const currentExpiresAt = Number(mapping.expiresAt || tokenExpiresAt);
    
    if (currentExpiresAt - now >= 86400) {
      return jsonResponse({ error: 'Cannot renew: TTL is already 24 hours or more' }, 400, cors);
    }
    
    const newExpiresAt = Math.min(currentExpiresAt + 86400, now + 172800); // Max 48h from now
    
    await writeDocument(env, 'emailMap', localPart, {
      inboxId: mapping.inboxId,
      email: mapping.email,
      createdAt: mapping.createdAt ? Number(mapping.createdAt) : now,
      expiresAt: newExpiresAt
    });
    
    const newToken = await encrypt(JSON.stringify({ inboxId, email, expiresAt: newExpiresAt }), env.ENCRYPTION_KEY);
    return jsonResponse({ token: newToken, email, expiresAt: newExpiresAt }, 200, cors);
  } catch (err) {
    return jsonResponse({ error: `Server error: ${err.message}` }, 400, cors);
  }
}

/**
 * POST /api/inbox/save — Make an inbox permanent (never expire).
 */
async function saveInboxPermanently(tokenStr, env, cors) {
  if (!tokenStr) return jsonResponse({ error: 'Token missing' }, 400, cors);
  try {
    const decrypted = await decrypt(tokenStr, env.ENCRYPTION_KEY);
    const { inboxId, email } = JSON.parse(decrypted);
    
    const localPart = email.split('@')[0];
    const mapping = await readDocument(env, 'emailMap', localPart);
    
    if (!mapping || mapping.inboxId !== inboxId) {
      return jsonResponse({ error: 'Inbox not found' }, 404, cors);
    }
    
    const newExpiresAt = 2147483647; // Year 2038
    
    await writeDocument(env, 'emailMap', localPart, {
      inboxId: mapping.inboxId,
      email: mapping.email,
      createdAt: mapping.createdAt ? Number(mapping.createdAt) : Math.floor(Date.now() / 1000),
      expiresAt: newExpiresAt
    });
    
    const newToken = await encrypt(JSON.stringify({ inboxId, email, expiresAt: newExpiresAt }), env.ENCRYPTION_KEY);
    return jsonResponse({ token: newToken, email, expiresAt: newExpiresAt }, 200, cors);
  } catch (err) {
    return jsonResponse({ error: `Server error: ${err.message}` }, 400, cors);
  }
}

/**
 * GET /api/inbox/:token — Decrypt token and return inbox info.
 */
async function getInboxInfo(token, env, cors) {
  try {
    const decrypted = await decrypt(token, env.ENCRYPTION_KEY);
    const { inboxId, email, expiresAt } = JSON.parse(decrypted);
    return jsonResponse({ inboxId, email, expiresAt }, 200, cors);
  } catch {
    return jsonResponse({ error: 'Invalid or expired token' }, 400, cors);
  }
}

/**
 * GET /api/email/:token/:emailId — Get a specific email's full content.
 */
async function getEmail(token, emailId, env, cors) {
  try {
    const decrypted = await decrypt(token, env.ENCRYPTION_KEY);
    const { inboxId } = JSON.parse(decrypted);

    const email = await readDocument(env, 'emails', emailId);
    if (!email || email.inboxId !== inboxId) {
      return jsonResponse({ error: 'Email not found' }, 404, cors);
    }
    return jsonResponse(email, 200, cors);
  } catch {
    return jsonResponse({ error: 'Invalid token' }, 400, cors);
  }
}

/**
 * DELETE /api/inbox/:token — Delete all emails for an inbox.
 */
async function deleteInbox(token, env, cors) {
  try {
    const decrypted = await decrypt(token, env.ENCRYPTION_KEY);
    const { inboxId } = JSON.parse(decrypted);
    await deleteByInboxId(env, inboxId);
    return jsonResponse({ success: true }, 200, cors);
  } catch {
    return jsonResponse({ error: 'Invalid token' }, 400, cors);
  }
}
