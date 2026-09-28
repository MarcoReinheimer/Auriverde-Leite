/*
 * Auriverde · versão independente (GitHub Pages)
 * ------------------------------------------------
 * O app foi feito para rodar dentro do Claude, que fornece banco de dados,
 * identificação da conta e downloads. Este arquivo cria um "window.claude"
 * equivalente que roda 100% no próprio aparelho:
 *   - db        → banco guardado no aparelho (IndexedDB), funciona sem internet
 *   - user      → você, com o nome digitado na primeira vez, como Administrador
 *   - downloads → baixa o arquivo direto pelo navegador
 *   - mcp (Google Agenda), assets e o resto → indisponíveis (o app esconde)
 * IMPORTANTE: os dados ficam SÓ neste aparelho. Não são compartilhados com
 * colegas. Para dados compartilhados, o próximo passo é o banco no Supabase.
 */
(function () {
  'use strict';

  // ---------- utilidades ----------
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
  const erro = (code, message) => { const e = new Error(message || code); e.code = code; return e; };

  // ---------- armazenamento no aparelho (IndexedDB) ----------
  const NOME_BANCO = 'auriverde-local';
  const LOJA = 'docs';
  let idb = null;
  const mem = new Map();          // caminho do documento -> dados
  let carregado = null;

  function abrirIDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(NOME_BANCO, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(LOJA); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  function carregar() {
    if (carregado) return carregado;
    carregado = (async () => {
      idb = await abrirIDB();
      if (!idb) return;
      await new Promise((resolve) => {
        try {
          const tx = idb.transaction(LOJA, 'readonly');
          const req = tx.objectStore(LOJA).openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (c) { mem.set(c.key, c.value); c.continue(); } else resolve();
          };
          req.onerror = () => resolve();
        } catch (e) { resolve(); }
      });
    })();
    return carregado;
  }
  function persistir(caminho, dados) {
    if (!idb) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        const tx = idb.transaction(LOJA, 'readwrite');
        const loja = tx.objectStore(LOJA);
        if (dados === undefined) loja.delete(caminho); else loja.put(dados, caminho);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(erro('quota_exceeded', 'Sem espaço no aparelho'));
        tx.onabort = () => reject(erro('quota_exceeded', 'Sem espaço no aparelho'));
      } catch (e) { reject(erro('unavailable')); }
    });
  }

  // ---------- consultas e assinaturas ----------
  const assinaturas = new Set();  // {colecao, consulta, fn}
  function docSnap(caminho) {
    const existe = mem.has(caminho);
    return { id: idDe(caminho), ref: refDoc(caminho), exists: existe, data: () => (existe ? clonar(mem.get(caminho)) : undefined) };
  }
  function consultar(colecao, q) {
    let docs = [];
    for (const caminho of mem.keys()) if (colecaoDe(caminho) === colecao) docs.push(docSnap(caminho));
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
  function avisarMudanca(colecao) {
    assinaturas.forEach((s) => {
      if (s.colecao === colecao) setTimeout(() => { if (assinaturas.has(s)) { try { s.fn(consultar(s.colecao, s.consulta)); } catch (e) { console.error(e); } } }, 0);
      if (s.caminhoDoc && colecaoDe(s.caminhoDoc) === colecao) setTimeout(() => { if (assinaturas.has(s)) { try { s.fn(docSnap(s.caminhoDoc)); } catch (e) { console.error(e); } } }, 0);
    });
  }

  function refDoc(caminho) {
    return {
      id: idDe(caminho),
      path: caminho,
      async get() { await carregar(); return docSnap(caminho); },
      async set(dados, opts) {
        await carregar();
        const novo = opts && opts.merge && mem.has(caminho) ? mesclar(clonar(mem.get(caminho)), dados || {}) : clonar(dados || {});
        mem.set(caminho, novo);
        avisarMudanca(colecaoDe(caminho));
        await persistir(caminho, novo);
      },
      async update(dados) {
        await carregar();
        if (!mem.has(caminho)) throw erro('not_found', 'Documento não existe');
        const novo = mesclar(clonar(mem.get(caminho)), dados || {});
        mem.set(caminho, novo);
        avisarMudanca(colecaoDe(caminho));
        await persistir(caminho, novo);
      },
      async delete() {
        await carregar();
        mem.delete(caminho);
        avisarMudanca(colecaoDe(caminho));
        await persistir(caminho, undefined);
      },
      collection(sub) { return refColecao(caminho + '/' + sub); },
      onSnapshot(fn, fnErro) {
        const s = { caminhoDoc: caminho, fn };
        assinaturas.add(s);
        carregar().then(() => { if (assinaturas.has(s)) fn(docSnap(caminho)); }).catch((e) => fnErro && fnErro(e));
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
      async get() { await carregar(); return consultar(colecao, q); },
      onSnapshot(fn, fnErro) {
        const s = { colecao, consulta: q, fn };
        assinaturas.add(s);
        carregar().then(() => { if (assinaturas.has(s)) fn(consultar(colecao, q)); }).catch((e) => fnErro && fnErro(e));
        return () => assinaturas.delete(s);
      },
    };
  }
  const db = Object.freeze({
    doc: (caminho) => refDoc(caminho),
    collection: (colecao) => refColecao(colecao),
    async acquire() { return { release() {} }; },
  });

  // ---------- você (identificação local) ----------
  const CHAVE_EU = 'auriverde_local_eu';
  function eu() {
    let e = null;
    try { e = JSON.parse(localStorage.getItem(CHAVE_EU) || 'null'); } catch (x) {}
    if (!e || !e.id) {
      let nome = '';
      try { nome = (window.prompt('Bem-vindo(a)! Qual é o seu nome?', '') || '').trim(); } catch (x) {}
      e = { id: 'local-' + novoId(), name: nome || 'Administrador' };
      try { localStorage.setItem(CHAVE_EU, JSON.stringify(e)); } catch (x) {}
    }
    return e;
  }
  const user = Object.freeze({
    async me() { const e = eu(); return { id: e.id, name: e.name, guest: false }; },
    async id() { return eu().id; },
    async isOwner() { return true; },
    async canEdit() { return true; },
    async can() { return true; },
    async profiles(ids) {
      const e = eu(), out = {};
      (ids || []).forEach((id) => { out[id] = { id, name: id === e.id ? e.name : '' }; });
      return out;
    },
    async search() { const e = eu(); return [{ id: e.id, name: e.name }]; },
  });

  // ---------- downloads ----------
  const downloads = Object.freeze({
    async save({ filename, data }) {
      if (!filename || data == null) throw erro('bad_request');
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: 'saved' };
    },
  });

  const permissions = Object.freeze({
    async state(n) { return n ? 'granted' : {}; },
    async request() { return {}; },
  });

  const capacidades = { db, user, downloads, permissions };
  window.claude = Object.freeze({
    async use(nome) {
      if (nome === 'db') await carregar();
      return capacidades[nome] || null;
    },
  });

  // ---------- app instalável e offline ----------
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  // pede ao navegador para não apagar os dados do app quando faltar espaço
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
})();
