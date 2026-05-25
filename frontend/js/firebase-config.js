/**
 * Firebase configuration for CRUZE MAIL frontend.
 * Uses Firebase JS SDK v9+ (modular) from CDN.
 */

const firebaseConfig = {
  apiKey: "AIzaSyCZX2UwptcTmEf1t7xE1a1kKzrdQzuW3PI",
  authDomain: "cruzemail.firebaseapp.com",
  projectId: "cruzemail",
  storageBucket: "cruzemail.firebasestorage.app",
  messagingSenderId: "393061865448",
  appId: "1:393061865448:web:e3bf5a61cc6159ee0e365d",
  measurementId: "G-8VNVFQF5LH"
};

// These will be set after Firebase SDK loads
let db = null;

/**
 * Initialize Firebase (called after SDK scripts load).
 */
function initFirebase() {
  const app = firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  return db;
}

/**
 * Subscribe to real-time email updates for an inboxId.
 * Calls onEmails(emails[]) whenever data changes.
 */
function subscribeToInbox(inboxId, onEmails, onError) {
  if (!db) throw new Error('Firebase not initialized');

  return db
    .collection('emails')
    .where('inboxId', '==', inboxId)
    .orderBy('receivedAt', 'desc')
    .limit(50)
    .onSnapshot(
      (snapshot) => {
        const emails = [];
        snapshot.forEach((doc) => {
          emails.push(doc.data());
        });
        onEmails(emails);
      },
      (err) => {
        console.error('Firestore listener error:', err);
        if (onError) onError(err);
      }
    );
}
