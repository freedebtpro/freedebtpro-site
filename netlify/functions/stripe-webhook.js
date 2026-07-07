// netlify/functions/stripe-webhook.js
// Handles Stripe webhook events: checkout.session.completed, invoice.paid, etc.
// Verifies Stripe signature, sends contact to GHL, handles subscription lifecycle

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const GHL_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/bD3pD3nuKgprlXEMfdl0/webhook-trigger/7f819a67-483c-4355-8067-a37501b89973';

async function sendToGHL(payload) {
  try {
    const res = await fetch(GHL_WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    console.log('[GHL] Response status:', res.status);
    return res.ok;
  } catch (err) {
    console.error('[GHL] Error sending to webhook:', err.message);
    return false;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sig            = event.headers['stripe-signature'];
  const webhookSecret  = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  // ── Verify Stripe signature ──
  // Netlify may deliver the body as base64 — Stripe needs the exact raw bytes
  // to compute the signature, so we must decode before verifying.
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body;

    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  console.log('[Stripe Webhook] Event received:', stripeEvent.type);

  // ── Handle events ──
  switch (stripeEvent.type) {

    // ── Checkout completed → payment or subscription created ──
    case 'checkout.session.completed': {
      const session  = stripeEvent.data.object;
      const meta     = session.metadata || {};
      const customer = session.customer;
      const subId    = session.subscription;
      const email    = session.customer_details?.email || meta.email || '';
      const name     = session.customer_details?.name  || '';
      const planType = meta.planType || 'pro';

      const planLabel = planType === 'familiar' ? 'Familiar $29.99' : 'Pro $19.99';
      const tag       = meta.tag || (planType === 'familiar' ? 'FreeDebtPro-FamiliarCheckout-Stripe' : 'FreeDebtPro-ProCheckout-Stripe');

      console.log('[Stripe Webhook] Checkout completed. Email:', email, 'Plan:', planLabel);

      // Send to GHL
      await sendToGHL({
        firstName:      meta.firstName || name.split(' ')[0] || '',
        lastName:       meta.lastName  || name.split(' ').slice(1).join(' ') || '',
        email,
        phone:          meta.phone || '',
        plan:           planLabel,
        status:         'Checkout Completed',
        source:         'FreeDebt Pro Stripe',
        tag,
        stripeCustomer: customer,
        stripeSubId:    subId,
        submittedAt:    new Date().toISOString(),
      });
      break;
    }

    // ── Invoice paid → recurring subscription renewed (not used in one-time payment mode, kept for safety) ──
    case 'invoice.paid': {
      const invoice  = stripeEvent.data.object;
      const email    = invoice.customer_email || '';
      const subId    = invoice.subscription;
      const amount   = (invoice.amount_paid / 100).toFixed(2);

      console.log('[Stripe Webhook] Invoice paid:', email, '$' + amount);

      await sendToGHL({
        email,
        status:      'Invoice Paid',
        source:      'FreeDebt Pro Stripe Renewal',
        tag:         'FreeDebtPro-RenewalPaid',
        amount,
        stripeSubId: subId,
        submittedAt: new Date().toISOString(),
      });
      break;
    }

    // ── Invoice payment failed ──
    case 'invoice.payment_failed': {
      const invoice = stripeEvent.data.object;
      const email   = invoice.customer_email || '';

      console.log('[Stripe Webhook] Payment failed:', email);

      await sendToGHL({
        email,
        status:      'Payment Failed',
        source:      'FreeDebt Pro Stripe',
        tag:         'FreeDebtPro-PaymentFailed',
        submittedAt: new Date().toISOString(),
      });
      break;
    }

    // ── Subscription cancelled ──
    case 'customer.subscription.deleted': {
      const sub   = stripeEvent.data.object;
      const email = sub.metadata?.email || '';

      console.log('[Stripe Webhook] Subscription cancelled:', sub.id);

      await sendToGHL({
        email,
        status:      'Subscription Cancelled',
        source:      'FreeDebt Pro Stripe',
        tag:         'FreeDebtPro-Cancelled',
        stripeSubId: sub.id,
        submittedAt: new Date().toISOString(),
      });
      break;
    }

    default:
      console.log('[Stripe Webhook] Unhandled event type:', stripeEvent.type);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
