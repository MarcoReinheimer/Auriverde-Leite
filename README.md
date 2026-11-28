# Ordenha360 — app de manutenção de ordenha, resfriador, conforto animal e vendas

App instalável (PWA) hospedado no GitHub Pages, com banco compartilhado no Supabase.

## Como funciona
- Cada pessoa entra com **e-mail e senha**.
- Quem cria conta fica **aguardando liberação**; o Administrador aprova dentro do app (Administração → Pedidos de acesso).
- Todos os aprovados veem **os mesmos dados**, que atualizam sozinhos na tela de todo mundo.
- Sem internet, o app abre e guarda o que for lançado; envia quando a conexão voltar.
- As regras de acesso ficam **no banco** (`supabase.sql`): quem não foi aprovado não consegue ler nada, mesmo tentando burlar o app.

## Arquivos
| Arquivo | Para que serve |
|---|---|
| `index.html` | o app (as telas); carrega o CSS e o JS abaixo |
| `css/app.css`, `js/app.js` | o visual e a programação do app: **é aqui que se mexe no código** |
| `css/app.min.css`, `js/app.min.js` | as mesmas coisas compactadas (mais leves no 3G): é o que o app usa; geradas pelo `npm run build` |
| `package.json`, `build.mjs` | o comando `npm run build` (ver "Mudou o código?" abaixo) |
| `config.js` | **endereço e chave do seu Supabase** (preencher) |
| `supabase.sql` | cria o banco e as regras de acesso (rodar uma vez no Supabase) |
| `claude-supabase.js` | liga o app ao Supabase (login, banco, tempo real) |
| `supabase.js` | biblioteca oficial do Supabase |
| `claude-local.js` | modo "só neste aparelho", usado se o `config.js` estiver vazio |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | instalação e uso sem internet |
| `img/` | logo do topo e ícone da aba do navegador |
| `fontes/` | fonte IBM Plex Sans da tela (`.woff2`) e do PDF (`.ttf`, baixada só ao gerar PDF) |
| `.github/workflows/manter-supabase.yml` | tarefa diária que não deixa o Supabase pausar (ver abaixo) |
| `emails-supabase.md` | e-mails do login em português (confirmação de cadastro e troca de senha), para colar no Supabase |
| `supabase/functions/enviar-avisos/` | função do Supabase que manda os avisos no celular (ver "Avisos no celular") |

Ao trocar um arquivo de `img/` ou `fontes/`, aumente a `VERSAO` no `sw.js`: esses arquivos ficam guardados no celular e só são baixados de novo quando a versão muda.

## Mudou o código? Gere as versões compactadas
O app usa `css/app.min.css` e `js/app.min.js`. Depois de mexer em `css/app.css` ou `js/app.js`:
1. **Só na primeira vez**, no computador: instale o [Node.js](https://nodejs.org) e, na pasta do app, rode `npm install` (baixa o esbuild, que compacta os arquivos).
2. Troque a `APP_VERSAO` no começo do `js/app.js` (ex.: `2026.11.17.12` → `2026.11.17.13`).
3. Rode `npm run build`. Ele gera as duas `.min` e coloca a versão nova no `?v=` dos links do `index.html`, para o celular não misturar arquivo novo com velho.
4. Suba tudo no GitHub (inclusive as `.min` e o `index.html`).

Se o `npm install` avisar de "install-scripts" do esbuild, pode ignorar: o build funciona assim mesmo.
A pasta `node_modules/` que o `npm install` cria fica só no computador (não vai para o GitHub).

## Configuração (uma vez)
1. Supabase → **SQL Editor** → **New query**: cole o `supabase.sql`, troque `SEU_EMAIL_AQUI` pelo e-mail do dono e clique **Run**.
2. Supabase → **Authentication → Sign In / Providers → Email**: desligue **Confirm email** (opcional, mas evita o limite de e-mails do plano grátis).
3. Supabase → **Authentication → URL Configuration**: em **Site URL** coloque o endereço do app no GitHub Pages.
4. Supabase → **Project Settings → API**: copie **Project URL** e **Publishable (anon) key** para o `config.js`.
5. Suba todos os arquivos no GitHub e ative o GitHub Pages.
6. Abra o app, **crie a conta com o e-mail do dono** — ela entra direto como Administrador.
7. Supabase → **Authentication → Emails**: cole os e-mails em português do arquivo `emails-supabase.md`.

## Supabase sem pausar
No plano grátis, o Supabase pausa o projeto quando o banco fica uma semana sem uso, e o app passa a dar "Load failed".
Para isso não acontecer, a tarefa **Manter o Supabase acordado** (aba **Actions** do GitHub) faz todo dia, às 07:17,
uma consulta mínima ao banco com a chave publicável do `config.js`. Ela não lê nem grava dados do app.
- Se a tarefa falhar, o GitHub manda e-mail. Entre no Supabase e, se o projeto estiver pausado, clique em **Restore**.
- O Supabase também avisa por e-mail uma semana antes de pausar.
- Para rodar na hora: Actions → Manter o Supabase acordado → **Run workflow**.

## Tabelas de preço dos fornecedores
Ficam no Supabase, em `tabelas-preco/<fornecedor>` (`ordemax`, `mx`, `lero`, `feilfer` e `kit`): só quem tem acesso liberado lê.
**Não coloque as tabelas neste repositório nem no site:** tudo aqui é público. A pasta `tabelas/` está no `.gitignore`.

## Avisos no celular (Web Push)
> **Ligado para os técnicos e o Administrador** (28/11/2026): Mais → Avisos no celular. A parte do produtor continua
> escondida (`AVISOS_PRODUTOR = false` em `js/app.js`), porque os produtores ainda não entram no app.

O app já tem os botões para ligar os avisos; quem manda os avisos é a função **enviar-avisos** do Supabase
(`supabase/functions/enviar-avisos/index.ts`). Enquanto ela não estiver publicada e a chave pública não estiver
no `config.js`, os botões mostram "Os avisos ainda não foram configurados".

**O que chega no celular** (cada pessoa liga ou desliga cada um em Mais → Avisos no celular; vale para todos os aparelhos dela,
em `avisos-tecnicos/<id>/prefs/avisos` = `{ hora, vespera, manha, chamados }`)
- **1 hora antes** de cada visita com hora marcada: "Daqui 1 hora: Valdir Schneider · Resfriador" (o toque abre a OS).
- **Véspera, às 19h**, para quem tem visita no dia seguinte: "Amanhã: Valdir (manhã), Adriana (14h), Márcia (tarde)", com o que levar.
- **Às 7h, o resumo do dia**: "Hoje: 3 visitas · 2 revisões vencendo esta semana · 1 chamado sem resposta" (sem nada, não manda).
  Cada técnico recebe só o que é dele; o Administrador recebe o resumo de todos.
- **Chamado novo** aberto pelo produtor (o toque abre o chamado).
- Nunca vai custo, preço ou comissão. O que foi enviado fica em `avisos-enviados/` (o mesmo aviso não sai duas vezes).
  Celular que desinstalou o app sai sozinho da lista.
- **iPhone:** só funciona com o app instalado na Tela de Início (Compartilhar → Adicionar à Tela de Início) e iOS 16.4 ou mais novo.

**Passo a passo (uma vez, no computador, na pasta do app)**
1. Gere as chaves VAPID:
   ```
   npx web-push generate-vapid-keys
   ```
   Guarde as duas. A **Public Key** vai no `config.js`, em `vapidPublicKey`. A **Private Key** nunca vai para o GitHub nem para o `config.js`.
2. Entre no Supabase pelo terminal e ligue a pasta ao projeto (o `<ref>` é o começo do endereço do projeto: `https://<ref>.supabase.co`):
   ```
   npx supabase login
   npx supabase link --project-ref <ref>
   ```
3. Guarde os segredos da função (troque os valores; o `AVISOS_SEGREDO` é uma senha longa que você inventa):
   ```
   npx supabase secrets set VAPID_PUBLIC_KEY="<public key>" VAPID_PRIVATE_KEY="<private key>" VAPID_SUBJECT="mailto:<seu e-mail>" AVISOS_SEGREDO="<senha longa>"
   ```
   O `SUPABASE_URL`, a `SUPABASE_ANON_KEY` e a `SUPABASE_SERVICE_ROLE_KEY` o Supabase já entrega para a função: não precisa pôr.
4. Publique a função:
   ```
   npx supabase functions deploy enviar-avisos --no-verify-jwt
   ```
   (`--no-verify-jwt` porque o agendador entra com o `AVISOS_SEGREDO`; no aviso de chamado a própria função confere o login de quem pediu.)
5. Teste na mão (deve responder com quantas pessoas estão inscritas e quantos avisos saíram):
   ```
   curl -X POST "https://<ref>.supabase.co/functions/v1/enviar-avisos" -H "Authorization: Bearer <senha longa>" -H "Content-Type: application/json" -d "{\"modo\":\"lembretes\"}"
   ```
6. Guarde a mesma senha no **Vault** (Supabase → Project Settings → Vault → Add new secret), com o nome `avisos_segredo`.
   Agende o modo "lembretes" a cada 15 minutos (a própria função usa o horário de Brasília). No **SQL Editor**:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net with schema extensions;
   select cron.schedule('enviar-avisos-lembretes', '*/15 * * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/enviar-avisos',
       headers := jsonb_build_object('Content-Type', 'application/json',
         'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'avisos_segredo'), '')),
       body := '{"modo":"lembretes"}'::jsonb,
       timeout_milliseconds := 60000
     ) as request_id;
   $$);
   ```
   A senha é lida do Vault na hora: ela não fica escrita no comando. Para conferir: `select * from cron.job;` ·
   para ver a última resposta: `select status_code, content from net._http_response order by id desc limit 1;` ·
   para cancelar: `select cron.unschedule('enviar-avisos-lembretes');`
7. Coloque a Public Key no `config.js` (`vapidPublicKey: '...'`) e suba no GitHub.

## Agenda no celular (calendário)
Em **Mais → Agenda no celular**, cada técnico assina a própria agenda: as OS em aberto com data marcada aparecem no
calendário do iPhone ou no Google Agenda, com aviso 1 hora antes (dia inteiro: às 7h) e na véspera às 19h.
Quem monta o calendário é a função **agenda** do Supabase (`supabase/functions/agenda/index.ts`).

- O link leva um código de 32 letras e números (o "token"), guardado em `agenda-tokens/<token>` = `{ uid, criadoEm }`.
  O calendário do celular não faz login: a função confere o token sozinha. Token errado, ou pessoa bloqueada → 404.
- Vai para o calendário: dia, período ou hora, nome e linha/cidade do produtor, motivo, telefone do produtor, nº da OS
  e o que levar (a lista "Levar" da OS e os componentes a trocar, só o nome e a quantidade). **Nunca** custo, preço ou comissão.
- Horários: hora marcada → 1h30; manhã → 8h às 12h; tarde → 13h30 às 17h30; sem horário → dia inteiro.
- "Trocar link" apaga o token antigo e cria outro (o link velho para de funcionar).
- Qualquer pessoa com acesso liberado no app consegue ler a coleção `agenda-tokens` (como lê as OS). Por isso o link
  só mostra o que essa pessoa já vê no app.

**Publicar a função (uma vez, no computador, na pasta do app).** Não precisa de segredo novo: o `SUPABASE_URL` e a
`SUPABASE_SERVICE_ROLE_KEY` o Supabase já entrega para a função.
1. Entre no Supabase e ligue a pasta ao projeto (o `<ref>` é o começo do endereço: `https://<ref>.supabase.co`):
   ```
   npx supabase login
   npx supabase link --project-ref <ref>
   ```
2. Publique (`--no-verify-jwt` porque o calendário não manda login; a função confere o token):
   ```
   npx supabase functions deploy agenda --no-verify-jwt
   ```
3. Teste: um token qualquer tem que dar 404; depois, abra o link de **Mais → Agenda no celular** no navegador e veja o `BEGIN:VCALENDAR`.
   ```
   curl -i "https://<ref>.supabase.co/functions/v1/agenda?t=00000000000000000000000000000000"
   ```

## Nunca coloque no config.js
A chave **service_role / secret** nem a senha do banco. Nem a chave **privada** VAPID dos avisos (só a pública vai lá).
