import LegalDoc from '../components/LegalDoc';

export const metadata = {
  title: 'Marketplace Seller Agreement — GEMLINE',
  description: 'The deal for sellers: list accurately, ship fast with tracking, get paid through escrow — just 5% on your first five sales, 7.5% after. Fakes and trimmed cards get you banned.',
  alternates: { canonical: '/seller-agreement' },
};

const SECTIONS = [
  {
    h: 'Scope',
    p: [
      'This Marketplace Seller Agreement ("Agreement") applies whenever you list, sell, auction, or trade a card on GEMLINE. It supplements the Terms of Service; if the two conflict for selling activity, this Agreement controls. By creating a listing, you accept this Agreement.',
    ],
  },
  {
    h: 'Who can sell',
    list: [
      'You must have an account in good standing and be 18 or older.',
      'You must own and physically possess every card you list. No drop-shipping, no listing cards you\u2019ve only ordered, no selling someone else\u2019s cards without disclosed authorization.',
      'GEMLINE may require collection verification (e.g., scanning the physical card) before a card can be listed, and may require identity verification for payouts through Stripe.',
      'Receiving payouts requires a connected Stripe account. You are responsible for the accuracy of your payout details.',
    ],
  },
  {
    h: 'Listing standards',
    list: [
      'Describe the actual card: real photos of the physical card in your possession — no stock photos, no stolen photos.',
      'Condition and grade claims must be accurate. For graded cards, the cert number and label must match the grading company\u2019s records.',
      'Disclose everything material: surface wear, whitening, print lines, authenticity questions, and any alteration (see Prohibited items).',
      'Set prices freely — market data is shown to help, but your price is your call. Your exact net payout (after GEMLINE\u2019s fee) is shown before you publish.',
    ],
  },
  {
    h: 'Prohibited items',
    p: ['Listing any of the following is grounds for immediate removal, payout withholding, and account ban:'],
    list: [
      'Counterfeit or reprinted cards presented as authentic.',
      'Trimmed, recolored, rebacked, pressed, or otherwise altered cards without clear and prominent disclosure in the listing.',
      'Cards in forged, tampered, or mismatched grading slabs.',
      'Stolen property.',
      'Anything you cannot legally sell.',
    ],
  },
  {
    h: 'Fees',
    p: [
      'Listing is free. When your card sells, GEMLINE\u2019s fee is 5% of the sale price on your first five completed sales and 7.5% from your sixth sale onward, deducted before payout. The applicable rate is locked in when each order is placed. Buyers pay no GEMLINE surcharge. Card-for-card trades are free; any cash component of a trade settles through escrow like a sale. Fee changes apply prospectively only — never to sales already completed or orders already placed. Full details: Fees & Payouts.',
      'Completing deals off-platform to avoid fees ("hey, just PayPal me") is a violation of this Agreement and forfeits all GEMLINE protections for that deal.',
    ],
  },
  {
    h: 'Shipping',
    list: [
      'Ship within 3 business days of the order entering "awaiting shipment," to the buyer\u2019s address on the order.',
      'Tracking is required on every shipment and must be entered on the order.',
      'Pack like a collector: sleeve, rigid protection (top loader / card saver / graded-slab padding), and a secure outer mailer or box.',
      'Shipping cost is yours — price your cards accordingly.',
      'Until the carrier confirms delivery, risk of loss is on you. Orders lost in transit without valid tracking are refunded to the buyer.',
    ],
  },
  {
    h: 'Escrow and payout',
    p: [
      'The buyer\u2019s payment is captured by Stripe and held in escrow when the order is placed. After the carrier marks the order delivered, a 48-hour inspection window opens. Your payout — sale price minus GEMLINE\u2019s fee (5% on your first five sales, 7.5% after, at the rate locked when the order was placed) — is released when the buyer confirms receipt or the inspection window lapses, whichever comes first. Payout timing after release depends on Stripe\u2019s standard transfer schedule.',
    ],
  },
  {
    h: 'Cancellations',
    p: [
      'Before shipment, either side may cancel and the buyer\u2019s payment hold is released in full — nobody is charged, no fee applies. Repeated seller cancellations (selling cards you don\u2019t have, backing out of fair sales) hurt your standing and can lead to suspension.',
    ],
  },
  {
    h: 'Disputes and returns',
    list: [
      'If the buyer opens a not-as-described dispute during the inspection window, your payout freezes while GEMLINE reviews.',
      'You must respond to disputes and provide requested evidence (photos, packaging, cert details) within 3 days; silence resolves the dispute in the buyer\u2019s favor.',
      'GEMLINE may release the payout, refund the buyer, or require a return of the card before refunding, at our reasonable discretion. Escrow decisions are final as to the escrowed funds.',
      'Confirmed misrepresentation (fake, altered, or materially misdescribed cards) results in a full buyer refund and account enforcement, up to a permanent ban.',
    ],
  },
  {
    h: 'Enforcement',
    p: [
      'GEMLINE may remove listings, suspend selling privileges, freeze pending payouts connected to suspected fraud, and terminate accounts for violations of this Agreement. Where fraud is confirmed, we may withhold escrowed funds to make affected buyers whole and report the conduct to law enforcement.',
    ],
  },
  {
    h: 'Taxes',
    p: [
      'You are responsible for your own income-tax obligations on sales proceeds. Where marketplace-facilitator laws apply, GEMLINE (via its payment partners) may collect and remit sales tax on transactions and issue required tax forms (e.g., 1099-K via Stripe) based on your sales volume.',
    ],
  },
  {
    h: 'Relationship',
    p: [
      'You sell as an independent party. Nothing in this Agreement makes you an employee, agent, or partner of GEMLINE, and you may not represent otherwise. You are responsible for complying with laws that apply to your selling activity.',
    ],
  },
  {
    h: 'Changes',
    p: [
      'We may update this Agreement from time to time. Material changes will be announced on the Service or by email and take effect prospectively; listings created before a change remain under the terms shown at listing time until sold or removed.',
    ],
  },
];

export default function SellerAgreementPage() {
  return (
    <LegalDoc
      title="Marketplace Seller Agreement"
      sub="The deal for sellers: describe it straight, ship it fast, get paid through escrow."
      effective="July 9, 2026"
      sections={SECTIONS}
    />
  );
}
