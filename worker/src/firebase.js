/**
 * Firebase Firestore REST API client for Cloudflare Workers.
 * Authenticates via GCP service account JWT → OAuth2 access token.
 */

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Import a PEM private key for RS256 signing.
 */
async function importPrivateKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Create a signed JWT for Google OAuth2.
 */
async function createJWT(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };

  const encode = (obj) => {
    const json = JSON.stringify(obj);
    return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${sigB64}`;
}

/**
 * Get an OAuth2 access token (cached for ~1 hour).
 */
async function getAccessToken(env) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const jwt = await createJWT(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OAuth2 token error: ${resp.status} ${errText}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

/**
 * Convert a JS value to Firestore Value format.
 */
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'boolean') return { booleanValue: val };
  return { stringValue: String(val) };
}

/**
 * Write a document to Firestore.
 */
export async function writeDocument(env, collection, docId, data) {
  const token = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;

  const fields = {};
  for (const [key, val] of Object.entries(data)) {
    fields[key] = toFirestoreValue(val);
  }

  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore write error: ${resp.status} ${errText}`);
  }
  return resp.json();
}

/**
 * Read a document from Firestore.
 */
export async function readDocument(env, collection, docId) {
  const token = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${docId}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore read error: ${resp.status} ${errText}`);
  }

  const doc = await resp.json();
  const result = {};
  if (doc.fields) {
    for (const [key, val] of Object.entries(doc.fields)) {
      result[key] = val.stringValue ?? val.integerValue ?? val.doubleValue ?? val.booleanValue ?? null;
    }
  }
  return result;
}

/**
 * Query documents from Firestore by field value.
 */
export async function queryDocuments(env, collection, field, value) {
  const token = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: toFirestoreValue(value),
          },
        },
        orderBy: [{ field: { fieldPath: 'receivedAt' }, direction: 'DESCENDING' }],
        limit: 50,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore query error: ${resp.status} ${errText}`);
  }

  const results = await resp.json();
  return results
    .filter((r) => r.document)
    .map((r) => {
      const data = {};
      for (const [key, val] of Object.entries(r.document.fields || {})) {
        data[key] = val.stringValue ?? val.integerValue ?? val.doubleValue ?? val.booleanValue ?? null;
      }
      return data;
    });
}

/**
 * Delete all emails for a given inboxId.
 */
export async function deleteByInboxId(env, inboxId) {
  const emails = await queryDocuments(env, 'emails', 'inboxId', inboxId);
  const token = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;

  for (const email of emails) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/emails/${email.id}`;
    await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
