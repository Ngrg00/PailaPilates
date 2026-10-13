'use strict';

// Wording for the emails the server sends. Each customer gets their email in the language they were
// using on the website when they booked (English "en" or Nepali "ne"). Edit freely.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));

const TEXT = {
  en: {
    cls: { reformer: 'Reformer' },
    studio: 'Paila Pilates',
    spot: (n) => `${n} ${n === 1 ? 'spot' : 'spots'}`,
    money: (n) => `NPR ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    previewPaid: 'Preview booking, no payment was taken',
    offer: (pct, saved) => `${pct}% off your first class (you saved ${saved})`,
    hi: (name) => `Hi ${name},`,
    confSubject: '{what}: {cls}, {short} at {time}',
    confSubjectWord: "You're booked",
    confBody: 'Your booking at {studio} is confirmed.',
    confHeading: "You're booked, {name}.",
    labels: { cls: 'Class', when: 'When', spots: 'Spots', paid: 'Paid', offer: 'Offer', ref: 'Reference', where: 'Where' },
    arrive: 'Please arrive ten minutes early and bring grip socks if you have them.',
    change: 'Need to change or cancel? Reply to this email or write to {email} and quote your reference.',
    bye: 'See you soon,',
    cancelSubject: 'Class cancelled: {cls}, {short} at {time}',
    cancelBody: 'We are sorry, but your {cls} class on {day} at {time} has been cancelled.',
    cancelHeading: 'Your class has been cancelled',
    reason: 'Reason: {reason}',
    refDetail: 'Reference: {ref} ({spots})',
    paidNote: 'You had already paid, so we will arrange a refund or move you to another class. Please reply to this email and tell us which you would prefer.',
    unpaidNote: 'You had not completed payment, so nothing has been charged. If you have paid, please reply with your receipt and we will sort it out.',
    again: 'You can book another class at {url}.',
    questions: 'Questions? Write to {email}.',
    sorry: 'Sorry for the inconvenience,'
  },
  ne: {
    cls: { reformer: 'रिफर्मर' },
    studio: 'पैला पाइलेट्स',
    spot: (n) => `${n} सिट`,
    money: (n) => `रु ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    previewPaid: 'पूर्वावलोकन बुकिङ, कुनै भुक्तानी लिइएन',
    offer: (pct, saved) => `पहिलो कक्षामा ${pct}% छुट (तपाईंले ${saved} बचत गर्नुभयो)`,
    hi: (name) => `नमस्ते ${name},`,
    confSubject: '{what}: {cls}, {short}, {time}',
    confSubjectWord: 'बुकिङ पक्का भयो',
    confBody: '{studio} मा तपाईंको बुकिङ पक्का भयो।',
    confHeading: '{name}, तपाईंको बुकिङ पक्का भयो।',
    labels: { cls: 'कक्षा', when: 'समय', spots: 'सिट', paid: 'भुक्तानी', offer: 'छुट', ref: 'रेफरेन्स', where: 'स्थान' },
    arrive: 'कृपया 10 मिनेट अगाडि आउनुहोस् र भए ग्रिप मोजा ल्याउनुहोस्।',
    change: 'परिवर्तन वा रद्द गर्न चाहनुहुन्छ भने यो इमेलमा जवाफ दिनुहोस् वा {email} मा लेख्नुहोस् र रेफरेन्स उल्लेख गर्नुहोस्।',
    bye: 'फेरि भेटौँला,',
    cancelSubject: 'कक्षा रद्द भयो: {cls}, {short}, {time}',
    cancelBody: 'माफ गर्नुहोस्, {day}, {time} को तपाईंको {cls} कक्षा रद्द गरिएको छ।',
    cancelHeading: 'तपाईंको कक्षा रद्द गरिएको छ',
    reason: 'कारण: {reason}',
    refDetail: 'रेफरेन्स: {ref} ({spots})',
    paidNote: 'तपाईंले भुक्तानी गरिसक्नुभएको थियो, त्यसैले हामी रकम फिर्ता गर्ने वा अर्को कक्षामा सार्ने व्यवस्था मिलाउनेछौँ। कृपया यो इमेलमा जवाफ दिएर कुन रोज्नुहुन्छ भन्नुहोस्।',
    unpaidNote: 'तपाईंले भुक्तानी पूरा गर्नुभएको थिएन, त्यसैले कुनै रकम लिइएको छैन। यदि तपाईंले भुक्तानी गर्नुभएको छ भने कृपया रसिदसहित जवाफ दिनुहोस्, हामी मिलाउनेछौँ।',
    again: 'तपाईं {url} मा अर्को कक्षा बुक गर्न सक्नुहुन्छ।',
    questions: 'प्रश्न छ? {email} मा लेख्नुहोस्।',
    sorry: 'असुविधाका लागि क्षमा चाहन्छौँ,'
  }
};

// Date and time words, written out so they are right in every email client
const NE_WD = ['आइतबार', 'सोमबार', 'मङ्गलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];
const NE_WD_S = ['आइत', 'सोम', 'मङ्गल', 'बुध', 'बिही', 'शुक्र', 'शनि'];
const NE_MO = ['जनवरी', 'फेब्रुअरी', 'मार्च', 'अप्रिल', 'मे', 'जुन', 'जुलाई', 'अगस्ट', 'सेप्टेम्बर', 'अक्टोबर', 'नोभेम्बर', 'डिसेम्बर'];
const NE_MO_S = ['जन', 'फेब्रु', 'मार्च', 'अप्रिल', 'मे', 'जुन', 'जुलाई', 'अग', 'सेप्टे', 'अक्टो', 'नोभे', 'डिसे'];
const WD_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function clock(ms, timeZone) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return { wd: WD_INDEX[p.weekday], day: Number(p.day), mo: Number(p.month) - 1, year: Number(p.year), h: Number(p.hour) % 24, m: Number(p.minute) };
}

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_EN_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describe(booking, cfg) {
  const lang = booking.lang === 'ne' ? 'ne' : 'en';
  const L = TEXT[lang];
  const c = clock(booking.startMs, cfg.timezone);
  const h12 = c.h % 12 === 0 ? 12 : c.h % 12;
  const mm = String(c.m).padStart(2, '0');
  let day, shortDay, time;
  if (lang === 'ne') {
    day = `${NE_WD[c.wd]}, ${c.day} ${NE_MO[c.mo]} ${c.year}`;
    shortDay = `${NE_WD_S[c.wd]}, ${c.day} ${NE_MO_S[c.mo]}`;
    const word = c.h >= 4 && c.h < 12 ? 'बिहान' : c.h >= 12 && c.h < 16 ? 'दिउँसो' : c.h >= 16 && c.h < 19 ? 'साँझ' : 'राति';
    time = `${word} ${h12}:${mm}`;
  } else {
    day = `${WD_EN[c.wd]}, ${c.day} ${MONTH_EN[c.mo]} ${c.year}`;
    shortDay = `${WD_EN[c.wd].slice(0, 3)} ${c.day} ${MONTH_EN_S[c.mo]}`;
    time = `${h12}:${mm} ${c.h < 12 ? 'AM' : 'PM'}`;
  }
  const address = [].concat((lang === 'ne' ? cfg.addressNe : cfg.address) || cfg.address || []).join(', ');
  return {
    L, day, shortDay, time, address,
    cls: L.cls[booking.cid] || cfg.classes[booking.cid].name,
    spots: L.spot(booking.qty),
    paid: booking.method === 'demo' ? L.previewPaid : L.money(booking.amount),
    offer: booking.discount > 0 ? L.offer(Math.round(cfg.firstClassDiscount * 100), L.money(booking.discount)) : ''
  };
}

const shell = (cfg, inner) => `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#F4EEE3;font-family:Helvetica,Arial,'Noto Sans Devanagari',sans-serif;color:#33291F">
<div style="max-width:520px;margin:0 auto;background:#FAF6EE;padding:32px;border:1px solid #DDD3C2">
<p style="margin:0 0 4px;font-family:Georgia,serif;font-size:28px">${esc(cfg.studioName.split(' ')[0].toLowerCase())}</p>
${inner}
</div></body></html>`;

// Sent to the customer once their booking is paid and confirmed.
function customerConfirmation(booking, user, cfg) {
  const x = describe(booking, cfg);
  const L = x.L;
  const first = String(user.name).trim().split(/\s+/)[0];
  const subject = fill(L.confSubject, { what: L.confSubjectWord, cls: x.cls, short: x.shortDay, time: x.time });
  const rows = [
    [L.labels.cls, x.cls],
    [L.labels.when, `${x.day}, ${x.time}`],
    [L.labels.spots, x.spots],
    [L.labels.paid, x.paid],
    x.offer ? [L.labels.offer, x.offer] : null,
    [L.labels.ref, booking.ref],
    x.address ? [L.labels.where, x.address] : null
  ].filter(Boolean);
  const change = fill(L.change, { email: cfg.contactEmail });

  const text = [
    L.hi(first), '',
    fill(L.confBody, { studio: L.studio }), '',
    ...rows.map((r) => `${r[0]}: ${r[1]}`), '',
    L.arrive, change, '',
    L.bye, L.studio
  ].join('\n');

  const html = shell(cfg, `<h1 style="margin:24px 0 8px;font-family:Georgia,'Noto Serif Devanagari',serif;font-weight:400;font-size:26px">${esc(fill(L.confHeading, { name: first }))}</h1>
<p style="margin:0 0 20px;color:#6E6155">${esc(fill(L.confBody, { studio: L.studio }))}</p>
<table style="border-collapse:collapse;width:100%;border-top:1px solid #DDD3C2;border-bottom:1px solid #DDD3C2;margin-bottom:20px">
${rows.map((r) => `<tr><td style="padding:8px 16px 8px 0;color:#6E6155;vertical-align:top">${esc(r[0])}</td><td style="padding:8px 0;color:#33291F">${esc(r[1])}</td></tr>`).join('')}
</table>
<p style="margin:0 0 12px">${esc(L.arrive)}</p>
<p style="margin:0 0 24px;color:#6E6155">${esc(change)}</p>
<p style="margin:0">${esc(L.bye)}<br>${esc(L.studio)}</p>`);

  return { subject, text, html, replyTo: cfg.contactEmail };
}

// Sent to the studio (always in English) so you know who has booked.
function studioNotice(booking, user, cfg) {
  const x = describe(Object.assign({}, booking, { lang: 'en' }), cfg);
  const subject = `New booking: ${String(user.name).replace(/[\r\n]+/g, ' ')}, ${x.cls}, ${x.shortDay} ${x.time}`;
  const text = [
    'A new booking has been confirmed.', '',
    `Customer: ${user.name} (${user.email})`,
    `Language: ${booking.lang === 'ne' ? 'Nepali' : 'English'}`,
    `Class: ${x.cls}`,
    `When: ${x.day}, ${x.time}`,
    `Spots: ${x.spots}`,
    `Paid: ${x.paid}`,
    `Reference: ${booking.ref}`,
    booking.note ? `Note: ${booking.note}` : null
  ].filter((l) => l !== null).join('\n');
  return { subject, text, replyTo: user.email };
}

// Sent to a customer when the studio cancels their class or booking.
function cancellation(booking, user, cfg, reason) {
  const x = describe(booking, cfg);
  const L = x.L;
  const first = String(user.name).trim().split(/\s+/)[0];
  const subject = fill(L.cancelSubject, { cls: x.cls, short: x.shortDay, time: x.time });
  const body = fill(L.cancelBody, { cls: x.cls, day: x.day, time: x.time });
  const why = reason ? fill(L.reason, { reason }) : '';
  const money = booking.wasPaid ? L.paidNote : L.unpaidNote;
  const again = cfg.siteUrl ? fill(L.again, { url: cfg.siteUrl }) : '';
  const ref = fill(L.refDetail, { ref: booking.ref, spots: x.spots });
  const questions = fill(L.questions, { email: cfg.contactEmail });

  const text = [L.hi(first), '', body + (why ? ' ' + why : ''), '', ref, '', money, again, '', questions, '', L.sorry, L.studio]
    .filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  const html = shell(cfg, `<h1 style="margin:24px 0 8px;font-family:Georgia,'Noto Serif Devanagari',serif;font-weight:400;font-size:26px">${esc(L.cancelHeading)}</h1>
<p style="margin:0 0 20px;color:#6E6155">${esc(L.hi(first))} ${esc(body)}${why ? ' ' + esc(why) : ''}</p>
<p style="margin:0 0 12px;color:#6E6155">${esc(ref)}</p>
<p style="margin:0 0 12px">${esc(money)}</p>
${again ? `<p style="margin:0 0 12px">${esc(again)}</p>` : ''}
<p style="margin:0 0 24px;color:#6E6155">${esc(questions)}</p>
<p style="margin:0">${esc(L.sorry)}<br>${esc(L.studio)}</p>`);

  return { subject, text, html, replyTo: cfg.contactEmail };
}

module.exports = { customerConfirmation, studioNotice, cancellation };
