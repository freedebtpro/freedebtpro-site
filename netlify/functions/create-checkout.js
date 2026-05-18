// netlify/functions/create-checkout.js
// Price IDs read from env vars STRIPE_PRICE_PRO and STRIPE_PRICE_FAMILY — never hardcoded

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const GHL_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/bD3pD3nuKgprlXEMfdl0/webhook-trigger/7f819a67-483c-4355-8067-a37501b89973';

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const body      = JSON.parse(event.body || '{}');
    const planType  = body.plan;
    const email     = body.email     || '';
    const firstName = body.firstName || '';
    const lastName  = body.lastName  || '';
    const phone     = body.phone     || '';

    // Read Price IDs from Netlify environment variables — never hardcoded
    const PRICE_PRO    = process.env.STRIPE_PRICE_PRO;
    const PRICE_FAMILY = process.env.STRIPE_PRICE_FAMILY;

    console.log('[Stripe] Plan:', planType, '| PRO env set:', !!PRICE_PRO, '| FAMILY env set:', !!PRICE_FAMILY);

    if (planType !== 'pro' && planType !== 'familiar') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan. Must be "pro" or "familiar".' }) };
    }
    if (!PRICE_PRO || !PRICE_FAMILY) {
      console.error('[Stripe] MISSING ENV VARS: STRIPE_PRICE_PRO or STRIPE_PRICE_FAMILY not configured in Netlify');
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Payment configuration error. Contact support@freedebtpro.com' }) };
    }

    // Select correct Price ID dynamically from env
    const priceId    = planType === 'familiar' ? PRICE_FAMILY : PRICE_PRO;
    const planLabel  = planType === 'familiar' ? 'Familiar $29.99' : 'Pro $19.99';
    const successUrl = planType === 'familiar'
      ? 'https://freedebtpro.app/family-success.html?session_id={CHECKOUT_SESSION_ID}&provider=stripe'
      : 'https://freedebtpro.app/pro-success.html?session_id={CHECKOUT_SESSION_ID}&provider=stripe';
    const tag = planType === 'familiar' ? 'FreeDebtPro-FamiliarCheckout-Stripe' : 'FreeDebtPro-ProCheckout-Stripe';

    console.log('[Stripe] Using priceId:', priceId.slice(0,24) + '...');

    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url:  'https://freedebtpro.app/index.html?checkout=cancelled',
      ...(email && { customer_email: email }),
      metadata:          { planType, firstName, lastName, phone, email, tag, source: 'FreeDebt Pro Stripe' },
      subscription_data: { metadata: { planType, firstName, tag } },
    });

    console.log('[Stripe] Session created:', session.id, '| Plan:', planLabel);

    // Send lead to GHL (non-blocking)
    fetch(GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, phone,
        plan: planLabel, status: 'Started Checkout', source: 'FreeDebt Pro Stripe', tag,
        submittedAt: new Date().toISOString() }),
    }).catch(function(e){ console.error('[GHL]', e.message); });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url, sessionId: session.id }) };

  } catch (err) {
    console.error('[Stripe] Session error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
