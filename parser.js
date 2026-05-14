const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const today = () => {
  const d = new Date();
  return d.toLocaleDateString("pt-BR");
};

const SYSTEM_PROMPT = `Você é um assistente que extrai informações de gastos a partir de mensagens em português.

Retorne APENAS um JSON válido com exatamente estas chaves:
{
  "data": "DD/MM/AAAA",
  "valor": "00.00",
  "categoria": "string",
  "descricao": "string",
  "metodo_pagamento": "crédito | débito | pix | dinheiro | outro",
  "cartao": "nome do cartão ou banco, ou null se não mencionado"
}

Regras:
- "data": use a data mencionada. Se não houver, use a data de hoje: ${today()}
- "valor": apenas número com duas casas decimais, sem R$
- "categoria": infira uma categoria razoável (Alimentação, Transporte, Saúde, Lazer, Moradia, Compras, Educação, Outro)
- "descricao": descrição curta e clara do gasto
- "metodo_pagamento": infira pelo contexto. Se não mencionado, use "não informado"
- "cartao": nome do banco/cartão se mencionado (ex: Nubank, Inter, Itaú, C6), senão null

Se a mensagem não parecer um gasto, retorne null.
Retorne APENAS o JSON, sem texto adicional, sem markdown.`;

async function parseExpense(message) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: message }],
  });

  const text = response.content[0]?.text?.trim();

 console.log("Resposta da IA:", text);
if (!text || text === "null") return null;

  try {
    return JSON.parse(text);
  } catch {
    console.error("Falha ao parsear JSON:", text);
    return null;
  }
}

module.exports = { parseExpense };
