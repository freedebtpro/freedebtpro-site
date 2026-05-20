// netlify/functions/create-checkout.js
// DEBUG VERSION — verbose logging to identify exact failure point

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // STEP 1: Check env vars
  const STRIPE_KEY   = process.env.STRIPE_SECRET_KEY;
  const PRICE_PRO    = process.env.STRIPE_PRICE_PRO;
  const PRICE_FAMILY = process.env.STRIPE_PRICE_FAMILY;

  console.log('[DEBUG-1] STRIPE_SECRET_KEY set:', !!STRIPE_KEY);
  console.log('[DEBUG-1] KEY prefix:', STRIPE_KEY ? STRIPE_KEY.slice(0,7) : 'MISSING');
  console.log('[DEBUG-1] STRIPE_PRICE_PRO:', PRICE_PRO || 'MISSING');
  console.log('[DEBUG-1] STRIPE_PRICE_FAMILY:', PRICE_FAMILY || 'MISSING');

  if (!STRIPE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({
      error: 'STRIPE_SECRET_KEY not configured in Netlify environment variables.',
      debug: 'STRIPE_SECRET_KEY=missing'
    })};
  }
  if (!PRICE_PRO || !PRICE_FAMILY) {
    return { statusCode: 500, headers, body: JSON.stringify({
      error: 'Price ID env vars missing.',
      debug: { STRIPE_PRICE_PRO: !!PRICE_PRO, STRIPE_PRICE_FAMILY: !!PRICE_FAMILY }
    })};
  }

  // STEP 2: Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
    console.log('[DEBUG-2] Body:', JSON.stringify(body));
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON', debug: e.message }) };
  }

  const planType  = body.plan;
  const email     = body.email     || '';
  const firstName = body.firstName || '';
  const lastName  = body.lastName  || '';
  const phone     = body.phone     || '';

  console.log('[DEBUG-2] planType:', planType, '| email:', email);

  if (planType !== 'pro' && planType !== 'familiar') {
    return { statusCode: 400, headers, body: JSON.stringify({
      error: 'Invalid plan: ' + planType,
      debug: 'Must be pro or familiar'
    })};
  }

  // STEP 3: Init Stripe
  let stripe;
  try {
    stripe = require('stripe')(STRIPE_KEY);
    const mode = STRIPE_KEY.startsWith('sk_live') ? 'LIVE' : STRIPE_KEY.startsWith('sk_test') ? 'TEST' : 'UNKNOWN';
    console.log('[DEBUG-3] Stripe initialized. Mode:', mode);
  } catch(e) {
    console.error('[DEBUG-3] Stripe init error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe init failed: ' + e.message, debug: e.message }) };
  }

  // STEP 4: Select price and URLs
  const priceId    = planType === 'familiar' ? PRICE_FAMILY : PRICE_PRO;
  const planLabel  = planType === 'familiar' ? 'Familiar $29.99' : 'Pro $19.99';
  const successUrl = planType === 'familiar'
    ? 'https://freedebtpro.app/family-success.html?session_id={CHECKOUT_SESSION_ID}&provider=stripe'
    : 'https://freedebtpro.app/pro-success.html?session_id={CHECKOUT_SESSION_ID}&provider=stripe';
  const tag = planType === 'familiar' ? 'FreeDebtPro-FamiliarCheckout-Stripe' : 'FreeDebtPro-ProCheckout-Stripe';

  console.log('[DEBUG-4] priceId:', priceId);
  console.log('[DEBUG-4] successUrl:', successUrl);

  // STEP 5: Create Stripe Checkout Session
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url:  'https://freedebtpro.app/index.html?checkout=cancelled',
      ...(email && { customer_email: email }),
      metadata:          { planType, firstName, lastName, phone, email, tag },
      subscription_data: { metadata: { planType, firstName, tag } },
    });
    console.log('[DEBUG-5] Session created:', session.id);
  } catch(e) {
    console.error('[DEBUG-5] Session creation FAILED:', e.type, '|', e.code, '|', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({
      error: e.message,
      debug: { stripeType: e.type, stripeCode: e.code, priceId, planType }
    })};
  }

  // STEP 6: GHL (non-blocking)
  try {
    fetch('https://services.leadconnectorhq.com/hooks/bD3pD3nuKgprlXEMfdl0/webhook-trigger/7f819a67-483c-4355-8067-a37501b89973', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone,
        plan: planLabel, status: 'Started Checkout', source: 'FreeDebt Pro Stripe', tag,
        submittedAt: new Date().toISOString() }),
    }).catch(function(e){ console.error('[GHL]', e.message); });
  } catch(e) { console.error('[GHL non-critical]', e.message); }

  console.log('[DEBUG-6] Success. Returning URL to frontend.');
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ url: session.url, sessionId: session.id }),
  };
};
