const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');

async function run() {
  try {
    const data = JSON.parse(fs.readFileSync('../cruzemail-firebase-adminsdk-fbsvc-a61a8a1456.json', 'utf8'));

    // We skip updating ENCRYPTION_KEY so we don't invalidate existing inboxes
    // const encKey = crypto.randomBytes(32).toString('hex');
    // console.log('Putting ENCRYPTION_KEY...');
    // execSync('npx wrangler secret put ENCRYPTION_KEY', { input: encKey, stdio: ['pipe', 'pipe', 'pipe'] });

    console.log('Putting FIREBASE_CLIENT_EMAIL...');
    execSync('npx wrangler secret put FIREBASE_CLIENT_EMAIL', { input: data.client_email, stdio: ['pipe', 'pipe', 'pipe'] });

    console.log('Putting FIREBASE_PRIVATE_KEY...');
    execSync('npx wrangler secret put FIREBASE_PRIVATE_KEY', { input: data.private_key, stdio: ['pipe', 'pipe', 'pipe'] });

    console.log('Deploying to Cloudflare...');
    const deployOut = execSync('npx wrangler deploy', { encoding: 'utf8' });
    console.log(deployOut);

  } catch (err) {
    console.error('Error during deploy:', err.message);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
  }
}

run();
