// Retired standalone page — the Price Guide (/analytics) contains the heat map
// view. Kept only as a redirect so old links and indexed URLs keep working.
import { redirect } from 'next/navigation';

export default function HeatmapRedirect() {
  redirect('/analytics?view=heatmap');
}
