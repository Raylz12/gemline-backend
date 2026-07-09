import LegalDoc from '../components/LegalDoc';

export const metadata = {
  title: 'Privacy Policy — GEMLINE',
  description: 'What GEMLINE collects, why, who it\u2019s shared with, and the controls you have. No selling of personal data. Card numbers never touch our servers.',
  alternates: { canonical: '/privacy' },
};

const SECTIONS = [
  {
    h: 'The short version',
    list: [
      'We collect what we need to run a card marketplace: your account info, addresses for shipping, order history, and what you do on the site.',
      'Payment card numbers never touch our servers — Stripe handles all payment processing.',
      'We do not sell your personal data. Ever.',
      'Your shipping address is shared with your counterparty only when a deal requires shipping.',
    ],
  },
  {
    h: 'What we collect',
    p: ['Information you give us:'],
    list: [
      'Account: email address, display name, and a password (stored only as a bcrypt hash — we cannot see it).',
      'Shipping addresses you save for checkout.',
      'Marketplace activity: listings, orders, bids, offers, trades, order messages, and disputes.',
      'Collection data: cards you add to your collection, photos you upload, scans, and grading-cert verification requests.',
      'Community content: posts, comments, follows, watchlists, and alert preferences.',
      'Anything you send us through the contact page or reports.',
    ],
  },
  {
    h: 'What we collect automatically',
    list: [
      'Usage data: pages viewed, searches, and feature interactions, used to run and improve the Service.',
      'Device and log data: IP address, browser type, and timestamps, used for security, rate limiting, and fraud prevention.',
      'Anti-bot signals via Cloudflare Turnstile when you register or perform sensitive actions.',
      'A session token (JWT) stored in your browser to keep you signed in. We use functional cookies/local storage — not third-party advertising trackers.',
    ],
  },
  {
    h: 'How we use it',
    list: [
      'Operate the marketplace: process orders, hold escrow, release payouts, run auctions and trades.',
      'Ship cards: give the seller the buyer\u2019s shipping address for a paid order.',
      'Keep the show honest: fraud detection, rate limiting, moderation of reports, and dispute review.',
      'Communicate: transactional messages about your orders, alerts you asked for (price moves, new listings), and important service announcements.',
      'Improve the product: aggregate, de-identified analytics about how features are used.',
      'Comply with law: tax, accounting, and lawful requests from authorities.',
    ],
  },
  {
    h: 'Who we share it with',
    p: ['We share personal data only with the parties needed to run the Service:'],
    list: [
      'Stripe — payment processing, escrow, and seller payouts. Your card details go directly to Stripe and never touch GEMLINE\u2019s servers.',
      'Your counterparty — when you buy, the seller sees your shipping address and display name to fulfill the order; order messages are visible to both sides.',
      'Infrastructure providers — hosting (Vercel), database (Neon), and security/CDN (Cloudflare), each processing data on our behalf.',
      'Grading companies — if you verify a graded card, the cert number is checked against the grader\u2019s public records (e.g., PSA).',
      'Law enforcement or regulators — when required by law or to protect users from fraud or harm.',
    ],
  },
  {
    h: 'What we don\u2019t do',
    list: [
      'We do not sell or rent your personal data.',
      'We do not run third-party advertising trackers on the Service.',
      'We do not store payment card numbers.',
      'We do not share your collection or portfolio contents publicly beyond what you choose to showcase on your profile.',
    ],
  },
  {
    h: 'Security',
    p: [
      'Passwords are hashed with bcrypt. Traffic is encrypted in transit (HTTPS). Access to production data is restricted, sensitive actions are rate-limited, and registration is protected against bots. No system is perfectly secure — if we learn of a breach affecting your data, we will notify you as required by law.',
    ],
  },
  {
    h: 'Retention',
    p: [
      'We keep account data while your account is active. Transaction records (orders, escrow, payouts, disputes) are retained as required for accounting, tax, and fraud-prevention purposes even after account deletion. Content you delete is removed from the Service, though it may persist briefly in backups.',
    ],
  },
  {
    h: 'Your choices and rights',
    list: [
      'Access and update your account details in Settings at any time.',
      'Turn alerts and notification preferences on or off in the app.',
      'Request a copy or deletion of your personal data through the contact page. We will honor requests as required by applicable law (including the CCPA for California residents), subject to the retention needs above.',
      'California residents: we do not sell or share personal information as defined by the CCPA, and we don\u2019t use it for cross-context behavioral advertising.',
    ],
  },
  {
    h: 'Children',
    p: [
      'GEMLINE is for adults. You must be 18 or older to use the Service. We do not knowingly collect data from anyone under 18; if we learn we have, we will delete it.',
    ],
  },
  {
    h: 'Changes to this policy',
    p: [
      'We may update this policy as the Service evolves. Material changes will be announced on the Service or by email, and the effective date above will be updated.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      sub="What we collect, why, and who sees it — without the legalese fog."
      effective="July 9, 2026"
      sections={SECTIONS}
    />
  );
}
