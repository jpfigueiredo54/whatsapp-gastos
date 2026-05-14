# 📱 WhatsApp → Google Sheets: Guia de Setup Completo

## Visão Geral

```
Você (WhatsApp) → Twilio → Railway (backend + Claude AI) → Google Sheets
```

---

## PASSO 1 — Google Sheets e Service Account (15 min)

### 1.1 Criar a planilha

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha nova
2. Renomeie a **aba inferior** para `Gastos` (clique duas vezes no nome da aba)
3. Na linha 1, adicione os cabeçalhos:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Data | Valor | Categoria | Descrição | Método de Pagamento | Cartão |

4. Copie o **ID da planilha** da URL:
   `https://docs.google.com/spreadsheets/d/**SEU_ID_AQUI**/edit`

### 1.2 Criar Service Account no Google Cloud

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto novo (ou use um existente)
3. No menu lateral: **APIs e Serviços → Biblioteca**
4. Busque e ative: **Google Sheets API**
5. Vá em **APIs e Serviços → Credenciais**
6. Clique em **+ Criar Credenciais → Conta de Serviço**
7. Dê um nome qualquer (ex: `whatsapp-bot`) e clique em **Criar**
8. Na próxima tela, clique em **Concluído** (sem precisar atribuir papéis)
9. Clique na conta de serviço criada → aba **Chaves** → **Adicionar Chave → JSON**
10. Um arquivo `.json` vai ser baixado — guarde-o

### 1.3 Dar acesso à planilha

1. Abra o arquivo JSON baixado e copie o valor de `"client_email"` (parece um email)
2. Na sua planilha do Google Sheets, clique em **Compartilhar**
3. Cole esse email e dê permissão de **Editor**
4. Clique em **Enviar**

---

## PASSO 2 — Twilio WhatsApp Sandbox (10 min)

1. Crie conta em [twilio.com](https://twilio.com) (gratuito)
2. No painel, vá em **Messaging → Try it Out → Send a WhatsApp message**
3. Siga as instruções para **conectar seu número ao Sandbox**:
   - Você vai enviar uma mensagem como `join <palavra>` para o número deles
4. Anote o **Account SID** e o **Auth Token** (não precisamos deles no código, mas guarde)
5. A URL do webhook você vai preencher depois (após o deploy)

---

## PASSO 3 — Deploy no Railway (10 min)

1. Crie conta em [railway.app](https://railway.app) com seu GitHub
2. Faça upload do código:
   - Opção A: Suba os arquivos para um repositório GitHub e conecte no Railway
   - Opção B: Use o [Railway CLI](https://docs.railway.app/develop/cli): `railway up`
3. No Railway, vá em **Variables** e adicione:

```
ANTHROPIC_API_KEY        = sua chave de https://console.anthropic.com
GOOGLE_SHEET_ID          = o ID da planilha copiado no Passo 1.1
GOOGLE_SERVICE_ACCOUNT_JSON = conteúdo COMPLETO do arquivo JSON (em uma linha)
```

> **Como colocar o JSON em uma linha:**
> No terminal: `cat sua-chave.json | tr -d '\n'`
> Cole o resultado no campo do Railway

4. O Railway vai fazer o deploy automaticamente
5. Copie a URL gerada (ex: `https://whatsapp-gastos-production.up.railway.app`)

---

## PASSO 4 — Conectar Twilio ao Railway

1. No painel do Twilio, vá em **Messaging → Settings → WhatsApp Sandbox Settings**
2. No campo **"When a message comes in"**, cole:
   `https://SUA-URL-DO-RAILWAY.up.railway.app/webhook`
3. Método: **HTTP POST**
4. Salve

---

## PASSO 5 — Testar

Mande uma mensagem no WhatsApp para o número do Twilio Sandbox:

```
Almoço no restaurante japonês, 87 reais, Nubank crédito
```

Você deve receber:
```
✅ Gasto registrado!
📅 14/05/2026
💰 R$ 87.00
🏷️ Alimentação
📝 Almoço em restaurante japonês
💳 crédito (Nubank)
```

E a linha aparece automaticamente na planilha.

---

## Exemplos de mensagens que funcionam

```
"Uber 23 reais débito"
"Farmácia 156 reais Itaú crédito"
"Aluguel 1800 pix"
"Cinema com a família, 120 reais Nubank crédito"
"Comprei uns tênis por 299, paguei no cartão C6"
"Gasolina hoje, 180 conto, dinheiro"
```

---

## Troubleshooting

| Problema | Solução |
|----------|---------|
| Bot não responde | Verifique os logs no Railway |
| "Não consegui identificar" | Reformule com valor numérico explícito |
| Erro de planilha | Confirme que o email da Service Account tem acesso de Editor |
| JSON inválido | Garanta que o JSON está em uma linha só no Railway |

---

## Custo estimado

| Serviço | Custo |
|---------|-------|
| Railway | ~$5/mês (plano Hobby) ou gratuito com limitações |
| Twilio Sandbox | Gratuito para testes |
| Twilio produção | ~$0.005 por mensagem |
| Claude API | ~$0.001 por gasto registrado |
| Google Sheets API | Gratuito |

**Total real: menos de R$ 10/mês para uso pessoal.**
