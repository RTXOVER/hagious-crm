import { redirect } from "next/navigation";

/** "Minha conta" agora fica em Configurações → Conta. */
export default function AccountPage() {
  redirect("/configuracoes");
}
