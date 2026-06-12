const Anthropic = require("@anthropic-ai/sdk");
const { getCategorias } = require("./sheets");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache de categorias — busca uma vez e reutiliza por 1 hora
let categoriasCached = null;
let categoriasCachedAt = 0;
async function getCategoriasComCache() {
  const agora = Date.now();
  if (!categoriasCached || agora - categoriasCachedAt > 60 * 60 * 1000) {
    categoriasCached = await getCategorias();
    categoriasCachedAt = agora;
    console.log('[parser] categorias atualizadas:', categoriasCached.length);
  }
  return categoriasCached;
}

const today = () => {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

async function parseExpense(message) {
  const t0 = Date.now();
  const categorias = await getCategoriasComCache();
  console.log(`[parser] categorias em ${Date.now()-t0}ms`);
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
- "data": use a data mencionada na mensagem. Se não houver data, use a data de hoje: ${today()}
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
  const t1 = Date.now();
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: message }],
  });
  console.log(`[parser] claude respondeu em ${Date.now()-t1}ms`);
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

async function parseReceita(message) {
  const SYSTEM_PROMPT = `Você é um assistente que extrai informações de receitas/entradas de dinheiro a partir de mensagens em português.
Retorne APENAS um JSON válido com exatamente estas chaves:
{
  "data": "DD/MM/AAAA",
  "valor": "00.00",
  "descricao": "string",
  "pessoa": "string"
}
Regras:
- "data": use a data mencionada na mensagem. Se não houver data, use a data de hoje: ${today()}
- "valor": valor numérico da receita, sem símbolo de moeda
- "descricao": descrição curta da receita (ex: "Salário", "Freelance", "Aluguel recebido")
- "pessoa": nome da pessoa que recebeu. Se a mensagem disser "recebi" sem nome, use "Joao". Se mencionar "Isabella" ou "Isa", use "Isabella". Se não for possível inferir, use "Joao"
Exemplos:
- "recebi 5000 salário" → pessoa: "Joao", descricao: "Salário"
- "Isabella recebeu 3000" → pessoa: "Isabella", descricao: "Salário"
- "Isa recebeu o salário 4500" → pessoa: "Isabella", descricao: "Salário"
- "entrada de 2000 freelance" → pessoa: "Joao", descricao: "Freelance"
Se a mensagem não parecer uma receita ou entrada de dinheiro, retorne null.
Retorne APENAS o JSON, sem texto adicional, sem markdown.`;
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: message }],
  });
  const text = response.content[0]?.text?.trim();
  if (!text || text === "null") return null;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    console.error("Falha ao parsear receita JSON:", text);
    return null;
  }
}

module.exports = { parseExpense, parseReceita };
