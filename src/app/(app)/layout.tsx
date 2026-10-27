import { requireProfile, isAdmin, isManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, DEPARTMENT_LABEL } from "@/lib/labels";
import { getPreferences } from "@/lib/preferences-server";
import { AppShell } from "@/components/app-shell";
import { FormatProvider } from "@/components/format-provider";
import { signOut } from "@/app/login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const [profile, unread, prefs] = await Promise.all([
    requireProfile(),
    // Avisos não lidos (o banco só devolve os da própria pessoa)
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    getPreferences(),
  ]);
  const subtitle = `${ROLE_LABEL[profile.role]}${profile.department ? ` · ${DEPARTMENT_LABEL[profile.department]}` : ""}`;

  return (
    <FormatProvider prefs={prefs}>
      <AppShell
        user={{ name: profile.full_name, subtitle }}
        isAdmin={isAdmin(profile)}
        isManager={isManager(profile)}
        unread={unread.count ?? 0}
        signOut={signOut}
      >
        {children}
      </AppShell>
    </FormatProvider>
  );
}
