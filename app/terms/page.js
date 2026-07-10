import LegalDoc from '../components/LegalDoc';

export const metadata = {
  title: 'Terms of Service — GEMLINE',
  description: 'The rules of the show: what GEMLINE is, how buying/selling/trading works, what\u2019s prohibited, and how disputes are handled.',
  alternates: { canonical: '/terms' },
};

const SECTIONS = [
  {
    h: 'Agreement to these Terms',
    p: [
      'These Terms of Service ("Terms") are a binding agreement between you and GEMLINE ("GEMLINE," "we," "us"), the operator of gemlinecards.com and related services (the "Service"). By creating an account or using the Service, you accept these Terms, our Privacy Policy, and — if you sell — the Marketplace Seller Agreement.',
      'You must be at least 18 years old and able to form a binding contract to use the Service. If you don\u2019t agree with these Terms, don\u2019t use GEMLINE.',
    ],
  },
  {
    h: 'What GEMLINE is (and isn\u2019t)',
    p: [
      'GEMLINE is an online marketplace and price guide for trading cards: buy-now listings, offers, auctions, card-for-card trades, collection tracking, price data, and a collector community.',
      'GEMLINE is a venue. Sales and trades are contracts between the buyer and the seller — GEMLINE is not the buyer, seller, or owner of listed cards and does not take title to them. We facilitate payment escrow and dispute review to keep both sides honest, but we do not guarantee the authenticity, condition, grade, legality, or quality of any card beyond the processes described in these Terms.',
    ],
  },
  {
    h: 'Your account',
    list: [
      'Provide accurate information and keep it current.',
      'One account per person. You are responsible for everything that happens under your account and for keeping your credentials secure.',
      'We may require anti-bot verification (Cloudflare Turnstile) and identity or collection verification before enabling certain features, such as listing cards for sale.',
      'We may suspend or terminate accounts that violate these Terms, engage in fraud, or create risk for other users or GEMLINE.',
    ],
  },
  {
    h: 'Buying',
    p: [
      'When you buy a card, your payment is processed by Stripe and held in escrow — the seller is not paid immediately. You must provide an accurate shipping address; the seller ships to the address on the order with tracking.',
      'After the carrier marks the order delivered, a 48-hour inspection window opens. If the card arrives as described, confirm receipt (or let the window lapse) and the seller is paid. If the card is not as described, open a dispute from the order before the inspection window ends — the payout freezes while GEMLINE reviews.',
      'Placing a bid in an auction or accepting a price is a binding commitment to buy. Orders not paid before the payment deadline are cancelled automatically.',
    ],
  },
  {
    h: 'Selling',
    p: [
      'Selling is additionally governed by the Marketplace Seller Agreement. In short: list only cards you own and physically possess, describe them accurately, ship promptly with tracking, and receive your payout — the sale price minus GEMLINE\u2019s fee (5% on your first five sales, 7.5% thereafter) — when the buyer confirms receipt or the inspection window lapses. Full fee details are on the Fees & Payouts page.',
    ],
  },
  {
    h: 'Trades',
    p: [
      'Card-for-card trades are free. Both parties must ship their side with tracking. Any cash component ("sweetener") on a trade settles through the same escrow flow as a sale. Trade proposals you accept are binding commitments.',
    ],
  },
  {
    h: 'Prohibited items and conduct',
    p: ['The following will get listings removed and accounts suspended or banned:'],
    list: [
      'Counterfeit, reprinted, or fake cards sold as authentic.',
      'Altered cards — trimmed, recolored, rebacked, pressed, or restored — without clear, prominent disclosure.',
      'Cards with forged or mismatched grading labels/certs, or graded-card claims that don\u2019t match the grading company\u2019s records.',
      'Stolen goods, or listing cards you do not own and possess.',
      'Shill bidding, price manipulation, or coordinated market abuse.',
      'Steering completed deals off-platform to avoid fees.',
      'Harassment, threats, hate speech, spam, or scam attempts anywhere on the Service.',
      'Using stolen or misrepresentative photos in listings.',
      'Scraping, automated bulk access, or attempts to probe or disrupt the Service.',
    ],
  },
  {
    h: 'Your content',
    p: [
      'You own the content you post (photos, posts, comments, collection data). By posting, you grant GEMLINE a non-exclusive, worldwide, royalty-free license to host, display, and distribute that content as needed to operate and promote the Service. We may remove content that violates these Terms. Users can report listings, posts, and accounts; reports are reviewed by our moderation team.',
    ],
  },
  {
    h: 'Price data — not financial advice',
    p: [
      'Market prices, price movements, deal ratings, and portfolio values shown on GEMLINE are estimates sourced from third-party market data (Card Hedge) and our own computations. They are informational only — not appraisals, not guarantees, and not investment advice. Collectibles carry risk; prices can and do go down.',
    ],
  },
  {
    h: 'Fees and payments',
    p: [
      'Current fees are listed on the Fees & Payouts page: account creation, browsing, listing, and trading are free; sellers pay 5% of the sale price on their first five completed sales and 7.5% from the sixth sale onward, with the rate locked in when each order is placed. Payments are processed by Stripe — GEMLINE never stores your card numbers. We may change fees prospectively with notice; changes never apply retroactively to completed sales or orders already placed.',
    ],
  },
  {
    h: 'Disputes between buyers and sellers',
    p: [
      'If a buyer opens a not-as-described dispute during the inspection window, the seller\u2019s payout is frozen while GEMLINE reviews the order, messages, photos, and tracking. GEMLINE may release the payout, refund the buyer to the original payment method, or require a return, at our reasonable discretion. Escrow decisions by GEMLINE are final as to the escrowed funds. Initiating a card-network chargeback for an order that is already covered by an open GEMLINE dispute may result in account suspension while it is resolved.',
    ],
  },
  {
    h: 'Disclaimers',
    p: [
      'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. GEMLINE DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT PRICE DATA IS ACCURATE OR COMPLETE.',
    ],
  },
  {
    h: 'Limitation of liability',
    p: [
      'TO THE MAXIMUM EXTENT PERMITTED BY LAW, GEMLINE\u2019S TOTAL LIABILITY ARISING OUT OF OR RELATING TO THE SERVICE IS LIMITED TO THE GREATER OF (A) THE FEES YOU PAID TO GEMLINE IN THE 12 MONTHS BEFORE THE CLAIM AROSE, OR (B) $100. GEMLINE IS NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST DATA, OR THE ACTS OR OMISSIONS OF OTHER USERS.',
    ],
  },
  {
    h: 'Indemnification',
    p: [
      'You agree to indemnify and hold GEMLINE harmless from claims, damages, and expenses (including reasonable attorneys\u2019 fees) arising from your use of the Service, your listings or content, your transactions with other users, or your violation of these Terms or applicable law.',
    ],
  },
  {
    h: 'Termination',
    p: [
      'You can stop using GEMLINE at any time and request account deletion through the contact page. We may suspend or terminate your access for violations of these Terms, fraud, legal risk, or extended inactivity. Obligations from completed or in-flight transactions (payouts, disputes, escrow) survive termination, as do sections of these Terms that by their nature should survive.',
    ],
  },
  {
    h: 'Governing law and disputes with GEMLINE',
    p: [
      'These Terms are governed by the laws of the State of Florida, without regard to conflict-of-law rules. Before filing any claim against GEMLINE, you agree to contact us and attempt in good faith to resolve the issue informally for 30 days. Any claim must be brought individually — not as a class action — in the state or federal courts located in Florida, and you consent to their jurisdiction.',
    ],
  },
  {
    h: 'Changes to these Terms',
    p: [
      'We may update these Terms from time to time. Material changes will be announced on the Service or by email, and the effective date above will be updated. Continuing to use GEMLINE after changes take effect means you accept the updated Terms.',
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      sub="The rules of the show — plain English where possible, precise where it matters."
      effective="July 9, 2026"
      sections={SECTIONS}
    />
  );
}
