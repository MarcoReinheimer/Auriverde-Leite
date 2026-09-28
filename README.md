# Auriverde — app de manutenção, produtores e qualidade do leite

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
| `index.html` | o app |
| `config.js` | **endereço e chave do seu Supabase** (preencher) |
| `supabase.sql` | cria o banco e as regras de acesso (rodar uma vez no Supabase) |
| `claude-supabase.js` | liga o app ao Supabase (login, banco, tempo real) |
| `supabase.js` | biblioteca oficial do Supabase |
| `claude-local.js` | modo "só neste aparelho", usado se o `config.js` estiver vazio |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | instalação e uso sem internet |

## Configuração (uma vez)
1. Supabase → **SQL Editor** → **New query**: cole o `supabase.sql`, troque `SEU_EMAIL_AQUI` pelo e-mail do dono e clique **Run**.
2. Supabase → **Authentication → Sign In / Providers → Email**: desligue **Confirm email** (opcional, mas evita o limite de e-mails do plano grátis).
3. Supabase → **Authentication → URL Configuration**: em **Site URL** coloque o endereço do app no GitHub Pages.
4. Supabase → **Project Settings → API**: copie **Project URL** e **Publishable (anon) key** para o `config.js`.
5. Suba todos os arquivos no GitHub e ative o GitHub Pages.
6. Abra o app, **crie a conta com o e-mail do dono** — ela entra direto como Administrador.

## Nunca coloque no config.js
A chave **service_role / secret** nem a senha do banco.
