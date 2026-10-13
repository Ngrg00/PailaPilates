'use strict';

// Everything you are likely to change lives here.
module.exports = {
  studioName: 'Paila Pilates',
  // Official studio email. Shown in emails; customers can reply to it, and booking notices are sent to it.
  contactEmail: 'pailapilates10@gmail.com',
  address: ['JK Central, 3rd floor', 'Jawalakhel Park, Lalitpur 44600', 'Bagmati Province, Nepal'],
  addressNe: ['जेके सेन्ट्रल, तेस्रो तला', 'जावलाखेल पार्क, ललितपुर 44600', 'बागमती प्रदेश, नेपाल'],

  // Website address, used for "book another class" links in emails (optional), e.g. 'https://paila.example.com'
  siteUrl: '',

  // Optional first-class offer: a new account gets this share off one spot (0.5 = 50% off), once.
  // It is off (0) because your price list has the First Step package for new clients instead.
  firstClassDiscount: 0,

  // Online booking is pay-per-class at the Drop-in price (price is per spot).
  currency: 'NPR',
  price: 1499, // the Drop-in price: one spot in one class

  // Studio local time. Nepal is UTC+5:45 with no daylight saving (345 minutes).
  timezone: 'Asia/Kathmandu',
  utcOffsetMinutes: 345,

  // An unpaid booking holds its spots for this long, then they are released.
  holdMinutes: 30,
  // Most spots one customer can book in a single class at once.
  maxSpots: 4,
  // How many days ahead people can book.
  windowDays: 14,

  // Group classes. Names are shown in English and Nepali by the website and emails.
  classes: {
    reformer: { name: 'Reformer', cap: 12 }
  },

  // Weekly timetable (placeholder times: replace with your real timetable).
  // Keys are weekdays (0 = Sunday). Times are studio local time (24 hour).
  week: {
    0: [['7:00', 'reformer'], ['8:00', 'reformer'], ['9:00', 'reformer'], ['10:00', 'reformer'], ['15:00', 'reformer'], ['16:00', 'reformer'], ['17:00', 'reformer'], ['18:00', 'reformer']],
    1: [['7:00', 'reformer'], ['8:00', 'reformer'], ['9:00', 'reformer'], ['10:00', 'reformer'], ['15:00', 'reformer'], ['16:00', 'reformer'], ['17:00', 'reformer'], ['18:00', 'reformer']],
    2: [['7:00', 'reformer'], ['8:00', 'reformer'], ['9:00', 'reformer'], ['10:00', 'reformer'], ['15:00', 'reformer'], ['16:00', 'reformer'], ['17:00', 'reformer'], ['18:00', 'reformer']],
    3: [['7:00', 'reformer'], ['8:00', 'reformer'], ['9:00', 'reformer'], ['10:00', 'reformer'], ['15:00', 'reformer'], ['16:00', 'reformer'], ['17:00', 'reformer'], ['18:00', 'reformer']],
    4: [['7:00', 'reformer'], ['8:00', 'reformer'], ['9:00', 'reformer'], ['10:00', 'reformer'], ['15:00', 'reformer'], ['16:00', 'reformer'], ['17:00', 'reformer'], ['18:00', 'reformer']],
    5: [['7:00', 'reformer'], ['8:00', 'reformer'], ['9:00', 'reformer'], ['10:00', 'reformer']],
    6: []
  },

  // Payment options shown after a booking is created. Paste the hosted checkout or payment-link
  // URL from your provider (must start with https://). Leave url empty to hide a method.
  // Tokens {ref} (booking reference), {amount} and {email} are filled in for you.
  // For a real integration, create the checkout per booking in payments.js instead.
  paymentMethods: [
    { id: 'card',   label: 'Card',   url: '' },
    { id: 'esewa',  label: 'eSewa',  url: '' },
    { id: 'khalti', label: 'Khalti', url: '' }
  ]
};
