import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { IDLE_LIMIT_MS, LAST_SEEN_COOKIE, contentSecurityPolicy, securityHeaders, sessionCookieOptions } from "@/lib/security/headers";

const PUBLIC_PATHS = ["/login"];

/**
 * Executa antes de cada página:
 * - aplica a política de segurança de conteúdo (CSP com nonce novo a cada resposta) e cabeçalhos de proteção;
 * - renova a sessão do Supabase (cookies httpOnly) e encerra sessões paradas há mais de 8 horas;
 * - manda para o login quem não entrou.
 * A proteção real dos dados está no banco (RLS) e nas ações do servidor.
 */
export async function proxy(request: NextRequest) {
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development", https });

  // O Next lê o CSP da requisição para colocar o nonce nos próprios scripts
  const forward = () => {
    const h = new Headers(request.headers);
    h.set("x-nonce", nonce);
    h.set("Content-Security-Policy", csp);
    return NextResponse.next({ request: { headers: h } });
  };
  const finish = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    for (const [k, v] of Object.entries(securityHeaders(https))) res.headers.set(k, v);
    return res;
  };

  let response = forward();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: sessionCookieOptions(https),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = forward();
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // getClaims valida o token; não confie apenas na presença do cookie.
  const { data } = await supabase.auth.getClaims();
  let isLoggedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  // Sessão parada há mais de 8 horas: encerra (ex.: computador compartilhado esquecido aberto)
  const now = Date.now();
  const seen = Number(request.cookies.get(LAST_SEEN_COOKIE)?.value);
  let expired = false;
  if (isLoggedIn && Number.isFinite(seen) && seen > 0 && now - seen > IDLE_LIMIT_MS) {
    await supabase.auth.signOut({ scope: "local" });
    isLoggedIn = false;
    expired = true;
  }

  if (!isLoggedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (path !== "/") url.searchParams.set("next", path);
    if (expired) url.searchParams.set("expirou", "1");
    const redirect = NextResponse.redirect(url);
    // Leva junto os cookies apagados/renovados pelo Supabase
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    redirect.cookies.delete(LAST_SEEN_COOKIE);
    return finish(redirect);
  }

  // Marca o último uso (no máximo uma vez por minuto, para não reescrever o cookie a cada clique)
  if (isLoggedIn && (!Number.isFinite(seen) || now - seen > 60_000)) {
    response.cookies.set(LAST_SEEN_COOKIE, String(now), { ...sessionCookieOptions(https), maxAge: 60 * 60 * 24 * 30 });
  }
  if (!isLoggedIn && expired) response.cookies.delete(LAST_SEEN_COOKIE);

  return finish(response);
}

export const config = {
  matcher: [
    // Ignora arquivos estáticos e o webhook (que tem autenticação própria)
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
