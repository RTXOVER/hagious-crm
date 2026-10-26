import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DEPARTMENT_LABEL, ROLE_LABEL } from "@/lib/labels";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Minha conta" };

export default async function AccountPage() {
  const profile = await requireProfile();
  return (
    <>
      <PageHeader title="Minha conta" />
      <div className="card mb-6 max-w-md p-6 text-sm">
        <p className="font-semibold">{profile.full_name}</p>
        <p className="text-muted">{profile.email}</p>
        <p className="mt-2">
          {ROLE_LABEL[profile.role]}
          {profile.department ? ` · ${DEPARTMENT_LABEL[profile.department]}` : ""}
        </p>
        <p className="mt-2 text-xs text-muted">Para alterar cargo ou departamento, fale com um administrador.</p>
      </div>
      <PasswordForm />
    </>
  );
}
