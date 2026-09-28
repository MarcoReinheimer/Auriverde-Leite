# Auriverde — app de manutenção, produtores e qualidade do leite

Versão independente do app Auriverde, para rodar no GitHub Pages e ser instalada no celular como aplicativo.

## Como funciona esta versão
- Os dados ficam guardados **no próprio aparelho** (funciona sem internet).
- Quem abre o app pela primeira vez digita o nome e entra como **Administrador**.
- **Os dados não são compartilhados entre aparelhos.** Use o **Backup completo** (Administração) com frequência.
- Google Agenda não funciona nesta versão (o botão fica escondido).

## Arquivos
- `index.html` — o app
- `claude-local.js` — substitui os recursos do Claude (banco no aparelho, identificação e downloads)
- `sw.js` — permite abrir sem internet
- `manifest.webmanifest` e `icon-*.png` — ícone e instalação na tela inicial

## Próximo passo
Trocar o banco do aparelho por um banco na nuvem (Supabase), com login para técnicos, veterinários e produtores, para todos verem os mesmos dados.
