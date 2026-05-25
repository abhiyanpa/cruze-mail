/**
 * Email handler — parses incoming MIME emails and stores them in Firestore.
 */
import PostalMime from 'postal-mime';
import { writeDocument, readDocument } from './firebase.js';

export async function handleEmail(message, env) {
  const recipient = message.to;
  const localPart = recipient.split('@')[0];

  // Look up the inbox mapping
  const mapping = await readDocument(env, 'emailMap', localPart);
  if (!mapping) {
    // No inbox exists for this address — silently drop
    console.log(`No inbox found for: ${recipient}`);
    return;
  }

  // Parse the raw MIME email
  const rawEmail = await new Response(message.raw).arrayBuffer();
  const parser = new PostalMime();
  const parsed = await parser.parse(rawEmail);

  // Generate a unique ID for this email
  const emailId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const TTL_HOURS = 24;

  // Build the email document
  const emailDoc = {
    id: emailId,
    inboxId: mapping.inboxId,
    recipient: recipient,
    sender: message.from,
    subject: parsed.subject || '(No Subject)',
    textBody: (parsed.text || '').substring(0, 50000),
    htmlBody: (parsed.html || '').substring(0, 100000),
    preview: (parsed.text || parsed.subject || '').substring(0, 200),
    receivedAt: now,
    expiresAt: now + TTL_HOURS * 3600,
  };

  // Write to Firestore
  await writeDocument(env, 'emails', emailId, emailDoc);
  console.log(`Stored email ${emailId} for ${recipient} from ${message.from}`);
}
