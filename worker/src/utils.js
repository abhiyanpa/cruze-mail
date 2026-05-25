/**
 * Utility functions for CRUZE MAIL worker.
 */

const ADJECTIVES = [
  'swift','cool','brave','wild','dark','calm','bold','keen','fast','wise',
  'red','blue','jade','neon','zinc','iron','gold','star','deep','grim',
  'pale','warm','cold','slim','tall','pure','raw','dry','hot','shy',
];

const NOUNS = [
  'tiger','panda','eagle','wolf','fox','hawk','lynx','bear','lion','crow',
  'deer','seal','dove','fish','moth','frog','swan','bat','owl','ram',
  'orca','wasp','crab','newt','yak','boar','mole','hare','koi','wren',
];

export function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}-${noun}-${num}`;
}

export function corsHeaders(origin, allowedOrigin) {
  return {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Origin': origin || '*',
  };
}

export function jsonResponse(data, status = 200, corsH = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsH },
  });
}
