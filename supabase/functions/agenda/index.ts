// =====================================================================
// Ordenha360 · Edge Function "agenda" (as visitas do técnico no calendário do celular)
//
// GET /functions/v1/agenda?t=<token>  →  text/calendar (.ics)
// Traz as OS em aberto (aberta, agendada ou em andamento) com data marcada de UM técnico,
// dos últimos 30 dias até 90 dias para frente.
//
// O calendário do celular não manda login: quem abre a porta é o token (32 letras e números),
// guardado em agenda-tokens/<token> = { uid, criadoEm }. Por isso a função é publicada com
// --no-verify-jwt e confere o token ela mesma. Token errado, ou pessoa sem acesso liberado → 404.
// Na demonstração o token fica em demo_agenda-tokens/<token> e a agenda lê as coleções demo_*.
//
// Cada OS vira um evento com UID fixo (o id da OS): mudar a data só move o evento.
//   hora marcada → 1h30 · manhã → 8h às 12h · tarde → 13h30 às 17h30 · sem horário → dia inteiro
//   avisos: 1 hora antes (dia inteiro: às 7h do dia) e na véspera às 19h
// Nada de custo, preço ou comissão no calendário.
//
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o próprio Supabase entrega para a função (sem segredo novo).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) || '';
const banco = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const naoAchou = () => new Response('Agenda não encontrada.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
const CAT: Record<string, string> = { ordenha: 'Ordenha', resfriador: 'Resfriador', conforto: 'Conforto animal' };
const TIPOS: Record<string, string> = { preventiva: 'Preventiva', corretiva: 'Corretiva', instalacao: 'Instalação', visita: 'Visita técnica' };
const ABERTAS = ['aberta', 'agendada', 'andamento'];

// ---------- datas (Brasília não tem horário de verão desde 2019: UTC−3 o ano todo) ----------
function hojeBrasilia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function somarDias(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const horaOk = (h: unknown) => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h);
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
function somarMin(h: string, n: number) {
  const t = Math.min(minutos(h) + n, 23 * 60 + 59);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
// hora de Brasília → UTC no formato do calendário (20261202T110000Z)
function utc(iso: string, hhmm: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, Number(hhmm.slice(0, 2)) + 3, Number(hhmm.slice(3, 5))));
  return t.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
const soData = (iso: string) => iso.replace(/-/g, '');
const carimbo = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ---------- formato .ics ----------
const txt = (v: unknown) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function dobrar(linha: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let atual = '', bytes = 0;
  for (const ch of linha) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) { out.push(atual); atual = ' '; bytes = 1; }
    atual += ch; bytes += b;
  }
  out.push(atual);
  return out.join('\r\n');
}

// ---------- leitura na tabela docs ----------
async function lerDoc(path: string) {
  const { data, error } = await banco.from('docs').select('dados').eq('path', path).maybeSingle();
  if (error) throw error;
  return data ? data.dados : null;
}
async function osDoTecnico(prefixo: string, uid: string) {
  const out: Record<string, unknown>[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await banco.from('docs').select('path, dados').eq('colecao', prefixo + 'ordens').eq('dados->>tecnicoId', uid).range(de, de + 999);
    if (error) throw error;
    out.push(...data.map((r) => ({ ...r.dados, id: r.path.split('/').pop() })));
    if (data.length < 1000) break;
  }
  return out;
}
async function produtoresDe(prefixo: string, ids: string[]) {
  const mapa: Record<string, Record<string, unknown>> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const paths = ids.slice(i, i + 200).map((id) => prefixo + 'produtores/' + id);
    const { data, error } = await banco.from('docs').select('path, dados').in('path', paths);
    if (error) throw error;
    data.forEach((r) => { mapa[r.path.split('/').pop() as string] = r.dados; });
  }
  return mapa;
}

// o que levar: a lista "Levar" da OS e os componentes a trocar (só nome e quantidade, nunca valor)
function levar(o: Record<string, any>) {
  const itens: string[] = [];
  (Array.isArray(o.levar) ? o.levar : []).forEach((i: Record<string, any>) => {
    const d = String(i.descricao || '').trim();
    if (!d) return;
    const q = i.qtd == null ? null : Number(i.qtd);
    itens.push(q == null || q === 1 ? d : d + ' (' + String(q).replace('.', ',') + ')');
  });
  const nomes = o.componentesNomes || {};
  const sem = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  (Array.isArray(o.componentesTrocados) ? o.componentesTrocados : []).forEach((id: string) => {
    const n = nomes[id];
    if (n && !itens.some((t) => sem(t).includes(sem(n)))) itens.push(n);
  });
  return [...new Set(itens)].join(', ');
}

function evento(o: Record<string, any>, p: Record<string, any> | undefined, agora: number) {
  const nome = (p && p.nome) || o.produtorNome || 'Produtor';
  const cat = CAT[o.categoria] || 'OS';
  const L = ['BEGIN:VEVENT', 'UID:' + String(o.id).replace(/[^\w.-]/g, '') + '@ordenha360', 'DTSTAMP:' + carimbo(agora)];
  if (o.atualizadoEm || o.criadoEm) L.push('LAST-MODIFIED:' + carimbo(Number(o.atualizadoEm || o.criadoEm)));
  const dia = o.agendadaPara as string;
  let hora = horaOk(o.agendadaHora) ? o.agendadaHora : '', fim = '';
  if (hora) fim = somarMin(hora, 90);
  else if (o.agendadaPeriodo === 'manha') { hora = '08:00'; fim = '12:00'; }
  else if (o.agendadaPeriodo === 'tarde') { hora = '13:30'; fim = '17:30'; }
  if (hora) L.push('DTSTART:' + utc(dia, hora), 'DTEND:' + utc(dia, fim));
  else L.push('DTSTART;VALUE=DATE:' + soData(dia), 'DTEND;VALUE=DATE:' + soData(somarDias(dia, 1)));
  L.push('SUMMARY:' + txt((o.urgencia === 'urgente' ? '⚠ ' : '') + nome + ' · ' + cat));
  const local = [p && p.linha, p && p.cidade].filter(Boolean).join(', ') || String(o.produtorLocal || '').replace(' · ', ', ');
  if (local) L.push('LOCATION:' + txt(local));
  if (p && p.lat != null && p.lng != null && isFinite(Number(p.lat)) && isFinite(Number(p.lng))) L.push('GEO:' + Number(p.lat) + ';' + Number(p.lng));
  const num = Number(o.numero) > 0 ? 'OS ' + String(Math.round(o.numero)).padStart(4, '0') : 'OS';
  const lev = levar(o);
  const desc = [
    o.motivo ? String(o.motivo) : '',
    p && p.telefone ? 'Telefone do produtor: ' + p.telefone : '',
    num + ' · ' + [TIPOS[o.tipo] || '', cat].filter(Boolean).join(' · '),
    lev ? 'Levar: ' + lev : ''
  ].filter(Boolean).join('\n');
  L.push('DESCRIPTION:' + txt(desc));
  L.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');
  // avisos: 1 hora antes (dia inteiro: às 7h do dia) e na véspera às 19h
  const alarme = (gatilho: string, quando: string) => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + txt(nome + ' · ' + cat + ' (' + quando + ')'), 'TRIGGER:' + gatilho, 'END:VALARM');
  if (hora) { alarme('-PT1H', 'daqui a 1 hora'); alarme('-PT' + (minutos(hora) + 300) + 'M', 'amanhã'); }
  else { alarme('PT7H', 'hoje'); alarme('-PT5H', 'amanhã'); }
  L.push('END:VEVENT');
  return L;
}

Deno.serve(async (req) => {
  try {
    const t = new URL(req.url).searchParams.get('t') || '';
    if (!/^[A-Za-z0-9]{32}$/.test(t)) return naoAchou();
    let prefixo = '';
    let tok = await lerDoc('agenda-tokens/' + t);
    if (!tok) { tok = await lerDoc('demo_agenda-tokens/' + t); prefixo = 'demo_'; }
    if (!tok || !tok.uid) return naoAchou();
    const uid = String(tok.uid);
    // só quem ainda tem acesso liberado
    const usuario = await lerDoc('usuarios/' + uid);
    if (!usuario || usuario.situacao !== 'ativo') return naoAchou();

    const hoje = hojeBrasilia(), de = somarDias(hoje, -30), ate = somarDias(hoje, 90);
    const lista = (await osDoTecnico(prefixo, uid)).filter((o: Record<string, any>) =>
      !o.arquivado && ABERTAS.includes(o.status) && typeof o.agendadaPara === 'string' && o.agendadaPara >= de && o.agendadaPara <= ate);
    const prods = await produtoresDe(prefixo, [...new Set(lista.map((o: Record<string, any>) => String(o.produtorId || '')).filter(Boolean))]);
    const agora = Date.now();
    const quem = String(usuario.apelido || '').trim();
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ordenha360//Agenda do tecnico//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + txt('Ordenha360' + (quem ? ' · ' + quem : '') + (prefixo ? ' (demonstração)' : '')),
      'X-WR-TIMEZONE:America/Sao_Paulo', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
    lista.sort((a: Record<string, any>, b: Record<string, any>) => String(a.agendadaPara).localeCompare(String(b.agendadaPara)))
      .forEach((o: Record<string, any>) => L.push(...evento(o, prods[String(o.produtorId)], agora)));
    L.push('END:VCALENDAR');
    return new Response(L.map(dobrar).join('\r\n') + '\r\n', {
      status: 200,
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="agenda.ics"', 'Cache-Control': 'no-cache' }
    });
  } catch (e) {
    console.error('agenda:', e && (e as Error).message);
    return new Response('Não consegui montar a agenda agora. Tente de novo mais tarde.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '600' } });
  }
});
