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
      `Congratulations — you won <b>${player}</b> for <b>${price}</b>.<br/>Complete payment within 24h to secure your card. Open Orders to pay now — your card ships once payment clears.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Complete Payment' }),
  }),
  orderPaid: ({ player, amount }) => ({
    subject: `Sold: ${player} — ${amount} 💰`,
    html: shell(`Payment received`,
      `Payment for <b>${player}</b> (<b>${amount}</b>) cleared and is held in escrow.<br/>Ship the card to complete the sale and release your payout.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Ship Now' }),
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
      `The seller accepted your <b>${amount}</b> offer for <b>${player}</b>.<br/>Complete payment within 24h to secure your card — open Orders to pay now.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Complete Payment' }),
  }),
  welcome: ({ handle }) => ({
    subject: `Welcome to GEMLINE, ${handle} 🎴`,
    html: shell(`Welcome to the show`,
      `Your account is live. GEMLINE is the card show, online — buy, sell, and trade with collectors who get it, with live prices on hundreds of thousands of cards.<br/><br/>
       <b>Get started:</b><br/>
       • Add cards to <b>My Collection</b> to track what you hold<br/>
       • Watch a card to get price-move alerts<br/>
       • Listing is free — you keep 90% when it sells, escrow protects both sides`,
      { url: 'https://gemlinecards.com/market', label: 'Hit the Floor' }),
  }),
  payoutReleased: ({ player, amount, net }) => ({
    subject: `Payout released: ${player} — ${net} 💸`,
    html: shell(`Your payout is on the way`,
      `The sale of <b>${player}</b> (${amount}) is complete.<br/>Your payout of <b>${net}</b> (after GEMLINE’s fee) has been released from escrow. Arrival depends on your bank — typically 1–3 business days.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'View Order' }),
  }),
  disputeOpenedSeller: ({ player, reason }) => ({
    subject: `Dispute opened: ${player} ⚠️`,
    html: shell(`The buyer reported a problem`,
      `A dispute was opened on your sale of <b>${player}</b>:<br/><i>“${String(reason || '').slice(0, 200)}”</i><br/><br/>Your payout is on hold while GEMLINE reviews. Reply on the order with your side and any evidence (photos, packaging, cert details) within <b>3 days</b> — no response resolves the dispute in the buyer’s favor.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Respond Now' }),
  }),
  disputeOpenedBuyer: ({ player }) => ({
    subject: `Dispute received: ${player}`,
    html: shell(`We’re on it`,
      `Your dispute on <b>${player}</b> is open and the seller’s payout is frozen while GEMLINE reviews. We may ask for photos or details — watch the order messages. Most disputes resolve within a few days.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'View Order' }),
  }),
  orderCancelled: ({ player, byWhom }) => ({
    subject: `Order cancelled: ${player}`,
    html: shell(`Order cancelled`,
      `The order for <b>${player}</b> was cancelled${byWhom ? ` by the ${byWhom}` : ''}.<br/>The payment hold has been released in full — nobody was charged.`,
      { url: 'https://gemlinecards.com/market', label: 'Back to the Floor' }),
  }),
  cancelRequested: ({ player, reason }) => ({
    subject: `Cancel request: ${player}`,
    html: shell(`The buyer asked to cancel`,
      `The buyer requested cancellation of <b>${player}</b>${reason ? `:<br/><i>“${String(reason).slice(0, 200)}”</i>` : '.'}<br/><br/>Approve or decline from your Orders — if you approve, the buyer’s hold is released and nobody is charged.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Review Request' }),
  }),
  questionReceived: ({ player, question }) => ({
    subject: `New question on your listing: ${player}`,
    html: shell(`A buyer has a question`,
      `Someone asked about your listing of <b>${player}</b>:<br/><i>“${String(question || '').slice(0, 300)}”</i><br/><br/>Answer it from the card page — your reply is public and helps every future buyer pull the trigger.`,
      { url: 'https://gemlinecards.com/portfolio', label: 'Answer Question' }),
  }),
  // GEMLINE Pro deal alert — sent by /api/cron/deal-alerts after each price
  // sync (max 1 per alert per 24h). `deals`: [{ player, detail, buy, rate, net, score }]
  dealAlert: ({ alertName, deals = [] }) => {
    const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 2 });
    const rows = deals.map(d => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #23262e">
          <div style="font-weight:bold;color:#fff;font-size:14px">${d.player}</div>
          <div style="font-size:12px;color:#8b887d">${d.detail || ''}</div>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #23262e;text-align:right;white-space:nowrap">
          <div style="font-size:13px;color:#b9b6ac">Buy ~<b style="color:#34D88A">${money(d.buy)}</b> · sells ~<b style="color:#fff">${money(d.rate)}</b></div>
          <div style="font-size:12px;color:#34D88A">You keep ${money(d.net)} after fees · Score <b>${d.score}</b></div>
        </td>
      </tr>`).join('');
    return {
      subject: `${deals.length} deal${deals.length === 1 ? '' : 's'} matching “${alertName}” 🎯`,
      html: shell(`Your deal alert hit`,
        `Fresh from the latest price sync — cards matching <b>${alertName}</b>, priced below their going rate with the 7.5% fee already counted:<br/>
         <table style="width:100%;border-collapse:collapse;margin-top:12px">${rows}</table>
         <div style="font-size:11px;color:#5c594f;margin-top:10px">GEMLINE Score blends net edge, liquidity, trend stability, and spread confidence (0–100). Manage alerts on the Deal Finder.</div>`,
        { url: 'https://gemlinecards.com/deal-finder', label: 'Open the Deal Finder' }),
    };
  },
  passwordReset: ({ link }) => ({
    subject: `Reset your GEMLINE password`,
    html: shell(`Password reset`,
      `Someone (hopefully you) asked to reset the password on this account.<br/>This link works once and expires in <b>1 hour</b>:<br/><br/>If you didn’t ask for this, ignore this email — your password is unchanged.`,
      { url: link, label: 'Reset Password' }),
  }),
};
