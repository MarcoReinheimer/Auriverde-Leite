// =====================================================================
// Ordenha360 · Edge Function "enviar-avisos" (avisos no celular, Web Push)
//
// Dois jeitos de chamar (POST, corpo em JSON):
//  - { "modo": "diario" }  pelo agendador do Supabase, todo dia às 8h de Brasília, com o cabeçalho
//    "Authorization: Bearer <AVISOS_SEGREDO>". Para cada produtor com o celular inscrito
//    (avisos/<idDoProdutor>/inscricoes), manda no máximo 1 aviso por dia, nesta ordem:
//      1. visita agendada para amanhã;
//      2. revisão da ordenhadeira vencendo em até 7 dias (uma vez por data) ou vencida (uma vez por semana);
//      3. troca de componente vencendo em até 7 dias (uma vez por data).
//  - { "modo": "chamado", "pid": "...", "osId": "..." }  pelo app, logo depois que o produtor abre um
//    chamado, com o login de quem abriu. Avisa os técnicos inscritos (avisos-tecnicos/<id>/inscricoes).
//
// O que foi enviado fica em avisos-enviados/<chave>, para não repetir.
// Inscrição que o celular não aceita mais (o aparelho desinstalou ou trocou) é apagada sozinha.
//
// Segredos (Supabase → Edge Functions → Secrets), nunca no config.js nem no GitHub:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:seu-email) e AVISOS_SEGREDO.
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY o próprio Supabase entrega para a função.
// =====================================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k) => Deno.env.get(k) || '';
const banco = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const resposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const RODAPE = ' Qualquer dúvida, abra um chamado no app.';

// ---------- datas no horário de Brasília ----------
function hojeBrasilia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function somarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diasEntre = (de, ate) => Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 86400000);
const ddmm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const numOS = (n) => 'OS ' + String(Number(n) || 0).padStart(4, '0');

// ---------- leitura e gravação na tabela docs ----------
async function lerColecao(filtro) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    let q = banco.from('docs').select('path, dados');
    q = filtro.like ? q.like('colecao', filtro.like) : q.eq('colecao', filtro.eq);
    const { data, error } = await q.range(de, de + 999);
    if (error) throw error;
    out.push(...data.map((r) => ({ ...r.dados, id: r.path.split('/').pop(), path: r.path })));
    if (data.length < 1000) break;
  }
  return out;
}
async function lerDoc(path) {
  const { data, error } = await banco.from('docs').select('dados').eq('path', path).maybeSingle();
  if (error) throw error;
  return data ? data.dados : null;
}
const jaEnviado = async (chave) => !!(await lerDoc('avisos-enviados/' + chave));
async function marcarEnviado(chave, dados) {
  const { error } = await banco.from('docs').upsert({ path: 'avisos-enviados/' + chave, dados: { ...dados, em: Date.now() } });
  if (error) console.error('não gravou avisos-enviados/' + chave, error.message);
}

// ---------- envio ----------
let vapidPronto = false;
function prepararVapid() {
  if (vapidPronto) return;
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY') || !env('VAPID_SUBJECT')) throw new Error('faltam os segredos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ou VAPID_SUBJECT');
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  vapidPronto = true;
}
// devolve em quantos aparelhos o aviso foi aceito
async function enviar(inscricoes, mensagem) {
  prepararVapid();
  let ok = 0;
  for (const s of inscricoes) {
    if (!s.endpoint || !s.keys) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(mensagem), { TTL: 12 * 3600, urgency: 'normal' });
      ok++;
    } catch (e) {
      const st = e && e.statusCode;
      if (st === 404 || st === 410) await banco.from('docs').delete().eq('path', s.path);
      else console.error('aviso não saiu', st, e && (e.body || e.message));
    }
  }
  return ok;
}

// ---------- 1 vez por dia: avisos aos produtores ----------
async function diario() {
  const hoje = hojeBrasilia(), amanha = somarDias(hoje, 1), em7 = somarDias(hoje, 7);
  const inscricoes = await lerColecao({ like: 'avisos/%/inscricoes' });
  const porProdutor = {};
  inscricoes.forEach((s) => { const pid = s.path.split('/')[1]; (porProdutor[pid] = porProdutor[pid] || []).push(s); });
  const pids = Object.keys(porProdutor);
  if (!pids.length) return { hoje, produtoresInscritos: 0, enviados: 0 };
  const ordens = (await lerColecao({ eq: 'ordens' })).filter((o) => !o.arquivado);
  const resultado = [];
  let enviados = 0;
  for (const pid of pids) {
    const p = await lerDoc('produtores/' + pid);
    if (!p || p.arquivado || p.situacao === 'inativo') continue;
    if (await jaEnviado('dia_' + pid + '_' + hoje)) continue; // no máximo 1 por dia
    const opcoes = [];
    const visita = ordens.find((o) => o.produtorId === pid && o.status === 'agendada' && o.agendadaPara === amanha);
    if (visita) opcoes.push({ tipo: 'visita', chave: 'visita_' + visita.id, texto: 'Amanhã (' + ddmm(amanha) + ') tem visita do técnico na sua propriedade.' + RODAPE });
    const rev = p.proximaRevisao;
    if (rev && rev >= hoje && rev <= em7) opcoes.push({ tipo: 'revisao', chave: 'revisao_' + pid + '_' + rev, texto: 'Sua ordenhadeira está com a revisão marcada para ' + ddmm(rev) + '.' + RODAPE });
    if (rev && rev < hoje) {
      const semana = Math.floor(diasEntre(rev, hoje) / 7);
      opcoes.push({ tipo: 'revisao-vencida', chave: 'revvencida_' + pid + '_' + rev + '_' + semana, texto: 'A revisão da sua ordenhadeira venceu em ' + ddmm(rev) + '. Vamos agendar?' + RODAPE });
    }
    const troca = p.proximaTrocaData;
    if (troca && troca >= hoje && troca <= em7) {
      const comp = p.proximaTrocaComp ? String(p.proximaTrocaComp).toLowerCase() : 'uma peça da ordenhadeira';
      opcoes.push({ tipo: 'componente', chave: 'troca_' + pid + '_' + troca, texto: 'Está chegando a hora de trocar ' + comp + ' (até ' + ddmm(troca) + ').' + RODAPE });
    }
    let escolhida = null;
    for (const o of opcoes) { if (!(await jaEnviado(o.chave))) { escolhida = o; break; } }
    if (!escolhida) continue;
    const n = await enviar(porProdutor[pid], { titulo: 'Ordenha360', texto: escolhida.texto, tela: 'p-inicio', tag: 'diario-' + pid });
    if (n) {
      await marcarEnviado(escolhida.chave, { produtorId: pid, tipo: escolhida.tipo, texto: escolhida.texto });
      await marcarEnviado('dia_' + pid + '_' + hoje, { produtorId: pid, tipo: escolhida.tipo, aparelhos: n });
      enviados++;
    }
    resultado.push({ produtorId: pid, tipo: escolhida.tipo, aparelhos: n });
  }
  return { hoje, produtoresInscritos: pids.length, enviados, resultado };
}

// ---------- chamado novo aberto pelo produtor: avisa os técnicos ----------
async function chamado(req, corpo) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return resposta(401, { erro: 'sem login' });
  // a mesma regra do banco: só quem está liberado no app pode pedir o aviso
  const comoQuemPediu = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: 'Bearer ' + token } }, auth: { persistSession: false } });
  const { data: ativo, error } = await comoQuemPediu.rpc('eh_ativo');
  if (error || ativo !== true) return resposta(403, { erro: 'sem acesso liberado' });
  const pid = String(corpo.pid || ''), osId = String(corpo.osId || '');
  if (!/^[\w-]+$/.test(pid) || !/^[\w-]+$/.test(osId)) return resposta(400, { erro: 'pid e osId são obrigatórios' });
  const os = await lerDoc('produtores/' + pid + '/visitas/' + osId);
  if (!os) return resposta(404, { erro: 'chamado não encontrado' });
  if (os.status !== 'aberta' || os.origem !== 'produtor') return resposta(200, { ignorado: 'não é um chamado aberto pelo produtor' });
  if (await jaEnviado('chamado_' + osId)) return resposta(200, { jaEnviado: true });
  const p = (await lerDoc('produtores/' + pid)) || {};
  const motivo = String(os.motivo || '').replace(/\s+/g, ' ').trim();
  const texto = (p.nome || 'Um produtor') + (os.urgencia === 'urgente' ? ' (urgente)' : '') + ': ' + (motivo ? (motivo.length > 110 ? motivo.slice(0, 107) + '…' : motivo) : 'abriu um chamado.');
  const inscricoes = await lerColecao({ like: 'avisos-tecnicos/%/inscricoes' });
  const n = await enviar(inscricoes, { titulo: 'Novo chamado · ' + numOS(os.numero), texto, tela: 'ordens', tag: 'chamado-' + osId });
  await marcarEnviado('chamado_' + osId, { produtorId: pid, osId, aparelhos: n });
  return resposta(200, { tecnicosAvisados: n });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resposta(405, { erro: 'use POST' });
  let corpo = {};
  try { corpo = await req.json(); } catch (e) { corpo = {}; }
  try {
    if (corpo.modo === 'chamado') return await chamado(req, corpo);
    if (corpo.modo === 'diario') {
      const segredo = env('AVISOS_SEGREDO');
      const veio = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!segredo || veio !== segredo) return resposta(401, { erro: 'segredo errado' });
      return resposta(200, await diario());
    }
    return resposta(400, { erro: 'modo deve ser "diario" ou "chamado"' });
  } catch (e) {
    console.error(e);
    return resposta(500, { erro: String(e && e.message ? e.message : e) });
  }
});
