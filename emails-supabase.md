# E-mails do login em português

O app usa dois e-mails do Supabase: **confirmação de cadastro** e **troca de senha**.
Por padrão eles saem em inglês. Para deixar em português, com o nome e as cores do Ordenha360:
(se você já tinha colado a versão antiga, com o nome Auriverde, cole de novo estas)

1. Supabase → **Authentication → Emails** (modelos de e-mail).
2. Abra **Confirm signup**: troque o **Subject** e o corpo da mensagem pelos textos abaixo e clique em **Save**.
3. Faça o mesmo em **Reset password**.

Os outros modelos (Magic link, Invite user, Change email, Reauthentication) o app não usa.

No plano grátis o remetente continua "Supabase Auth". Para o e-mail sair com o nome Ordenha360
é preciso ligar um servidor de e-mail próprio (Authentication → Emails → SMTP).

## Confirm signup (confirmação de cadastro)

Só chega se **Confirm email** estiver ligado em Authentication → Sign In / Providers → Email.

Assunto:

```
Confirme seu cadastro no app Ordenha360
```

Corpo:

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px 16px;color:#14222C">
  <img src="https://marcoreinheimer.github.io/Auriverde-Leite/img/logo.png" alt="Ordenha360" height="40" style="display:block;height:40px;width:auto;margin:0 0 24px">
  <h2 style="font-size:20px;margin:0 0 12px">Confirme seu cadastro</h2>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">{{ if .Data.nome }}Olá, {{ .Data.nome }}!{{ else }}Olá!{{ end }} Para terminar seu cadastro no app Ordenha360, confirme seu e-mail:</p>
  <p style="margin:0 0 24px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#157A6E;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px">Confirmar meu e-mail</a></p>
  <p style="font-size:13px;line-height:1.5;color:#566673;margin:0">Depois de confirmar, o administrador libera o seu acesso no app. Se você não pediu este cadastro, é só ignorar este e-mail.</p>
</div>
```

## Reset password (troca de senha)

Assunto:

```
Troque sua senha do app Ordenha360
```

Corpo:

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px 16px;color:#14222C">
  <img src="https://marcoreinheimer.github.io/Auriverde-Leite/img/logo.png" alt="Ordenha360" height="40" style="display:block;height:40px;width:auto;margin:0 0 24px">
  <h2 style="font-size:20px;margin:0 0 12px">Troque sua senha</h2>
  <p style="font-size:15px;line-height:1.5;margin:0 0 20px">{{ if .Data.nome }}Olá, {{ .Data.nome }}!{{ else }}Olá!{{ end }} Recebemos um pedido para trocar a senha da conta {{ .Email }} no app Ordenha360.</p>
  <p style="margin:0 0 24px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#157A6E;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px">Criar uma senha nova</a></p>
  <p style="font-size:13px;line-height:1.5;color:#566673;margin:0">O link vale por pouco tempo e só funciona uma vez. Se você não pediu a troca, ignore este e-mail: sua senha continua a mesma.</p>
</div>
```

Se um dia o endereço do app mudar, troque também o endereço do logo (`img src=...`) nos dois e-mails.
