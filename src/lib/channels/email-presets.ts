/** Servidores dos provedores mais comuns (o usuário pode ajustar em "Configuração avançada"). */
export type EmailPreset = {
  value: string;
  label: string;
  imap: { host: string; port: number; secure: boolean } | null;
  smtp: { host: string; port: number; secure: boolean } | null;
  hint: string;
  available: boolean;
};

export const EMAIL_PRESETS: EmailPreset[] = [
  {
    value: "gmail",
    label: "Gmail / Google Workspace",
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 465, secure: true },
    hint: "Use uma “senha de app” do Google (exige verificação em duas etapas), não a senha normal.",
    available: true,
  },
  {
    value: "hostinger",
    label: "Hostinger",
    imap: { host: "imap.hostinger.com", port: 993, secure: true },
    smtp: { host: "smtp.hostinger.com", port: 465, secure: true },
    hint: "Use a senha da caixa de e-mail criada no painel da Hostinger.",
    available: true,
  },
  {
    value: "locaweb",
    label: "Locaweb",
    imap: { host: "email-ssl.com.br", port: 993, secure: true },
    smtp: { host: "email-ssl.com.br", port: 465, secure: true },
    hint: "Confira os servidores no painel da Locaweb se a conexão falhar.",
    available: true,
  },
  {
    value: "zoho",
    label: "Zoho Mail",
    imap: { host: "imap.zoho.com", port: 993, secure: true },
    smtp: { host: "smtp.zoho.com", port: 465, secure: true },
    hint: "Ative o acesso IMAP nas configurações do Zoho Mail.",
    available: true,
  },
  {
    value: "yahoo",
    label: "Yahoo Mail",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    hint: "Use uma senha de app gerada na conta Yahoo.",
    available: true,
  },
  {
    value: "microsoft",
    label: "Outlook / Microsoft 365",
    imap: null,
    smtp: null,
    hint: "A Microsoft exige conexão própria (login Microsoft); será adicionada depois.",
    available: false,
  },
  {
    value: "outro",
    label: "Outro provedor",
    imap: { host: "", port: 993, secure: true },
    smtp: { host: "", port: 465, secure: true },
    hint: "Informe os servidores IMAP (receber) e SMTP (enviar) do seu provedor.",
    available: true,
  },
];
