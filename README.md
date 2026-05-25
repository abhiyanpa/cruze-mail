# CRUZE MAIL

Instant temporary email service powered by **Cloudflare Workers** + **Firebase Firestore**.

- **Domain:** `wasdmc.qzz.io`
- **Frontend:** `tempmail.abhiyanpa.in`
- **Real-time:** Emails appear instantly via Firestore `onSnapshot`
- **Encrypted URLs:** Inbox tokens are AES-256-GCM encrypted — no one can guess your mailbox
- **Auto-expire:** Emails are automatically deleted after 24 hours

---

## Architecture

```
Email Sender → Cloudflare Email Routing (catch-all) → CF Worker → Firebase Firestore
                                                                        ↕
                                                       Frontend (Vercel) ← real-time onSnapshot
```

---

## Setup Guide

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/u/0/project/cruzemail/overview)
2. Enable **Firestore Database** (start in production mode)
3. Deploy the Firestore rules:
   ```bash
   # Install Firebase CLI
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules --project cruzemail
   ```
4. Create a Firestore **composite index**:
   - Collection: `emails`
   - Fields: `inboxId` (Ascending), `receivedAt` (Descending)
   - Go to: Firestore → Indexes → Create Index
5. **(Optional)** Enable TTL auto-delete:
   ```bash
   gcloud firestore fields ttls update expiresAt \
     --collection-group=emails \
     --enable-sentinel \
     --project=cruzemail
   ```

### 2. Firebase Service Account

1. Go to [Firebase Console → Project Settings → Service Accounts](https://console.firebase.google.com/u/0/project/cruzemail/settings/serviceaccounts/adminsdk)
2. Click **"Generate new private key"** — download the JSON file
3. You'll need `client_email` and `private_key` from this file

### 3. Deploy the Worker

```bash
cd worker
npm install

# Set secrets
npx wrangler secret put ENCRYPTION_KEY
# Enter a random string (e.g.: openssl rand -hex 32)

npx wrangler secret put FIREBASE_CLIENT_EMAIL
# Paste the client_email from the service account JSON

npx wrangler secret put FIREBASE_PRIVATE_KEY
# Paste the entire private_key string (including -----BEGIN/END PRIVATE KEY-----)

# Deploy
npx wrangler deploy
```

### 4. Configure Cloudflare Email Routing

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → select your zone for `qzz.io`
2. Navigate to **Email → Email Routing**
3. Create a **Catch-all rule** → Action: **Send to Worker** → Select `cruze-mail-worker`

### 5. Update Frontend API URL

Edit `frontend/js/app.js` and replace the `WORKER_API` constant:
```javascript
const WORKER_API = 'https://cruze-mail-worker.YOUR_SUBDOMAIN.workers.dev';
```
Replace `YOUR_SUBDOMAIN` with your actual Cloudflare Workers subdomain.

### 6. Deploy Frontend to Vercel

```bash
cd frontend

# Using Vercel CLI
npm install -g vercel
vercel --prod
```

Then configure your DNS:
- Add a CNAME record for `tempmail.abhiyanpa.in` pointing to your Vercel deployment URL.

---

## Project Structure

```
├── worker/                    # Cloudflare Worker
│   ├── src/
│   │   ├── index.js           # Main entry (email + fetch handlers)
│   │   ├── email-handler.js   # MIME parsing + Firestore write
│   │   ├── firebase.js        # Firestore REST API client
│   │   ├── crypto.js          # AES-256-GCM encryption
│   │   └── utils.js           # Random names, CORS helpers
│   ├── wrangler.toml          # Worker config
│   └── package.json
│
├── frontend/                  # Static site (Vercel)
│   ├── index.html             # Main SPA
│   ├── css/style.css          # Premium dark theme
│   ├── js/
│   │   ├── app.js             # Main logic
│   │   ├── firebase-config.js # Firebase init
│   │   └── ui.js              # UI rendering
│   ├── vercel.json            # Vercel config
│   └── package.json
│
├── firestore.rules            # Firestore security rules
└── README.md
```

---

## Security

- **Encrypted tokens:** Inbox IDs are encrypted with AES-256-GCM. Without the server's encryption key, tokens cannot be forged.
- **Unguessable inboxes:** Each inbox has a UUID v4 identifier (2^122 possible values).
- **No client writes:** Firestore rules prevent any client-side data modification.
- **Sandboxed HTML:** Email HTML is rendered in a sandboxed `<iframe>` with no script execution.
- **Auto-expiry:** All emails are deleted after 24 hours.
