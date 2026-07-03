// Consolidated: /user/[handle] is the single public profile page (follow,
// trade, report/block, trust info, showcase). This route only survives as a
// permanent redirect so old links and bookmarks keep working.
import { redirect } from 'next/navigation';

export default async function ProfileRedirect({ params }) {
  const { handle } = await params;
  redirect(`/user/${encodeURIComponent(handle)}`);
}
