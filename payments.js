'use strict';

const enc = encodeURIComponent;

// Called after a customer creates a booking. Return the checkout options to show them.
//
// Default behaviour: use the payment links from config.js and fill in {ref}, {amount} and {email}.
//
// For a proper integration, create a checkout session with your provider here (using their server
// API and your secret key, kept in an environment variable) and return its URL instead, for example:
//
//   const url = await createProviderCheckout({ amount: booking.amount, reference: booking.ref, ... });
//   return [{ id: 'card', label: 'Card', url }];
//
// Then have the provider call POST /api/webhooks/payment when the payment succeeds (see README).
async function checkoutOptions(booking, user, cfg) {
  return cfg.paymentMethods
    .filter((m) => /^https:\/\//.test(m.url || ''))
    .map((m) => ({
      id: m.id,
      label: m.label,
      url: m.url
        .replace(/\{ref\}/g, enc(booking.ref))
        .replace(/\{amount\}/g, enc(booking.amount))
        .replace(/\{email\}/g, enc(user.email))
    }));
}

module.exports = { checkoutOptions };
