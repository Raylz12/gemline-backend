// Transactional email for GEMLINE.
//
// TODO: no email provider is configured yet. Add RESEND_API_KEY (and optionally
// EMAIL_FROM) to Vercel env and this module starts sending automatically — the
// transport below speaks the Resend REST API directly (no SDK dependency).
// Until then every send is a logged no-op, so call sites can stay wired.
//
// Rules for callers (Vercel serverless): ALWAYS await sendEmail before
// res.json() — fire-and-forget work is killed when the response is sent.

const FROM = () => process.env.EMAIL_FROM || 'GEMLINE <notifications@gemlinecards.com>';

export async function sendEmail({ to, subject, html, text = '' }) {
  if (!to || !subject) return { ok: false, skipped: 'missing_fields' };
  // Never email placeholder/test addresses.
  if (/@example\.(com|org|net)$|@gemline\.app$/i.test(to)) return { ok: false, skipped: 'placeholder_address' };

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:noop] to=${to} subject="${subject}"`);
    return { ok: false, skipped: 'no_provider' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM(), to: [to], subject, html, text: text || undefined }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email] send failed:', res.status, body.slice(0, 200));
      return { ok: false, error: `http_${res.status}` };
    }
    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (e) {
    console.error('[email] send error:', e.message);
    return { ok: false, error: e.message };
  }
}

// Look up a user's email and send — safe to call with any userId, never throws.
export async function emailUser(pool, userId, subject, html, text = '') {
  try {
    if (!pool || !userId) return { ok: false, skipped: 'no_user' };
    const { rows: [u] } = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (!u?.email) return { ok: false, skipped: 'no_email' };
    return await sendEmail({ to: u.email, subject, html, text });
  } catch (e) {
    console.error('[email] emailUser error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── Templates (dark-brand minimal HTML) ───────────────────────────────────────
const shell = (title, body, cta = null) => `
<div style="background:#0b0d12;color:#e8e6df;font-family:Arial,Helvetica,sans-serif;padding:32px 24px;border-radius:12px;max-width:560px;margin:0 auto">
  <div style="font-size:12px;letter-spacing:.2em;color:#c9a44c;font-weight:bold;margin-bottom:16px">GEMLINE</div>
  <h2 style="margin:0 0 12px;font-size:20px;color:#fff">${title}</h2>
  <div style="font-size:14px;line-height:1.6;color:#b9b6ac">${body}</div>
  ${cta ? `<a href="${cta.url}" style="display:inline-block;margin-top:20px;background:#c9a44c;color:#141006;font-weight:bold;padding:12px 22px;border-radius:8px;text-decoration:none;font-size:14px">${cta.label}</a>` : ''}
  <div style="margin-top:28px;font-size:11px;color:#5c594f">gemlinecards.com — the card exchange</div>
</div>`;

export const templates = {
  orderShipped: ({ player, carrier, tracking }) => ({
    subject: `Shipped: ${player} is on the way 📦`,
    html: shell(`Your card shipped`,
      `<b>${player}</b> is on the way via <b>${carrier}</b>.<br/>Tracking: <code>${tracking}</code><br/><br/>Confirm receipt in Portfolio → Orders when it arrives to complete the order.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Track Order' }),
  }),
  auctionWon: ({ player, price }) => ({
    subject: `You won: ${player} — ${price} 🏆`,
    html: shell(`Auction won`,
      `Congratulations — you won <b>${player}</b> for <b>${price}</b>.<br/>Payment is held in escrow. The seller will ship your card; you'll get tracking as soon as it moves.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'View Order' }),
  }),
  offerReceived: ({ player, amount, listPrice }) => ({
    subject: `New offer: ${player} — ${amount}`,
    html: shell(`You have a new offer`,
      `A buyer offered <b>${amount}</b> for <b>${player}</b>${listPrice ? ` (listed at ${listPrice})` : ''}.<br/>Accept or decline it from your Offers inbox.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Review Offer' }),
  }),
  offerAccepted: ({ player, amount }) => ({
    subject: `Offer accepted: ${player} — ${amount} ✅`,
    html: shell(`Your offer was accepted`,
      `The seller accepted your <b>${amount}</b> offer for <b>${player}</b>.<br/>Payment is held in escrow. You'll get tracking once the card ships.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'View Order' }),
  }),
};
