import { redirect } from 'next/navigation';

// Mystery Pulls retired (2026-07-02) — old links land on the marketplace.
export default function PacksPage() {
  redirect('/market');
}
