const Anthropic = require("@anthropic-ai/sdk");
const { getCategorias } = require("./sheets");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const today = () => {
  const d = new Date();
  return d.toLocaleDateString("pt-BR");
};

async function parseExpense(message) {
  const categorias = await getCategorias();
  const listaCategoria = categorias.join(", ");

  const SYSTEM_PROMPT = `Você é um assistente que extrai informações de gastos a partir de mensagens em português.

Retorne APENAS um JSON válido com exatamente estas chaves:
{
  "data": "DD/MM/AAAA",
  "valor": "00.00",
  "categoria": "string",
  "descricao": "string",
  "metodo_pagamento": "crédito | débito | pix | dinheiro | outro",
  "cartao": "nome do cartão ou banco, ou null se não mencionado",
  "parcelado": false,
  "total_parcelas": null,
  "valor_parcela": null
}

Regras:
- "data": use a data mencionada. Se não houver, use a data de hoje: ${today()}
- "valor": se parcelado, use o valor TOTAL (parcela x total). Se não parcelado, valor informado
- "valor_parcela": se parcelado, valor de cada parcela. Senão null
- "total_parcelas": número total de parcelas se mencionado. Senão null
- "parcelado": true se mencionar parcelas, vezes, x, prestações. Senão false
- "categoria": infira uma categoria razoável dentre estas opções: ${listaCategoria}
- "descricao": descrição curta e clara do gasto
- "metodo_pagamento": infira pelo contexto. Se não mencionado, use "não informado"
- "cartao": nome do banco/cartão se mencionado (ex: Nubank, Inter, Itaú, C6), senão null

Exemplos de parcelamento:
- "TV 12x de 350" → parcelado: true, total_parcelas: 12, valor_parcela: "350.00", valor: "4200.00"
- "Comprei um notebook em 6 vezes de 500 no Nubank" → parcelado: true, total_parcelas: 6, valor_parcela: "500.00", valor: "3000.00"

Se a mensagem não parecer um gasto, retorne null.
Retorne APENAS o JSON, sem texto adicional, sem markdown.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: message }],
  });

  const text = response.content[0]?.text?.trim();

  if (!text || text === "null") return null;

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    console.error("Falha ao parsear JSON:", text);
    return null;
  }
}

module.exports = { parseExpense };
