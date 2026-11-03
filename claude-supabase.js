/*
 * Auriverde · banco compartilhado (Supabase)
 * ------------------------------------------
 * O app foi escrito para rodar dentro do Claude, que fornece banco de dados,
 * identificação e downloads por meio de "window.claude". Este arquivo cria um
 * "window.claude" equivalente usando o Supabase:
 *   - user      → login com e-mail e senha (tela própria antes do app)
 *   - db        → tabela "docs" do Supabase, com atualização em tempo real
 *   - downloads → baixa o arquivo direto pelo navegador
 * As regras de quem pode ver e gravar o quê ficam no banco (arquivo supabase.sql).
 * Requer: config.js (endereço e chave) e supabase.js (biblioteca oficial).
 */
(function () {
  'use strict';

  const CFG = window.AURIVERDE_CONFIG || {};
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'auriverde-sessao' },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  window.auriverdeSupabase = sb;

  // ================= utilidades =================
  const clonar = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const ehObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function mesclar(alvo, fonte) {
    for (const k in fonte) {
      const v = fonte[k];
      if (ehObj(v) && ehObj(alvo[k])) mesclar(alvo[k], v);
      else alvo[k] = clonar(v);
    }
    return alvo;
  }
  const colecaoDe = (p) => p.split('/').slice(0, -1).join('/');
  const idDe = (p) => p.split('/').pop();
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Traduz os erros do Supabase para os códigos que o app já entende:
  //  - sem internet / servidor fora → "unavailable" (o registro fica na fila e vai depois)
  //  - sem permissão / registro que não existe → "invalid_argument" (o app descarta e avisa)
  function traduzirErro(e) {
    const msg = String((e && (e.message || e.error_description)) || e || '');
    const code = e && e.code;
    let c = 'unavailable';
    if (code === '42501' || code === 'P0002' || code === '23505' || code === '22P02' || code === '23502' || /row-level security|permission denied/i.test(msg)) c = 'invalid_argument';
    if (code === '54000' || /payload too large|request entity too large|413/i.test(msg)) c = 'quota_exceeded';
    const err = new Error(msg || c);
    err.code = c;
    err.original = e;
    return err;
  }
  async function exec(promessa) {
    let r;
    try { r = await promessa; } catch (e) { throw traduzirErro(e); }
    if (r && r.error) throw traduzirErro(r.error);
    return r ? r.data : null;
  }

  // ================= login =================
  let sessao = null;
  let resolverSessao;
  const sessaoPronta = new Promise((res) => { resolverSessao = res; });
  let emRecuperacao = /type=recovery/.test(location.hash);

  function aoTerSessao(s) {
    if (sessao) { sessao = s; return; }
    sessao = s;
    // fora do aviso do login: chamadas ao Supabase dentro dele podem travar
    setTimeout(() => guardarPerfil(s), 0);
    esconderLogin();
    resolverSessao(s);
  }
  // Sem internet, o Supabase pode não conseguir renovar o login. Nesse caso usamos
  // o login guardado no aparelho para abrir o app; o que for lançado vai para a fila.
  function sessaoGuardada() {
    try {
      const bruto = JSON.parse(localStorage.getItem('auriverde-sessao') || 'null');
      const s = bruto && (bruto.currentSession || bruto);
      return s && s.user && s.user.id ? s : null;
    } catch (e) { return null; }
  }
  async function guardarPerfil(s) {
    try {
      const u = s.user;
      const nome = (u.user_metadata && u.user_metadata.nome) || (u.email || '').split('@')[0];
      await sb.from('perfis').upsert({ id: u.id, nome, email: u.email }, { onConflict: 'id' });
    } catch (e) {}
  }

  sb.auth.onAuthStateChange((evento, s) => {
    if (evento === 'PASSWORD_RECOVERY') { emRecuperacao = true; mostrarLogin('nova-senha'); return; }
    if (evento === 'SIGNED_OUT') { location.reload(); return; }
    if (s && !sessao && !emRecuperacao) aoTerSessao(s);
    if (s && sessao) sessao = s;
  });

  async function iniciarLogin() {
    let s = null;
    try { const { data } = await sb.auth.getSession(); s = data && data.session; } catch (e) {}
    if (emRecuperacao) { mostrarLogin('nova-senha'); return; }
    if (!s && !navigator.onLine) s = sessaoGuardada();
    if (s) aoTerSessao(s);
    else mostrarLogin('entrar');
  }

  // ---------- tela de login ----------
  // usa as cores e medidas do app (tokens do index.html), então segue o modo claro/escuro escolhido;
  // o valor depois da vírgula em cada var() só vale se o estilo do app não tiver carregado
  const CSS = `
  #av-login{position:fixed;inset:0;z-index:99999;overflow-y:auto;padding-bottom:32px;background:var(--bg,#F3F5F2);color:var(--ink,#16221B);font-family:var(--fonte,'IBM Plex Sans',system-ui,-apple-system,sans-serif)}
  #av-login[hidden]{display:none}
  #av-login .av-topo{display:flex;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 10px) 16px 10px;background:#0F6B3F}
  #av-login .av-logo{display:inline-flex;align-items:center;padding:4px 7px;border-radius:8px;background:#fff}
  #av-login .av-logo img{display:block;height:20px}
  #av-login .av-box{box-sizing:border-box;width:100%;max-width:400px;margin:0 auto;padding:24px 16px 0}
  #av-login h1{font-size:22px;font-weight:700;line-height:1.2;margin:0 0 4px}
  #av-login .av-sub{color:var(--ink-soft,#5A6A60);font-size:14px;margin:0 0 18px}
  #av-login .av-card{background:var(--surface,#fff);border:1px solid var(--line,#E1E7E2);border-radius:var(--raio,12px);padding:18px var(--pad,14px)}
  #av-login h2{font-size:17px;font-weight:600;margin:0 0 14px}
  #av-login label{display:block;font-size:13px;font-weight:600;color:var(--ink-soft,#5A6A60);margin:0 0 6px}
  #av-login input{box-sizing:border-box;width:100%;min-height:50px;margin-bottom:14px;padding:12px 14px;border:1.5px solid var(--line,#E1E7E2);border-radius:12px;background:var(--bg,#F3F5F2);color:var(--ink,#16221B);font:inherit;font-size:16px}
  #av-login input:focus{outline:none;border-color:var(--accent,#007A3D)}
  #av-login .av-btn{width:100%;min-height:50px;padding:12px;border:none;border-radius:12px;background:var(--accent,#007A3D);color:var(--accent-ink,#fff);font:inherit;font-size:16px;font-weight:600;cursor:pointer}
  #av-login .av-btn[disabled]{opacity:.6}
  #av-login .av-links{display:flex;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap}
  #av-login .av-link{min-height:40px;padding:8px 0;border:none;background:none;color:var(--accent-txt,#007A3D);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
  #av-login .av-msg{font-size:14px;line-height:1.45;border-radius:10px;padding:10px 12px;margin-bottom:14px}
  #av-login .av-msg.erro{background:color-mix(in srgb,var(--tax,#B5412B) 12%,var(--surface,#fff));color:var(--tax,#B5412B)}
  #av-login .av-msg.ok{background:var(--accent-suave,#E3F1E9);color:var(--accent-txt,#007A3D)}
  #av-login .av-rodape{text-align:center;color:var(--ink-soft,#5A6A60);font-size:12.5px;margin-top:16px}
  #av-sair{position:fixed;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:60;padding:9px 14px;border:1px solid var(--line,#E1E7E2);border-radius:999px;background:var(--surface,#fff);color:var(--ink-soft,#5A6A60);font:600 13px var(--fonte,'IBM Plex Sans',system-ui,sans-serif);cursor:pointer}
  body:not([data-view="entrada"]) #av-sair{display:none}
  `;
  let caixa = null;
  function montar() {
    if (caixa) return caixa;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    caixa = document.createElement('div');
    caixa.id = 'av-login';
    caixa.hidden = true;
    caixa.innerHTML =
      '<div class="av-topo"><span class="av-logo"><img alt="Auriverde" src="img/logo-auriverde.png"></span></div>' +
      '<div class="av-box">' +
      '<h1>Boas-vindas à Auriverde</h1><p class="av-sub">Manutenção de ordenha, resfriador e conforto animal</p>' +
      '<div class="av-card" id="av-card"></div>' +
      '<div class="av-rodape">Seus dados ficam protegidos: cada pessoa só vê o que tem permissão.</div>' +
      '</div>';
    document.body.appendChild(caixa);
    const sair = document.createElement('button');
    sair.id = 'av-sair';
    sair.type = 'button';
    sair.textContent = 'Sair da conta';
    sair.addEventListener('click', async () => { try { await sb.auth.signOut(); } catch (e) {} location.reload(); });
    document.body.appendChild(sair);
    return caixa;
  }
  function esconderLogin() { if (caixa) caixa.hidden = true; }

  const TELAS = {
    'entrar': () => `
      <h2>Entrar</h2><div id="av-m"></div>
      <label for="av-email">E-mail</label><input id="av-email" type="email" autocomplete="email" inputmode="email">
      <label for="av-senha">Senha</label><input id="av-senha" type="password" autocomplete="current-password">
      <button class="av-btn" id="av-ok" type="button">Entrar</button>
      <div class="av-links"><button class="av-link" data-ir="criar" type="button">Criar conta</button><button class="av-link" data-ir="esqueci" type="button">Esqueci a senha</button></div>`,
    'criar': () => `
      <h2>Criar conta</h2><div id="av-m"></div>
      <label for="av-nome">Seu nome</label><input id="av-nome" type="text" autocomplete="name">
      <label for="av-email">E-mail</label><input id="av-email" type="email" autocomplete="email" inputmode="email">
      <label for="av-senha">Senha (mínimo 6 caracteres)</label><input id="av-senha" type="password" autocomplete="new-password">
      <button class="av-btn" id="av-ok" type="button">Criar conta</button>
      <div class="av-links"><button class="av-link" data-ir="entrar" type="button">Já tenho conta</button></div>`,
    'esqueci': () => `
      <h2>Esqueci a senha</h2><div id="av-m"></div>
      <label for="av-email">E-mail da sua conta</label><input id="av-email" type="email" autocomplete="email" inputmode="email">
      <button class="av-btn" id="av-ok" type="button">Enviar link para trocar a senha</button>
      <div class="av-links"><button class="av-link" data-ir="entrar" type="button">Voltar</button></div>`,
    'nova-senha': () => `
      <h2>Nova senha</h2><div id="av-m"></div>
      <label for="av-senha">Digite a nova senha</label><input id="av-senha" type="password" autocomplete="new-password">
      <button class="av-btn" id="av-ok" type="button">Salvar nova senha</button>`,
  };
  function msg(texto, tipo) {
    const m = document.getElementById('av-m');
    if (!m) return;
    m.innerHTML = texto ? '<div class="av-msg ' + (tipo || 'erro') + '"></div>' : '';
    if (texto) m.firstChild.textContent = texto;
  }
  const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  function mensagemAmigavel(e) {
    const t = String((e && e.message) || e || '');
    if (/Invalid login credentials/i.test(t)) return 'E-mail ou senha incorretos.';
    if (/Email not confirmed/i.test(t)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (/User already registered/i.test(t)) return 'Já existe uma conta com esse e-mail. Toque em "Já tenho conta".';
    if (/Password should be at least/i.test(t)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/rate limit|too many/i.test(t)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
    if (/Failed to fetch|NetworkError|network/i.test(t)) return 'Sem conexão com a internet. Confira o sinal e tente de novo.';
    if (/valid email|invalid format/i.test(t)) return 'Digite um e-mail válido.';
    return 'Não deu certo: ' + t;
  }
  async function acao(tela) {
    const btn = document.getElementById('av-ok');
    btn.disabled = true;
    msg('');
    try {
      if (tela === 'entrar') {
        const email = val('av-email'), senha = val('av-senha');
        if (!email || !senha) { msg('Preencha e-mail e senha.'); return; }
        const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
        if (error) throw error;
        if (data.session) aoTerSessao(data.session);
      } else if (tela === 'criar') {
        const nome = val('av-nome'), email = val('av-email'), senha = val('av-senha');
        if (!nome || !email || !senha) { msg('Preencha nome, e-mail e senha.'); return; }
        const { data, error } = await sb.auth.signUp({ email, password: senha, options: { data: { nome }, emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (data.session) aoTerSessao(data.session);
        else { mostrarLogin('entrar'); msg('Conta criada! Abra o e-mail que enviamos para confirmar e depois entre aqui.', 'ok'); }
      } else if (tela === 'esqueci') {
        const email = val('av-email');
        if (!email) { msg('Digite o seu e-mail.'); return; }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        msg('Pronto! Se esse e-mail tiver conta, chega um link para trocar a senha em alguns minutos.', 'ok');
      } else if (tela === 'nova-senha') {
        const senha = val('av-senha');
        if (senha.length < 6) { msg('A senha precisa ter pelo menos 6 caracteres.'); return; }
        const { error } = await sb.auth.updateUser({ password: senha });
        if (error) throw error;
        emRecuperacao = false;
        history.replaceState(null, '', location.pathname);
        const { data } = await sb.auth.getSession();
        if (data.session) aoTerSessao(data.session); else mostrarLogin('entrar');
      }
    } catch (e) {
      msg(mensagemAmigavel(e));
    } finally {
      const b = document.getElementById('av-ok');
      if (b) b.disabled = false;
    }
  }
  function mostrarLogin(tela) {
    const pronto = () => {
      montar();
      caixa.hidden = false;
      const card = caixa.querySelector('#av-card');
      card.innerHTML = TELAS[tela]();
      card.querySelector('#av-ok').addEventListener('click', () => acao(tela));
      card.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') acao(tela); }));
      card.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => mostrarLogin(b.dataset.ir)));
    };
    if (document.body) pronto(); else document.addEventListener('DOMContentLoaded', pronto, { once: true });
  }
  // o botão "Sair da conta" também existe com sessão (aparece só na tela de entrada)
  sessaoPronta.then(() => { if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar, { once: true }); });

  // ================= banco =================
  // cache por coleção: colecao -> { docs: Map(path -> dados), carregado: bool }
  const cache = new Map();
  const assinaturas = new Set(); // { colecao, consulta, fn, fnErro } ou { caminhoDoc, fn, fnErro }
  function cacheDe(colecao) {
    if (!cache.has(colecao)) cache.set(colecao, { docs: new Map(), carregado: false });
    return cache.get(colecao);
  }
  function snapDoc(caminho, dados) {
    const existe = dados !== undefined;
    return { id: idDe(caminho), ref: refDoc(caminho), exists: existe, data: () => (existe ? clonar(dados) : undefined) };
  }
  function montarConsulta(colecao, q) {
    const c = cacheDe(colecao);
    let docs = [];
    c.docs.forEach((dados, caminho) => docs.push(snapDoc(caminho, dados)));
    (q.filtros || []).forEach(([campo, op, valor]) => {
      docs = docs.filter((d) => {
        const v = (d.data() || {})[campo];
        switch (op) {
          case '==': return v === valor;
          case '!=': return v !== valor;
          case '<': return v < valor;
          case '<=': return v <= valor;
          case '>': return v > valor;
          case '>=': return v >= valor;
          case 'in': return Array.isArray(valor) && valor.includes(v);
          case 'array-contains': return Array.isArray(v) && v.includes(valor);
          default: return true;
        }
      });
    });
    (q.ordens || []).slice().reverse().forEach(([campo, dir]) => {
      docs.sort((a, b) => {
        const x = (a.data() || {})[campo], y = (b.data() || {})[campo];
        if (x === y) return 0;
        if (x === undefined || x === null) return 1;
        if (y === undefined || y === null) return -1;
        return (x > y ? 1 : -1) * (dir === 'desc' ? -1 : 1);
      });
    });
    if (q.limite) docs = docs.slice(0, q.limite);
    return { docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: false, hasPendingWrites: false }, forEach: (f) => docs.forEach(f) };
  }
  function avisar(colecao) {
    assinaturas.forEach((s) => {
      if (s.colecao === colecao && cacheDe(colecao).carregado) {
        try { s.fn(montarConsulta(colecao, s.consulta)); } catch (e) { console.error(e); }
      }
      if (s.caminhoDoc && colecaoDe(s.caminhoDoc) === colecao) {
        try { s.fn(snapDoc(s.caminhoDoc, cacheDe(colecao).docs.get(s.caminhoDoc))); } catch (e) { console.error(e); }
      }
    });
  }
  const carregando = new Map();
  function carregarColecao(colecao) {
    if (carregando.has(colecao)) return carregando.get(colecao);
    const p = (async () => {
      const pagina = 500;
      const todos = new Map();
      for (let de = 0; ; de += pagina) {
        const linhas = await exec(sb.from('docs').select('path,dados').eq('colecao', colecao).order('path').range(de, de + pagina - 1));
        (linhas || []).forEach((l) => todos.set(l.path, l.dados));
        if (!linhas || linhas.length < pagina) break;
      }
      const c = cacheDe(colecao);
      c.docs = todos;
      c.carregado = true;
      avisar(colecao);
    })().finally(() => carregando.delete(colecao));
    carregando.set(colecao, p);
    return p;
  }
  async function buscarDoc(caminho) {
    const linhas = await exec(sb.from('docs').select('path,dados').eq('path', caminho).limit(1));
    const dados = linhas && linhas[0] ? linhas[0].dados : undefined;
    const c = cacheDe(colecaoDe(caminho));
    if (dados === undefined) c.docs.delete(caminho); else c.docs.set(caminho, dados);
    return dados;
  }
  function aplicarLocal(caminho, dados) {
    const colecao = colecaoDe(caminho);
    const c = cacheDe(colecao);
    if (dados === undefined) c.docs.delete(caminho); else c.docs.set(caminho, dados);
    avisar(colecao);
  }

  // ---------- tempo real ----------
  let canal = null;
  let caiu = false;
  function ligarTempoReal() {
    if (canal) return;
    canal = sb.channel('auriverde-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, async (p) => {
        try {
          if (p.eventType === 'DELETE') {
            const caminho = p.old && p.old.path;
            if (caminho) aplicarLocal(caminho, undefined);
            return;
          }
          const linha = p.new || {};
          if (!linha.path) return;
          if (linha.dados === undefined || linha.dados === null) {
            // registro grande demais para vir pelo tempo real: busca direto
            const dados = await buscarDoc(linha.path);
            avisar(colecaoDe(linha.path));
            return void dados;
          }
          aplicarLocal(linha.path, linha.dados);
        } catch (e) {}
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (caiu) {
            caiu = false;
            // voltou a conexão: recarrega o que está na tela para não perder nada
            const vistas = new Set();
            assinaturas.forEach((s) => { const c = s.colecao || colecaoDe(s.caminhoDoc); if (!vistas.has(c)) { vistas.add(c); carregarColecao(c).catch(() => {}); } });
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          caiu = true;
        }
      });
  }

  function refDoc(caminho) {
    return {
      id: idDe(caminho),
      path: caminho,
      async get() { const dados = await buscarDoc(caminho); return snapDoc(caminho, dados); },
      async set(dados, opts) {
        let novo = clonar(dados || {});
        if (opts && opts.merge) {
          await exec(sb.from('docs').upsert({ path: caminho, dados: {} }, { onConflict: 'path', ignoreDuplicates: true }));
          await exec(sb.rpc('atualizar_doc', { p_path: caminho, p_campos: novo }));
          const atual = cacheDe(colecaoDe(caminho)).docs.get(caminho);
          novo = mesclar(clonar(atual || {}), novo);
        } else {
          await exec(sb.from('docs').upsert({ path: caminho, dados: novo }, { onConflict: 'path' }));
        }
        aplicarLocal(caminho, novo);
      },
      async update(campos) {
        await exec(sb.rpc('atualizar_doc', { p_path: caminho, p_campos: clonar(campos || {}) }));
        const atual = cacheDe(colecaoDe(caminho)).docs.get(caminho);
        if (atual !== undefined) aplicarLocal(caminho, mesclar(clonar(atual), campos || {}));
        else { await buscarDoc(caminho).catch(() => {}); avisar(colecaoDe(caminho)); }
      },
      async delete() {
        await exec(sb.from('docs').delete().eq('path', caminho));
        aplicarLocal(caminho, undefined);
      },
      collection(sub) { return refColecao(caminho + '/' + sub); },
      onSnapshot(fn, fnErro) {
        ligarTempoReal();
        const s = { caminhoDoc: caminho, fn, fnErro };
        assinaturas.add(s);
        buscarDoc(caminho).then((d) => { if (assinaturas.has(s)) fn(snapDoc(caminho, d)); })
          .catch((e) => { assinaturas.delete(s); if (fnErro) fnErro(e); });
        return () => assinaturas.delete(s);
      },
    };
  }
  function refColecao(colecao, consulta) {
    const q = consulta || { filtros: [], ordens: [], limite: 0 };
    return {
      id: idDe(colecao),
      path: colecao,
      doc(id) { return refDoc(colecao + '/' + (id || novoId())); },
      async add(dados) { const r = refDoc(colecao + '/' + novoId()); await r.set(dados); return r; },
      where(campo, op, valor) { return refColecao(colecao, { ...q, filtros: q.filtros.concat([[campo, op, valor]]) }); },
      orderBy(campo, dir) { return refColecao(colecao, { ...q, ordens: q.ordens.concat([[campo, dir || 'asc']]) }); },
      limit(n) { return refColecao(colecao, { ...q, limite: n }); },
      async get() { await carregarColecao(colecao); return montarConsulta(colecao, q); },
      onSnapshot(fn, fnErro) {
        ligarTempoReal();
        const s = { colecao, consulta: q, fn, fnErro };
        assinaturas.add(s);
        const c = cacheDe(colecao);
        if (c.carregado) setTimeout(() => { if (assinaturas.has(s)) fn(montarConsulta(colecao, q)); }, 0);
        carregarColecao(colecao).catch((e) => { if (assinaturas.has(s)) { assinaturas.delete(s); if (fnErro) fnErro(e); } });
        return () => assinaturas.delete(s);
      },
    };
  }
  const db = Object.freeze({
    doc: (caminho) => refDoc(caminho),
    collection: (colecao) => refColecao(colecao),
    async acquire() { return { release() {} }; },
  });

  // ================= usuário =================
  const perfisCache = new Map();
  let donoCache = null;
  function nomeDaSessao() {
    const u = sessao && sessao.user;
    return (u && ((u.user_metadata && u.user_metadata.nome) || (u.email || '').split('@')[0])) || '';
  }
  const user = Object.freeze({
    async me() { const u = sessao.user; return { id: u.id, name: nomeDaSessao(), guest: false }; },
    async id() { return sessao.user.id; },
    async isOwner() {
      if (donoCache !== null) return donoCache;
      try { donoCache = !!(await exec(sb.rpc('eh_dono'))); } catch (e) { return false; }
      return donoCache;
    },
    async canEdit() {
      try { return !!(await exec(sb.rpc('eh_admin'))); } catch (e) { return false; }
    },
    async can(nome) {
      if (nome === 'data.write') { try { return !!(await exec(sb.rpc('eh_ativo'))); } catch (e) { return null; } }
      return null;
    },
    async profiles(ids) {
      const out = {};
      const faltam = (ids || []).filter((id) => UUID.test(String(id)) && !perfisCache.has(id));
      if (faltam.length) {
        try {
          const linhas = await exec(sb.from('perfis').select('id,nome').in('id', faltam));
          (linhas || []).forEach((l) => perfisCache.set(l.id, l.nome || ''));
        } catch (e) {}
      }
      (ids || []).forEach((id) => {
        let nome = perfisCache.get(id) || '';
        if (sessao && id === sessao.user.id && !nome) nome = nomeDaSessao();
        out[id] = { id, name: nome };
      });
      return out;
    },
    async search(texto) {
      try {
        let q = sb.from('perfis').select('id,nome').order('nome').limit(20);
        if (texto) q = q.ilike('nome', '%' + String(texto).replace(/[%_]/g, '') + '%');
        const linhas = await exec(q);
        return (linhas || []).map((l) => { perfisCache.set(l.id, l.nome || ''); return { id: l.id, name: l.nome || '' }; });
      } catch (e) { return []; }
    },
  });

  // ================= downloads =================
  const downloads = Object.freeze({
    async save({ filename, data }) {
      if (!filename || data == null) { const e = new Error('bad_request'); e.code = 'bad_request'; throw e; }
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: 'saved' };
    },
  });
  const permissions = Object.freeze({ async state(n) { return n ? 'granted' : {}; }, async request() { return {}; } });

  // ================= window.claude =================
  const capacidades = { db, user, downloads, permissions };
  window.claude = Object.freeze({
    async use(nome) {
      if (nome === 'db' || nome === 'user') await sessaoPronta;
      return capacidades[nome] || null;
    },
  });

  iniciarLogin();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
