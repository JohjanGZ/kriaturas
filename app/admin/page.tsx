import { redirect } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth';

export default async function AdminIndex() {
  await requireAdminPage();
  redirect('/admin/species');
}
