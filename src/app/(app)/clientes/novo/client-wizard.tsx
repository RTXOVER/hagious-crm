"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarDays,
  Check,
  CircleCheck,
  LoaderCircle,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ReceiptText,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { ActionState } from "@/lib/auth";
import { clientSchema, contactSchema, fieldErrors } from "@/lib/validation/schemas";
import { isValidCnpj, normalizeCnpj } from "@/lib/validation/cnpj";
import { CLIENT_STATUS_LABEL, DEPARTMENT_LABEL, TAX_REGIME_LABEL } from "@/lib/labels";
import { Alert } from "@/components/page-header";
import { ChoiceChips, IconField, Stepper, ToggleCard, maskCnpj, maskPhone } from "@/components/form-controls";
import { Select } from "@/components/ui/select";
import { useFormat } from "@/components/format-provider";
import { peopleOptions } from "@/components/ui/options";
import { createClientAction } from "../actions";
import { lookupCnpjAction, type CnpjLookupResult } from "../cnpj-actions";

type Regime = keyof typeof TAX_REGIME_LABEL;
type Status = keyof typeof CLIENT_STATUS_LABEL;
type Dep = "contabil" | "fiscal" | "dp";
type Person = { id: string; full_name: string; department: string | null };

const STEPS = ["Empresa", "Perfil e serviços", "Contato", "Revisão"];

// Em qual etapa fica cada campo (para voltar à etapa certa quando o servidor apontar erro)
const FIELD_STEP: Record<string, number> = {
  cnpj: 0, legal_name: 0, trade_name: 0, email: 0, phone: 0, address: 0,
  tax_regime: 1, status: 1, client_since: 1,
};

const SERVICE_CARDS: { dep: Dep; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { dep: "contabil", icon: Calculator, description: "Escrituração contábil, balancetes e balanço" },
  { dep: "fiscal", icon: ReceiptText, description: "Escrita fiscal e apuração de impostos" },
  { dep: "dp", icon: UsersRound, description: "Folha de pagamento, admissões e obrigações trabalhistas" },
];

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: CnpjLookupResult };

export function ClientWizard({ people }: { people: Person[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Etapa 1 — Empresa
  const [cnpj, setCnpj] = useState("");
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const lastLookup = useRef("");

  // Etapa 2 — Perfil e serviços
  const [regime, setRegime] = useState<Regime>("simples_nacional");
  const regimeTouched = useRef(false);
  const [status, setStatus] = useState<Status>("ativo");
  const [clientSince, setClientSince] = useState("");
  const [services, setServices] = useState<Record<Dep, boolean>>({ contabil: true, fiscal: false, dp: false });
  const [resp, setResp] = useState<Record<Dep, string>>({ contabil: "", fiscal: "", dp: "" });

  // Etapa 3 — Contato
  const [contactName, setContactName] = useState("");
  const [contactJob, setContactJob] = useState("");
  const [contactWhats, setContactWhats] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [optIn, setOptIn] = useState(false);

  // Etapa 4 — Revisão
  const [notes, setNotes] = useState("");

  const [state, dispatch, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await createClientAction(prev, fd);
    // Só chega aqui se houve erro (no sucesso o servidor redireciona para a página do cliente)
    if (result.errors) {
      setErrors(result.errors);
      const keys = Object.keys(result.errors);
      const target = keys.some((k) => k.startsWith("contact_")) ? 2 : Math.min(...keys.map((k) => FIELD_STEP[k] ?? 3));
      setStep(target);
    }
    return result;
  }, {});

  const existing = lookup.status === "done" ? lookup.result.existing : undefined;

  // ---------- Consulta do CNPJ ----------
  async function runLookup(value: string) {
    const digits = normalizeCnpj(value);
    if (!isValidCnpj(digits) || digits === lastLookup.current) return;
    lastLookup.current = digits;
    setLookup({ status: "loading" });
    const result = await lookupCnpjAction(digits);
    setLookup({ status: "done", result });
    if (result.ok) {
      const d = result.data;
      // Preenche só o que ainda está vazio: nunca apaga o que a pessoa digitou
      setLegalName((v) => v || d.legal_name);
      setTradeName((v) => v || d.trade_name);
      setAddress((v) => v || d.address);
      setPhone((v) => v || (d.phone ? maskPhone(d.phone) : ""));
      setEmail((v) => v || d.email);
      if (d.suggested_regime && !regimeTouched.current) setRegime(d.suggested_regime);
      if (d.registration_status && d.registration_status !== "ATIVA") setStatus("suspenso");
    }
  }

  function onCnpjChange(value: string) {
    const masked = maskCnpj(value);
    setCnpj(masked);
    setErrors((e) => ({ ...e, cnpj: "" }));
    if (normalizeCnpj(masked).length === 14) {
      if (!isValidCnpj(masked)) setErrors((e) => ({ ...e, cnpj: "CNPJ inválido (verifique os dígitos)" }));
      else void runLookup(masked);
    }
  }

  // ---------- Validação por etapa ----------
  function validateStep(i: number): boolean {
    let found: Record<string, string> = {};
    if (i === 0) {
      const r = clientSchema
        .pick({ legal_name: true, trade_name: true, cnpj: true, email: true, phone: true, address: true })
        .safeParse({ legal_name: legalName, trade_name: tradeName, cnpj, email, phone, address });
      if (!r.success) found = fieldErrors(r.error);
      if (existing) found.cnpj = "Este CNPJ já está cadastrado.";
    }
    if (i === 1) {
      const r = clientSchema.pick({ client_since: true }).safeParse({ client_since: clientSince });
      if (!r.success) found = fieldErrors(r.error);
    }
    if (i === 2 && (contactName || contactWhats || contactEmail || contactJob)) {
      const r = contactSchema.safeParse({
        name: contactName, job_title: contactJob, email: contactEmail, whatsapp: contactWhats,
        is_primary: true, whatsapp_opt_in: optIn,
      });
      if (!r.success) {
        found = Object.fromEntries(Object.entries(fieldErrors(r.error)).map(([k, v]) => [`contact_${k}`, v]));
      }
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function next() {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step < STEPS.length - 1) return next();
    for (let i = 0; i < STEPS.length - 1; i++) {
      if (!validateStep(i)) return setStep(i);
    }
    const fd = new FormData(formRef.current!);
    // Envio manual: mantém o formulário preenchido caso o servidor recuse algo
    startTransition(() => dispatch(fd));
  }

  const selectedDeps = (Object.keys(services) as Dep[]).filter((d) => services[d]);
  const contactFilled = Boolean(contactName || contactWhats || contactEmail);

  return (
    <div className="mx-auto max-w-3xl">
      <Stepper steps={STEPS} current={step} onGo={(i) => setStep(i)} />

      <form ref={formRef} onSubmit={submit} noValidate className="card overflow-hidden">
        {errors._form && <div className="px-6 pt-6"><Alert tone="danger">{errors._form}</Alert></div>}
        {state.errors?._form && !errors._form && <div className="px-6 pt-6"><Alert tone="danger">{state.errors._form}</Alert></div>}

        {/* ---------------- Etapa 1: Empresa ---------------- */}
        <section hidden={step !== 0} className="space-y-5 p-6 sm:p-8">
          <StepTitle icon={Building2} title="Qual empresa vamos atender?" subtitle="Digite o CNPJ: buscamos os dados públicos na Receita e preenchemos para você." />

          <IconField
            label="CNPJ"
            name="cnpj"
            icon={Search}
            value={cnpj}
            onChange={(e) => onCnpjChange(e.target.value)}
            placeholder="00.000.000/0000-00"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            error={errors.cnpj}
            className="[&_input]:py-3.5 [&_input]:text-lg [&_input]:font-semibold [&_input]:tracking-wide"
            trailing={
              <button
                type="button"
                onClick={() => { lastLookup.current = ""; void runLookup(cnpj); }}
                disabled={!isValidCnpj(cnpj) || lookup.status === "loading"}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                {lookup.status === "loading" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Buscar"}
              </button>
            }
          />

          <LookupFeedback lookup={lookup} />

          <div className="grid gap-4 sm:grid-cols-2">
            <IconField label="Razão social *" name="legal_name" icon={Building2} value={legalName} onChange={(e) => setLegalName(e.target.value)} error={errors.legal_name} className="sm:col-span-2" />
            <IconField label="Nome fantasia" name="trade_name" icon={Store} value={tradeName} onChange={(e) => setTradeName(e.target.value)} error={errors.trade_name} />
            <IconField label="Telefone da empresa" name="phone" icon={Phone} value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} placeholder="(00) 0000-0000" inputMode="tel" error={errors.phone} />
            <IconField label="E-mail da empresa" name="email" type="email" icon={Mail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contato@empresa.com.br" error={errors.email} className="sm:col-span-2" />
            <IconField label="Endereço" name="address" icon={MapPin} value={address} onChange={(e) => setAddress(e.target.value)} error={errors.address} className="sm:col-span-2" />
          </div>
        </section>

        {/* ---------------- Etapa 2: Perfil e serviços ---------------- */}
        <section hidden={step !== 1} className="space-y-6 p-6 sm:p-8">
          <StepTitle icon={Sparkles} title="Perfil fiscal e serviços" subtitle="Escolha o regime e o que a Hagious vai fazer por este cliente." />

          <ChoiceChips
            label="Regime tributário"
            name="tax_regime"
            columns={5}
            value={regime}
            onChange={(v) => { regimeTouched.current = true; setRegime(v); }}
            options={(Object.keys(TAX_REGIME_LABEL) as Regime[]).map((r) => ({
              value: r,
              label: TAX_REGIME_LABEL[r],
              hint: lookup.status === "done" && lookup.result.ok && lookup.result.data.suggested_regime === r ? "Sugerido pela Receita" : undefined,
            }))}
          />

          <div className="grid gap-6 sm:grid-cols-[1fr_14rem]">
            <ChoiceChips
              label="Situação do cliente"
              name="status"
              value={status}
              onChange={setStatus}
              options={(Object.keys(CLIENT_STATUS_LABEL) as Status[]).map((s) => ({ value: s, label: CLIENT_STATUS_LABEL[s] }))}
            />
            <IconField label="Cliente desde" name="client_since" type="date" icon={CalendarDays} value={clientSince} onChange={(e) => setClientSince(e.target.value)} error={errors.client_since} />
          </div>

          <fieldset>
            <legend className="label">Serviços contratados</legend>
            <p className="mb-3 text-sm text-muted">Definem quais departamentos atendem o cliente. Escolha também o responsável de cada um.</p>
            <div className="space-y-3">
              {SERVICE_CARDS.map(({ dep, icon, description }) => (
                <ToggleCard
                  key={dep}
                  name="services"
                  value={dep}
                  checked={services[dep]}
                  onChange={(c) => setServices((s) => ({ ...s, [dep]: c }))}
                  icon={icon}
                  title={DEPARTMENT_LABEL[dep]}
                  description={description}
                >
                  <label htmlFor={`resp_${dep}`} className="label">Responsável</label>
                  <Select
                    id={`resp_${dep}`}
                    name={`resp_${dep}`}
                    value={resp[dep]}
                    onChange={(v) => setResp((r) => ({ ...r, [dep]: v }))}
                    searchable
                    options={peopleOptions(people, { empty: "Definir depois", department: dep })}
                  />
                </ToggleCard>
              ))}
            </div>
          </fieldset>
        </section>

        {/* ---------------- Etapa 3: Contato ---------------- */}
        <section hidden={step !== 2} className="space-y-5 p-6 sm:p-8">
          <StepTitle icon={MessageCircle} title="Quem fala pela empresa?" subtitle="É para este WhatsApp que vão os lembretes de documentos. Você pode pular e cadastrar depois." />
          <div className="grid gap-4 sm:grid-cols-2">
            <IconField label="Nome do contato" name="contact_name" icon={UserRound} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nome completo" error={errors.contact_name} />
            <IconField label="Cargo / função" name="contact_job_title" icon={BriefcaseBusiness} value={contactJob} onChange={(e) => setContactJob(e.target.value)} placeholder="Ex.: Sócio, Financeiro" error={errors.contact_job_title} />
            <IconField label="WhatsApp" name="contact_whatsapp" icon={Phone} value={contactWhats} onChange={(e) => setContactWhats(maskPhone(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" error={errors.contact_whatsapp} />
            <IconField label="E-mail" name="contact_email" type="email" icon={Mail} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="pessoa@empresa.com.br" error={errors.contact_email} />
          </div>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
              optIn ? "border-brand-500 bg-brand-50" : "border-line hover:border-brand-500/60"
            }`}
          >
            <input type="checkbox" name="contact_whatsapp_opt_in" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="peer sr-only" />
            <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 transition peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20 ${optIn ? "border-brand-600 bg-brand-600 text-white" : "border-muted/50 bg-surface"}`}>
              {optIn && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
            <span>
              <span className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-link" /> O contato autorizou mensagens pelo WhatsApp</span>
              <span className="mt-0.5 block text-sm text-muted">
                Exigido pela Meta para mensagens automáticas. Marque somente se a autorização foi de fato obtida; data e
                responsável ficam registrados.
              </span>
            </span>
          </label>
          {errors.contact_whatsapp_opt_in && <p className="field-error">{errors.contact_whatsapp_opt_in}</p>}
        </section>

        {/* ---------------- Etapa 4: Revisão ---------------- */}
        <section hidden={step !== 3} className="space-y-5 p-6 sm:p-8">
          <StepTitle icon={CircleCheck} title="Tudo certo?" subtitle="Confira os dados antes de cadastrar. Clique em “Alterar” para corrigir." />
          <Summary title="Empresa" onEdit={() => setStep(0)} rows={[
            ["Razão social", legalName], ["Nome fantasia", tradeName], ["CNPJ", cnpj],
            ["Telefone", phone], ["E-mail", email], ["Endereço", address],
          ]} />
          <Summary title="Perfil e serviços" onEdit={() => setStep(1)} rows={[
            ["Regime", TAX_REGIME_LABEL[regime]], ["Situação", CLIENT_STATUS_LABEL[status]],
            ["Serviços", selectedDeps.map((d) => DEPARTMENT_LABEL[d]).join(", ") || "Nenhum (definir depois)"],
            ["Responsáveis", selectedDeps.map((d) => `${DEPARTMENT_LABEL[d]}: ${people.find((p) => p.id === resp[d])?.full_name ?? "definir depois"}`).join(" · ")],
          ]} />
          <Summary title="Contato principal" onEdit={() => setStep(2)} rows={
            contactFilled
              ? [["Nome", contactName], ["WhatsApp", contactWhats], ["E-mail", contactEmail], ["Autorização WhatsApp", optIn ? "Sim" : "Não"]]
              : [["", "Nenhum contato informado. Você pode adicionar depois."]]
          } />
          <div>
            <label htmlFor="notes" className="label">Observações internas (opcional)</label>
            <textarea id="notes" name="notes" rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="mt-1 text-xs text-muted">Evite registrar dados pessoais sensíveis (saúde, religião etc.).</p>
          </div>
        </section>

        {/* ---------------- Navegação ---------------- */}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-2 px-6 py-4 sm:px-8">
          {step === 0 ? (
            <Link href="/clientes" className="btn-secondary">Cancelar</Link>
          ) : (
            <button type="button" onClick={() => setStep((s) => s - 1)} className="btn-secondary">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
          )}
          <div className="flex items-center gap-3">
            {step === 2 && !contactFilled && (
              <button type="button" onClick={() => setStep(3)} className="text-sm font-semibold text-muted hover:text-ink">
                Pular
              </button>
            )}
            <button type="submit" className="btn-primary px-6" disabled={pending || (step === 0 && lookup.status === "loading")}>
              {step < STEPS.length - 1 ? (
                <>Continuar <ArrowRight className="h-4 w-4" /></>
              ) : pending ? (
                <><LoaderCircle className="h-4 w-4 animate-spin" /> Cadastrando…</>
              ) : (
                <><CircleCheck className="h-4 w-4" /> Cadastrar cliente</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function StepTitle({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string }) {
  return (
    <div className="mb-2 text-center">
      <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-link">
        <Icon className="h-7 w-7" />
      </span>
      <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{subtitle}</p>
    </div>
  );
}

function LookupFeedback({ lookup }: { lookup: LookupState }) {
  const f = useFormat();
  if (lookup.status === "idle") return null;
  if (lookup.status === "loading") {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Consultando a Receita Federal…
      </p>
    );
  }
  const r = lookup.result;
  if (r.existing) {
    return (
      <Alert tone="warn">
        Este CNPJ já está cadastrado: <Link href={`/clientes/${r.existing.id}`} className="underline">{r.existing.name}</Link>.
      </Alert>
    );
  }
  if (!r.ok) {
    const msg = {
      invalid: "CNPJ inválido.",
      not_found: "CNPJ não encontrado na base pública. Preencha os dados manualmente.",
      unavailable: "A consulta à Receita está indisponível agora. Preencha os dados manualmente.",
    }[r.reason];
    return <Alert tone="info">{msg}</Alert>;
  }
  const d = r.data;
  const active = d.registration_status === "ATIVA";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${active ? "border-ok/30 bg-ok-soft" : "border-warn/30 bg-warn-soft"}`}>
      <p className={`flex items-center gap-2 font-bold ${active ? "text-ok" : "text-warn"}`}>
        {active ? <CircleCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        {active ? "Empresa encontrada. Dados preenchidos abaixo, confira." : `Atenção: situação na Receita “${d.registration_status || "desconhecida"}”.`}
      </p>
      <p className="mt-1 text-ink">{d.legal_name}</p>
      <p className="text-xs text-muted">
        {[d.city, d.activity, d.opened_on && `aberta em ${f.date(d.opened_on)}`].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

function Summary({ title, rows, onEdit }: { title: string; rows: [string, string][]; onEdit: () => void }) {
  return (
    <div className="rounded-2xl border border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="text-sm font-extrabold">{title}</p>
        <button type="button" onClick={onEdit} className="link text-xs">Alterar</button>
      </div>
      <dl className="divide-y divide-line text-sm">
        {rows.map(([k, v], i) => (
          <div key={i} className="grid gap-1 px-4 py-2 sm:grid-cols-[10rem_1fr]">
            {k && <dt className="text-muted">{k}</dt>}
            <dd className={k ? "" : "text-muted sm:col-span-2"}>{v || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
