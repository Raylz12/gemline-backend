// Vault lifecycle. Once a slab is vaulted, sales and trades settle as an
// ownership record change — the card never moves — which is what makes
// instant, authenticity-guaranteed trades possible.
import { transition } from './machine.js';
import { VAULT } from './states.js';

export async function requestIntake(repo, { cardId, ownerId }) {
  const v = await repo.vault.insert({
    card_id: cardId, owner_id: ownerId, status: VAULT.INTAKE_REQUESTED,
    cert_verified: false, created_at: new Date().toISOString(),
  });
  await repo.events.insert({ entity_type: 'vault', entity_id: v.id, from_state: null, to_state: VAULT.INTAKE_REQUESTED });
  return v;
}

export async function markReceived(repo, vaultItem) {
  if (vaultItem.status === VAULT.INTAKE_REQUESTED) await transition(repo, 'vault', vaultItem, VAULT.INBOUND_SHIPPED, {});
  return transition(repo, 'vault', vaultItem, VAULT.RECEIVED, {});
}

// Run authentication: cert lookup + slab/photo checks. result: 'passed'|'failed'.
export async function authenticate(repo, vaultItem, { result = 'passed', certLookup = null, photos = null, authenticator = null } = {}) {
  await transition(repo, 'vault', vaultItem, VAULT.AUTHENTICATING, {});
  await repo.auth.insert({
    vault_item_id: vaultItem.id, result, cert_lookup: certLookup, photos,
    authenticator, created_at: new Date().toISOString(),
  });
  if (result === 'passed') {
    vaultItem.cert_verified = true;
    vaultItem.authenticated_at = new Date().toISOString();
    return transition(repo, 'vault', vaultItem, VAULT.VAULTED, {});
  }
  return transition(repo, 'vault', vaultItem, VAULT.REJECTED, {});
}

// Ownership transfer on a vaulted item — the instant-settlement primitive.
export async function transferOwnership(repo, vaultItem, newOwnerId) {
  vaultItem.owner_id = newOwnerId;
  await repo.vault.update(vaultItem);
  await repo.events.insert({ entity_type: 'vault', entity_id: vaultItem.id, from_state: 'vaulted', to_state: 'vaulted', payload: { owner: newOwnerId } });
  return vaultItem;
}

export async function requestWithdrawal(repo, vaultItem) {
  return transition(repo, 'vault', vaultItem, VAULT.WITHDRAWAL_REQUESTED, {});
}

export { VAULT };
