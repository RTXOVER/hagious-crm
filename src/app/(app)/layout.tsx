import { requireProfile, isAdmin } from "@/lib/auth";
import { ROLE_LABEL, DEPARTMENT_LABEL } from "@/lib/labels";
import { AppShell } from "@/components/app-shell";
import { signOut } from "@/app/login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireProfile();
  const subtitle = `${ROLE_LABEL[profile.role]}${profile.department ? ` · ${DEPARTMENT_LABEL[profile.department]}` : ""}`;

  return (
    <AppShell user={{ name: profile.full_name, subtitle }} isAdmin={isAdmin(profile)} signOut={signOut}>
      {children}
    </AppShell>
  );
}
