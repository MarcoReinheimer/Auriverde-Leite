// =====================================================================
// Ordenha360 · Edge Function "enviar-avisos" (avisos no celular, Web Push)
//
// Três jeitos de chamar (POST, corpo em JSON):
//  - { "modo": "lembretes" }  pelo agendador do Supabase, a cada 15 minutos, com o cabeçalho
//    "Authorization: Bearer <AVISOS_SEGREDO>". Avisa os técnicos e o Administrador (avisos-tecnicos/<id>/inscricoes):
//      1. 1 hora antes de cada visita com hora marcada: "Daqui 1 hora: Valdir Schneider · Resfriador";
//      2. às 19h, quem tem visita no dia seguinte: "Amanhã: Valdir (manhã), Adriana (14h), Márcia (tarde)" e o que levar;
//      3. às 7h, o resumo do dia: "Hoje: 3 visitas · 2 revisões vencendo esta semana · 1 chamado sem resposta" (sem nada, não manda).
//    Cada técnico recebe só o que é dele; o Administrador recebe o resumo de todos. Cada pessoa escolhe o que quer
//    em avisos-tecnicos/<id>/prefs/avisos = { hora, vespera, manha, chamados } (sem o documento, tudo ligado).
//  - { "modo": "diario" }  (avisos aos produtores; a área do produtor ainda não é usada) com o cabeçalho
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
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:seu-email) e, se quiser, AVISOS_SEGREDO.
// A senha do agendador vale se bater com o AVISOS_SEGREDO daqui OU com o "avisos_segredo" do Vault do banco
// (o mesmo que o agendamento manda), conferido pela função do banco avisos_segredo_confere (README).
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

// ---------- senha do agendador ----------
// vale o AVISOS_SEGREDO da função ou o avisos_segredo do Vault (a função do banco só responde sim ou não,
// e só para a chave de serviço: quem usa o app não consegue perguntar)
async function segredoOk(veio) {
  if (!veio) return false;
  const s = env('AVISOS_SEGREDO');
  if (s && veio === s) return true;
  const { data, error } = await banco.rpc('avisos_segredo_confere', { t: veio });
  if (error) { console.error('não conferiu a senha no Vault', error.message); return false; }
  return data === true;
}

// ---------- envio ----------
// para conferir de fora se as chaves estão lá (nunca devolve a chave privada; a pública já está no config.js)
const vapidSituacao = () => ({ vapid: !!(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY') && env('VAPID_SUBJECT')), vapidPublica: env('VAPID_PUBLIC_KEY').slice(0, 12) });
let vapidPronto = false;
function prepararVapid() {
  if (vapidPronto) return;
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY') || !env('VAPID_SUBJECT')) throw new Error('faltam os segredos VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ou VAPID_SUBJECT');
  webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
  vapidPronto = true;
}
// devolve em quantos aparelhos o aviso foi aceito
async function enviar(inscricoes, mensagem, ttl = 12 * 3600) {
  prepararVapid();
  let ok = 0;
  for (const s of inscricoes) {
    if (!s.endpoint || !s.keys) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(mensagem), { TTL: ttl, urgency: 'normal' });
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

// ---------- a cada 15 minutos: lembretes aos técnicos e o resumo do dia (horário de Brasília) ----------
function agoraBrasilia() {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const v = (t) => (partes.find((p) => p.type === t) || { value: '0' }).value;
  return { dia: v('year') + '-' + v('month') + '-' + v('day'), min: Number(v('hour')) * 60 + Number(v('minute')) };
}
const CATEGORIA = { ordenha: 'Ordenha', resfriador: 'Resfriador', conforto: 'Conforto animal' };
const horaOk = (h) => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h);
const minutosDe = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
const horaFala = (h) => Number(h.slice(0, 2)) + 'h' + (h.slice(3, 5) !== '00' ? h.slice(3, 5) : '');
function turnoFala(o) {
  if (horaOk(o.agendadaHora)) return horaFala(o.agendadaHora);
  return o.agendadaPeriodo === 'manha' ? 'manhã' : o.agendadaPeriodo === 'tarde' ? 'tarde' : '';
}
// na ordem do dia: manhã conta como 10h, tarde como 15h30 e sem horário vai no fim
const ordemTurno = (o) => horaOk(o.agendadaHora) ? minutosDe(o.agendadaHora) : o.agendadaPeriodo === 'manha' ? 600 : o.agendadaPeriodo === 'tarde' ? 930 : 9999;
// o que levar: a lista "Levar" da OS e os componentes a trocar (só nome e quantidade, nunca valor)
function levarTxt(o) {
  const itens = [];
  (Array.isArray(o.levar) ? o.levar : []).forEach((i) => {
    const d = String(i.descricao || '').trim();
    if (!d) return;
    const q = i.qtd == null ? null : Number(i.qtd);
    itens.push(q == null || q === 1 ? d : d + ' (' + String(q).replace('.', ',') + ')');
  });
  const nomes = o.componentesNomes || {};
  (Array.isArray(o.componentesTrocados) ? o.componentesTrocados : []).forEach((id) => {
    const n = nomes[id];
    if (n && !itens.some((t) => semAcento(t).includes(semAcento(n)))) itens.push(n);
  });
  return [...new Set(itens)].join(', ');
}
// produtor do técnico: o "Técnico responsável" do cadastro bate com o nome dele; sem técnico no cadastro, quem atendeu por último
function doTecnico(p, uid, nomes, ultimaPorProd) {
  const resp = semAcento(p.tecnico);
  if (resp) return nomes.some((n) => n === resp || n.includes(resp) || resp.includes(n) || primeiroNome(n) === primeiroNome(resp));
  const u = ultimaPorProd[p.id];
  return !!u && u.tecnicoId === uid;
}
async function lembretes() {
  const agora = agoraBrasilia(), hoje = agora.dia, amanha = somarDias(hoje, 1);
  const fimSemana = somarDias(hoje, (7 - new Date(hoje + 'T12:00:00Z').getUTCDay()) % 7);   // até domingo
  const inscricoes = await lerColecao({ like: 'avisos-tecnicos/%/inscricoes' });
  const porPessoa = {};
  inscricoes.forEach((s) => { const uid = s.path.split('/')[1]; (porPessoa[uid] = porPessoa[uid] || []).push(s); });
  const uids = Object.keys(porPessoa);
  if (!uids.length) return { hoje, agora: Math.floor(agora.min / 60) + 'h' + String(agora.min % 60).padStart(2, '0'), inscritos: 0, enviados: 0, ...vapidSituacao() };
  const ordens = (await lerColecao({ eq: 'ordens' })).filter((o) => !o.arquivado);
  const produtores =(await lerColecao({ eq: 'produtores' })).filter((p) => !p.arquivado && p.situacao !== 'inativo');
  const prodPorId = {};
  produtores.forEach((p) => { prodPorId[p.id] = p; });
  const ultimaPorProd = {};
  ordens.forEach((o) => {
    if (o.status !== 'concluida' && o.status !== 'andamento') return;
    const u = ultimaPorProd[o.produtorId];
    if (!u || String(o.data || '') > String(u.data || '')) ultimaPorProd[o.produtorId] = o;
  });
  const nomeDe = (o) => (prodPorId[o.produtorId] || {}).nome || o.produtorNome || 'Produtor';
  const enviados = [];
  for (const uid of uids) {
    const u = await lerDoc('usuarios/' + uid);
    if (!u || u.situacao !== 'ativo') continue;
    const admin = u.papel === 'admin' || u.dono === true;
    const pref = (await lerDoc('avisos-tecnicos/' + uid + '/prefs/avisos')) || {};
    const quer = (k) => pref[k] !== false;
    const minhas = ordens.filter((o) => o.tecnicoId === uid && (o.status === 'agendada' || o.status === 'andamento'));
    const mandar = async (chave, msg, ttl) => {
      if (await jaEnviado(chave)) return;
      const n = await enviar(porPessoa[uid], msg, ttl);
      if (n) { await marcarEnviado(chave, { usuarioId: uid, aparelhos: n, texto: msg.texto }); enviados.push(chave); }
    };
    // 1. 1 hora antes de cada visita com hora marcada
    if (quer('hora')) {
      for (const o of minhas) {
        if (o.status !== 'agendada' || o.agendadaPara !== hoje || !horaOk(o.agendadaHora)) continue;
        const falta = minutosDe(o.agendadaHora) - agora.min;
        if (falta <= 0 || falta > 60) continue;
        await mandar('hora_' + o.id + '_' + hoje + '_' + o.agendadaHora.replace(':', ''),
          { titulo: 'Visita às ' + horaFala(o.agendadaHora), texto: 'Daqui 1 hora: ' + nomeDe(o) + ' · ' + (CATEGORIA[o.categoria] || 'OS'), tela: 'os:' + o.produtorId + ':' + o.id, tag: 'hora-' + o.id }, 2 * 3600);
      }
    }
    // 2. às 19h: as visitas de amanhã e o que levar
    if (quer('vespera') && agora.min >= 19 * 60 && agora.min < 22 * 60) {
      const am = minhas.filter((o) => o.agendadaPara === amanha).sort((a, b) => ordemTurno(a) - ordemTurno(b));
      if (am.length) {
        const lista = am.map((o) => { const t = turnoFala(o); return primeiroNome(nomeDe(o)) + (t ? ' (' + t + ')' : ''); }).join(', ');
        const lev = am.map((o) => { const l = levarTxt(o); return l ? primeiroNome(nomeDe(o)) + ': ' + l : ''; }).filter(Boolean).join('; ');
        await mandar('vespera_' + uid + '_' + amanha, { titulo: 'Visitas de amanhã', texto: 'Amanhã: ' + lista + (lev ? '. Levar: ' + lev : ''), tela: 'ordens', tag: 'vespera-' + amanha }, 12 * 3600);
      }
    }
    // 3. às 7h: o resumo do dia (o Administrador recebe o de todos); sem nada, não manda
    if (quer('manha') && agora.min >= 7 * 60 && agora.min < 10 * 60) {
      const nomes = [semAcento(u.apelido)].filter(Boolean);
      const meus = admin ? produtores : produtores.filter((p) => doTecnico(p, uid, nomes, ultimaPorProd));
      const ids = new Set(meus.map((p) => p.id));
      const visitas = ordens.filter((o) => (o.status === 'agendada' || o.status === 'andamento') && o.agendadaPara === hoje && (admin || o.tecnicoId === uid)).length;
      const revisoes = meus.filter((p) => p.proximaRevisao && p.proximaRevisao >= hoje && p.proximaRevisao <= fimSemana).length;
      const chamados = ordens.filter((o) => o.status === 'aberta' && !o.agendadaPara && (admin || o.tecnicoId === uid || ids.has(o.produtorId))).length;
      const partes = [];
      if (visitas) partes.push(plural(visitas, 'visita', 'visitas'));
      if (revisoes) partes.push(plural(revisoes, 'revisão vencendo esta semana', 'revisões vencendo esta semana'));
      if (chamados) partes.push(plural(chamados, 'chamado sem resposta', 'chamados sem resposta'));
      if (partes.length) await mandar('manha_' + uid + '_' + hoje, { titulo: admin ? 'Resumo do dia (todos)' : 'Resumo do dia', texto: 'Hoje: ' + partes.join(' · '), tela: 'hoje', tag: 'manha-' + hoje }, 6 * 3600);
    }
  }
  return { hoje, agora: Math.floor(agora.min / 60) + 'h' + String(agora.min % 60).padStart(2, '0'), inscritos: uids.length, enviados: enviados.length, chaves: enviados, ...vapidSituacao() };
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
  // só para quem quer o aviso de chamado novo (Mais → Avisos no celular)
  const prefs = {}, querem = [];
  for (const s of inscricoes) {
    const uid = s.path.split('/')[1];
    if (!(uid in prefs)) prefs[uid] = (await lerDoc('avisos-tecnicos/' + uid + '/prefs/avisos')) || {};
    if (prefs[uid].chamados !== false) querem.push(s);
  }
  const n = await enviar(querem, { titulo: 'Novo chamado · ' + numOS(os.numero), texto, tela: 'chamado:' + pid + ':' + osId, tag: 'chamado-' + osId });
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
    if (corpo.modo === 'lembretes' || corpo.modo === 'diario') {
      const veio = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      if (!(await segredoOk(veio))) return resposta(401, { erro: 'segredo errado' });
      return resposta(200, corpo.modo === 'lembretes' ? await lembretes() : await diario());
    }
    return resposta(400, { erro: 'modo deve ser "lembretes", "chamado" ou "diario"' });
  } catch (e) {
    console.error(e);
    return resposta(500, { erro: String(e && e.message ? e.message : e) });
  }
});
