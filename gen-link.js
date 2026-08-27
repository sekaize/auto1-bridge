/**
 * Génère un lien marchand signé pour un lead, sans passer par le serveur.
 * Usage :
 *   LINK_SECRET="ton-secret" BASE_URL="https://ton-app.onrender.com" node gen-link.js KN25788
 */
const crypto = require('crypto');

const lead = String(process.argv[2] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const secret = process.env.LINK_SECRET || '';
const base = (process.env.BASE_URL || 'https://VOTRE-APP').replace(/\/+$/, '');

if (!lead) { console.error('Usage: LINK_SECRET=... BASE_URL=... node gen-link.js <LEAD>'); process.exit(1); }
if (!secret) { console.error('LINK_SECRET manquant.'); process.exit(1); }

const t = crypto.createHmac('sha256', secret).update(lead).digest('hex').slice(0, 20);
console.log(base + '/u?lead=' + lead + '&t=' + t);
