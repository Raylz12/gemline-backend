// The single source of truth for what states exist and which moves are legal.
// Mirrors the enums in db/schema.sql. The service layer never sets a status
// directly — it goes through machine.transition(), which checks these maps.

export const ORDER = {
  CREATED: 'created', ESCROW_HELD: 'escrow_held', AWAITING_SHIPMENT: 'awaiting_shipment',
  AT_AUTH_HUB: 'at_auth_hub', AUTHENTICATING: 'authenticating', AUTH_PASSED: 'auth_passed',
  AUTH_FAILED: 'auth_failed', SHIPPED: 'shipped', DELIVERED: 'delivered',
  INSPECTION: 'inspection', SETTLED: 'settled', DISPUTED: 'disputed',
  REFUNDED: 'refunded', CANCELLED: 'cancelled',
};

// Allowed order transitions. Branches cover all three fulfillment methods.
export const ORDER_TX = {
  created:           ['escrow_held', 'cancelled'],
  escrow_held:       ['awaiting_shipment', 'settled', 'cancelled'], // settled = vault instant
  awaiting_shipment: ['shipped', 'at_auth_hub', 'cancelled'],
  at_auth_hub:       ['authenticating'],
  authenticating:    ['auth_passed', 'auth_failed'],
  auth_passed:       ['shipped'],
  auth_failed:       ['refunded'],
  shipped:           ['delivered', 'exception_refund:refunded'],
  delivered:         ['inspection', 'disputed'],
  inspection:        ['settled', 'disputed'],
  disputed:          ['refunded', 'settled'],   // resolve toward buyer or seller
  settled:           [],
  refunded:          [],
  cancelled:         [],
};

export const TRADE = {
  PROPOSED: 'proposed', COUNTERED: 'countered', ACCEPTED: 'accepted', SETTLING: 'settling',
  SETTLED: 'settled', DECLINED: 'declined', CANCELLED: 'cancelled', EXPIRED: 'expired', DISPUTED: 'disputed',
};
export const TRADE_TX = {
  proposed:  ['accepted', 'countered', 'declined', 'cancelled', 'expired'],
  countered: ['accepted', 'declined', 'cancelled', 'expired'],
  accepted:  ['settling', 'settled'],            // settled directly when vault_instant
  settling:  ['settled', 'disputed', 'cancelled'],
  settled:   [], declined: [], cancelled: [], expired: [], disputed: ['settled', 'cancelled'],
};

export const VAULT = {
  INTAKE_REQUESTED: 'intake_requested', INBOUND_SHIPPED: 'inbound_shipped', RECEIVED: 'received',
  AUTHENTICATING: 'authenticating', VAULTED: 'vaulted', LISTED: 'listed', REJECTED: 'rejected',
  WITHDRAWAL_REQUESTED: 'withdrawal_requested', OUTBOUND_SHIPPED: 'outbound_shipped', WITHDRAWN: 'withdrawn',
};
export const VAULT_TX = {
  intake_requested:     ['inbound_shipped', 'received'],
  inbound_shipped:      ['received'],
  received:             ['authenticating'],
  authenticating:       ['vaulted', 'rejected'],
  vaulted:              ['listed', 'withdrawal_requested'],
  listed:               ['vaulted', 'withdrawal_requested'], // delist / sell keeps it vaulted
  withdrawal_requested: ['outbound_shipped'],
  outbound_shipped:     ['withdrawn'],
  rejected: [], withdrawn: [],
};

export const SHIPMENT = { LABEL: 'label_created', TRANSIT: 'in_transit', DELIVERED: 'delivered', EXCEPTION: 'exception', RETURNED: 'returned' };
export const SHIPMENT_TX = {
  label_created: ['in_transit', 'returned'],
  in_transit:    ['delivered', 'exception', 'returned'],
  exception:     ['in_transit', 'returned'],
  delivered: [], returned: [],
};

export const ESCROW = { HELD: 'held', RELEASED: 'released', REFUNDED: 'refunded', PARTIAL: 'partial', VOID: 'void' };
export const ESCROW_TX = {
  held:    ['released', 'refunded', 'partial', 'void'],
  partial: ['released', 'refunded'],
  released: [], refunded: [], void: [],
};

export const MACHINES = {
  order: ORDER_TX, trade: TRADE_TX, vault: VAULT_TX, shipment: SHIPMENT_TX, escrow: ESCROW_TX,
};
