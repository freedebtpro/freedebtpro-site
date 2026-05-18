// netlify/functions/create-checkout.js
// Creates a Stripe Checkout Session for Pro or Familiar plan

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  pro: {
    priceId:     'price_1TPIYQPRnqYXWOfes4UnTEw4',
    name:        'FreeDebt Pro',
    successUrl:  'https://freedebtpro.app/pro-success.html?session_id={CHECKOUT_SESSION_ID}&provider=stripe',
    cancelUrl:   'https://freedebtpro.app/index.html?checkout=cancelled',
    tag:         'FreeDebtPro-ProCheckout-Stripe',
    amount:      19.99,
  },
  familiar: {
    priceId:     'price_1TU5DfPRnqYXWOfeDf41ByCM',
    name:        'FreeDebt Familiar',
    successUrl:  'https://freedebtpro.app/family-success.html?session_id={CHECKOUT_SESSION_ID}&provider=stripe',
    cancelUrl:   'https://freedebtpro.app/index.html?checkout=cancelled',
    tag:         'FreeDebtPro-FamiliarCheckout-Stripe',
    amount:      29.99,
  },
};

exports.handler = async function (event) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body      = JSON.parse(event.body || '{}');
    const planType  = body.plan; // 'pro' or 'familiar'
    const email     = body.email     || '';
    const firstName = body.firstName || '';
    const lastName  = body.lastName  || '';
    const phone     = body.phone     || '';

    const plan = PLANS[planType];
    if (!plan) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };
    }

    // Build customer data
    const customerData = {};
    if (email) customerData.email = email;

    // Create Stripe Checkout Session (subscription mode)
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price:    plan.priceId,
        quantity: 1,
      }],
      success_url: plan.successUrl,
      cancel_url:  plan.cancelUrl,
      // Pre-fill customer email if available
      ...(email && { customer_email: email }),
      // Store lead info in metadata for webhook processing
      metadata: {
        planType,
        firstName,
        lastName,
        phone,
        email,
        tag:    plan.tag,
        source: 'FreeDebt Pro Stripe Checkout',
      },
      subscription_data: {
        metadata: {
          planType,
          firstName,
          tag: plan.tag,
        },
      },
    });

    console.log('[Stripe] Session created:', session.id, 'plan:', planType);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, sessionId: session.id }),
    };

  } catch (err) {
    console.error('[Stripe] Error creating session:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
