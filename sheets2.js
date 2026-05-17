const { google } = require("googleapis");
const { getBudgets, getGastosPorMes } = require("./sheets");

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function formatarValor(valor) {
  return valor.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function calcularScore(porCategoria, budgets) {
  const categoriasBudget = Object.entries(budgets);
  if (categoriasBudget.length === 0) return null;

  let totalPontos = 0;
  let count = 0;

  categoriasBudget.forEach(([cat, limite]) => {
    const gasto = porCategoria[cat] || 0;
    const pct = gasto / limite;
    let nota;

    if (pct <= 0) nota = 10;
    else if (pct <= 0.5) nota = 10 - (pct / 0.5) * 2;
    else if (pct <= 0.8) nota = 8 - ((pct - 0.5) / 0.3) * 1;
    else if (pct <= 1.0) nota = 7 - ((pct - 0.8) / 0.2) * 2;
    else if (pct <= 1.5) nota = 5 - ((pct - 1.0) / 0.5) * 5;
    else nota = 0;

    totalPontos += Math.max(0, nota);
    count++;
  });

  return (totalPontos / count).toFixed(1);
}

function emojiScore(score) {
  const s = parseFloat(score);
  if (s >= 9) return "🏆 Excelente";
  if (s >= 7) return "🟢 Bom";
  if (s >= 5) return "🟡 Regular";
  if (s >= 3) return "🟠 Atenção";
  return "🔴 Crítico";
}

function calcularCicloFatura(diaFechamento) {
  const hoje = new Date();
  const diaHoje = hoje.getDate();
  const mesHoje = hoje.getMonth();
  const anoHoje = hoje.getFullYear();

  let inicioMes, inicioAno, fimMes, fimAno;

  if (diaHoje >= diaFechamento) {
    inicioMes = mesHoje;
    inicioAno = anoHoje;
    fimMes = mesHoje === 11 ? 0 : mesHoje + 1;
    fimAno = mesHoje === 11 ? anoHoje + 1 : anoHoje;
  } else {
    inicioMes = mesHoje === 0 ? 11 : mesHoje - 1;
    inicioAno = mesHoje === 0 ? anoHoje - 1 : anoHoje;
    fimMes = mesHoje;
    fimAno = anoHoje;
  }

  const inicio = new Date(inicioAno, inicioMes, diaFechamento);
  const fim = new Date(fimAno, fimMes, diaFechamento - 1);
  const totalDias = Math.ceil((fim - inicio) / (1000 * 60 * 60 * 24));
  const diasDecorridos = Math.ceil((new Date() - inicio) / (1000 * 60 * 60 * 24));
  const diasRestantes = Math.ceil((fim - new Date()) / (1000 * 60 * 60 * 24));
  const pctCiclo = Math.min(100, Math.round((diasDecorridos / totalDias) * 100));

  return { inicio, fim, totalDias, diasDecorridos, diasRestantes, pctCiclo };
}

function formatarData(d) {
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

function alertaRitmo(pctGasto, pctCiclo) {
  if (pctGasto >= 100) return `🔴 Limite ultrapassado. Você gastou mais do que havia planejado para este cartão. Controle-se.`;
  if (pctGasto >= 80) return `🟠 Ritmo de consumo elevado. Há risco de atingir o limite antes do fechamento da fatura.`;
  if (pctGasto - pctCiclo >= 20) return `🟡 Consumo acima do esperado para este momento do ciclo. Recomenda-se cautela nos próximos gastos.`;
  return `✅ Consumo dentro do esperado para o período.`;
}

async function getFaturas() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const resCartoes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Cartões!A:D",
  });

  const cartoes = (resCartoes.data.values || []).slice(1).filter(r => r[0] && r[2]);

  const resGastos = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:H",
  });

  const gastos = (resGastos.data.values || []).slice(1);

  const parsearData = (str) => {
    const p = str.split("/");
    if (p.length < 3) return null;
    return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  };

  let msg = `🧾 Faturas em aberto\n${"─".repeat(25)}\n\n`;

  for (const cartao of cartoes) {
    const nomeCartao = cartao[0];
    const diaFechamento = parseInt(cartao[2]);
    const limiteCartao = cartao[3] ? parseFloat(cartao[3].toString().replace(",", ".")) : null;
    const { inicio, fim, diasRestantes, pctCiclo } = calcularCicloFatura(diaFechamento);

    const gastosCartao = gastos.filter(row => {
      if (!row[0] || !row[5]) return false;
      const d = parsearData(row[0]);
      if (!d) return false;
      return (row[5] || "").toLowerCase().includes(nomeCartao.toLowerCase()) && d >= inicio && d <= fim;
    });

    const aVista = gastosCartao
      .filter(row => (row[7] || "").toLowerCase() !== "parcelado")
      .reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);

    const parcelas = gastosCartao
      .filter(row => (row[7] || "").toLowerCase() === "parcelado")
      .reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);

    const total = aVista + parcelas;

    msg += `💳 *${nomeCartao}*\n`;
    msg += `📅 Ciclo: ${formatarData(inicio)} a ${formatarData(fim)} — ${diasRestantes} dias até o fechamento\n`;
    msg += `🛒 À vista: R$ ${formatarValor(aVista)}\n`;
    msg += `🔄 Parcelas: R$ ${formatarValor(parcelas)}\n`;

    if (limiteCartao) {
      const pctGasto = Math.round((total / limiteCartao) * 100);
      const emojiLimite = pctGasto >= 100 ? "🔴" : pctGasto >= 80 ? "🟡" : "🟢";
      msg += `💰 Total: R$ ${formatarValor(total)} / R$ ${formatarValor(limiteCartao)} (${pctGasto}%) ${emojiLimite}\n`;
      msg += `${alertaRitmo(pctGasto, pctCiclo)}\n`;
    } else {
      msg += `💰 Total: R$ ${formatarValor(total)}\n`;
    }

    msg += `\n`;
  }

  return msg.trim();
}

async function getResumoMes() {
  const agora = new Date();
  const { porCategoria, total } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());

  if (total === 0) return "📊 Nenhum gasto registrado este mês.";

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:H",
  });

  const rows = res.data.values || [];
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });

  const porPessoa = {};
  const porMetodo = {};
  const porCartao = {};

  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const metodo = row[4] || "não informado";
    const cartao = row[5] || "não informado";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
    porMetodo[metodo] = (porMetodo[metodo] || 0) + val;
    porCartao[cartao] = (porCartao[cartao] || 0) + val;
  });

  const budgets = await getBudgets();
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  let msg = `📊 Resumo de ${nomeMes}\n`;
  msg += `💰 Total: R$ ${formatarValor(total)}\n\n`;

  msg += `📂 Por categoria:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      const limite = budgets[cat];
      if (limite) {
        const pct = ((val / limite) * 100).toFixed(0);
        const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
        msg += `${emoji} ${cat}: R$ ${formatarValor(val)} / R$ ${formatarValor(limite)} (${pct}%)\n`;
      } else {
        msg += `• ${cat}: R$ ${formatarValor(val)}\n`;
      }
    });

  msg += `\n💳 Por método:\n`;
  Object.entries(porMetodo)
    .sort((a, b) => b[1] - a[1])
    .forEach(([metodo, val]) => {
      msg += `• ${metodo}: R$ ${formatarValor(val)}\n`;
    });

  msg += `\n💳 Por cartão:\n`;
  Object.entries(porCartao)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cartao, val]) => {
      msg += `• ${cartao}: R$ ${formatarValor(val)}\n`;
    });

  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pessoa, val]) => {
      msg += `• ${pessoa}: R$ ${formatarValor(val)}\n`;
    });

  return msg;
}

async function getResumoCategoria(categoria) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:H",
  });

  const rows = res.data.values || [];
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0] || row[2]?.toLowerCase() !== categoria.toLowerCase()) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });

  if (gastosMes.length === 0) return `📂 Nenhum gasto em *${categoria}* este mês.`;

  const total = gastosMes.reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);
  const budgets = await getBudgets();
  const limite = budgets[categoria];
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  let msg = `📂 *${categoria}* — ${nomeMes}\n`;

  if (limite) {
    const pct = ((total / limite) * 100).toFixed(0);
    const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
    msg += `${emoji} Total: R$ ${formatarValor(total)} / R$ ${formatarValor(limite)} (${pct}%)\n`;
  } else {
    msg += `💰 Total: R$ ${formatarValor(total)}\n`;
  }

  msg += `\n📋 Lançamentos:\n`;
  gastosMes.forEach(row => {
    msg += `• ${row[0]} — R$ ${formatarValor(parseFloat((row[1] || "0").replace(",", ".")))} — ${row[3] || ""} (${row[6] || ""})\n`;
  });

  return msg;
}

async function getRelatorioSemana() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:H",
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return "📅 Nenhum gasto registrado ainda.";

  const agora = new Date();
  const diaSemana = agora.getDay();
  const diasAteSeg = diaSemana === 0 ? 6 : diaSemana - 1;

  const inicioSemanaAtual = new Date(agora);
  inicioSemanaAtual.setDate(agora.getDate() - diasAteSeg);
  inicioSemanaAtual.setHours(0, 0, 0, 0);

  const inicioSemanaAnterior = new Date(inicioSemanaAtual);
  inicioSemanaAnterior.setDate(inicioSemanaAtual.getDate() - 7);

  const fimSemanaAnterior = new Date(inicioSemanaAtual);
  fimSemanaAnterior.setDate(inicioSemanaAtual.getDate() - 1);
  fimSemanaAnterior.setHours(23, 59, 59, 999);

  const parsearData = (str) => {
    const p = str.split("/");
    if (p.length < 3) return null;
    return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  };

  const gastosSemana = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const d = parsearData(row[0]);
    if (!d) return false;
    return d >= inicioSemanaAnterior && d <= fimSemanaAnterior;
  });

  const dataInicioStr = inicioSemanaAnterior.toLocaleDateString("pt-BR");
  const dataFimStr = fimSemanaAnterior.toLocaleDateString("pt-BR");

  if (gastosSemana.length === 0) return `📅 Nenhum gasto registrado na semana de ${dataInicioStr} a ${dataFimStr}.`;

  const total = gastosSemana.reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);

  const porCategoria = {};
  gastosSemana.forEach(row => {
    const cat = row[2] || "Outro";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porCategoria[cat] = (porCategoria[cat] || 0) + val;
  });

  const porPessoa = {};
  gastosSemana.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });

  let msg = `📅 Relatório semanal\n`;
  msg += `🗓️ ${dataInicioStr} a ${dataFimStr}\n`;
  msg += `💰 Total: R$ ${formatarValor(total)}\n\n`;

  msg += `📂 Por categoria:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      msg += `• ${cat}: R$ ${formatarValor(val)}\n`;
    });

  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pessoa, val]) => {
      msg += `• ${pessoa}: R$ ${formatarValor(val)}\n`;
    });

  return msg;
}

async function getFechamentoMes() {
  const agora = new Date();
  const { porCategoria, total } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());

  if (total === 0) return "🏁 Nenhum gasto registrado este mês.";

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:H",
  });

  const rows = res.data.values || [];
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });

  const porPessoa = {};
  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });

  const budgets = await getBudgets();
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const score = calcularScore(porCategoria, budgets);

  let totalBudget = 0;
  let categoriasEstouradas = [];
  let categoriasDentro = [];

  Object.entries(porCategoria).forEach(([cat, val]) => {
    const limite = budgets[cat];
    if (limite) {
      totalBudget += limite;
      if (val > limite) categoriasEstouradas.push(cat);
      else categoriasDentro.push(cat);
    }
  });

  const maiorGasto = Object.entries(porCategoria).sort((a, b) => b[1] - a[1])[0];
  const maiorGastante = Object.entries(porPessoa).sort((a, b) => b[1] - a[1])[0];

  let msg = `🏁 Fechamento de ${nomeMes}\n`;
  msg += `${"─".repeat(25)}\n`;
  msg += `💰 Total gasto: R$ ${formatarValor(total)}\n`;

  if (score !== null) {
    msg += `⭐ Score financeiro: ${score}/10 — ${emojiScore(score)}\n`;
  }

  if (totalBudget > 0) {
    const pctGeral = ((total / totalBudget) * 100).toFixed(0);
    const emojiGeral = total > totalBudget ? "🔴" : total / totalBudget >= 0.8 ? "🟡" : "🟢";
    msg += `${emojiGeral} Budget total: R$ ${formatarValor(totalBudget)} (${pctGeral}% utilizado)\n`;
  }

  msg += `\n📂 Por categoria:\n`;
  Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, val]) => {
      const limite = budgets[cat];
      if (limite) {
        const pct = ((val / limite) * 100).toFixed(0);
        const emoji = pct >= 100 ? "🔴" : pct >= 80 ? "🟡" : "🟢";
        msg += `${emoji} ${cat}: R$ ${formatarValor(val)} / R$ ${formatarValor(limite)} (${pct}%)\n`;
      } else {
        msg += `• ${cat}: R$ ${formatarValor(val)}\n`;
      }
    });

  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa)
    .sort((a, b) => b[1] - a[1])
    .forEach(([pessoa, val]) => {
      const pct = ((val / total) * 100).toFixed(0);
      msg += `• ${pessoa}: R$ ${formatarValor(val)} (${pct}% do total)\n`;
    });

  msg += `\n📌 Destaques:\n`;
  msg += `• Maior gasto: ${maiorGasto[0]} (R$ ${formatarValor(maiorGasto[1])})\n`;
  msg += `• Quem mais gastou: ${maiorGastante[0]} (R$ ${formatarValor(maiorGastante[1])})\n`;

  if (categoriasEstouradas.length > 0) msg += `• Categorias estouradas: ${categoriasEstouradas.join(", ")}\n`;
  if (categoriasDentro.length > 0) msg += `• Dentro do budget: ${categoriasDentro.join(", ")}\n`;

  msg += `\n💡 "Quem controla seus gastos, controla seu futuro."`;

  return msg;
}

async function getComparativo() {
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();
  const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
  const anoAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;

  const atual = await getGastosPorMes(mesAtual, anoAtual);
  const anterior = await getGastosPorMes(mesAnterior, anoAnterior);

  if (atual.total === 0 && anterior.total === 0) return "📈 Nenhum dado encontrado para comparar.";

  const nomeAtual = agora.toLocaleDateString("pt-BR", { month: "long" });
  const dataAnterior = new Date(anoAnterior, mesAnterior, 1);
  const nomeAnterior = dataAnterior.toLocaleDateString("pt-BR", { month: "long" });

  const diffTotal = atual.total - anterior.total;
  const diffPct = anterior.total > 0 ? ((diffTotal / anterior.total) * 100).toFixed(0) : 0;
  const emojiTotal = diffTotal > 0 ? "📈" : diffTotal < 0 ? "📉" : "➡️";

  let msg = `📊 Comparativo: ${nomeAnterior} vs ${nomeAtual}\n`;
  msg += `${"─".repeat(25)}\n`;
  msg += `${emojiTotal} Total: R$ ${formatarValor(anterior.total)} → R$ ${formatarValor(atual.total)}\n`;

  const sinal = diffTotal >= 0 ? "+" : "";
  msg += `   ${sinal}R$ ${formatarValor(Math.abs(diffTotal))} (${sinal}${diffPct}%)\n\n`;

  msg += `📂 Por categoria:\n`;
  const todasCategorias = new Set([...Object.keys(atual.porCategoria), ...Object.keys(anterior.porCategoria)]);

  Array.from(todasCategorias).sort().forEach(cat => {
    const valAtual = atual.porCategoria[cat] || 0;
    const valAnterior = anterior.porCategoria[cat] || 0;
    const diff = valAtual - valAnterior;
    const emoji = diff > 0 ? "📈" : diff < 0 ? "📉" : "➡️";
    const sinalCat = diff >= 0 ? "+" : "";
    msg += `${emoji} ${cat}: R$ ${formatarValor(valAnterior)} → R$ ${formatarValor(valAtual)}\n`;
    msg += `   (${sinalCat}R$ ${formatarValor(Math.abs(diff))})\n`;
  });

  msg += diffTotal < 0 ? `\n✅ Parabéns! Você gastou menos este mês.` : `\n⚠️ Você gastou mais este mês. Fique de olho!`;
  return msg;
}

async function getParcelasAbertas() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Parcelas!A:H",
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return "💳 Nenhuma parcela em aberto.";

  const abertas = rows.slice(1).filter(row => {
    const totalParcelas = parseInt(row[6] || "0");
    const parcelasPagas = parseInt(row[7] || "0");
    return parcelasPagas < totalParcelas;
  });

  if (abertas.length === 0) return "✅ Nenhuma parcela em aberto. Parabéns!";

  const agora = new Date();
  const projecao = [0, 1, 2, 3].map(offset => {
    const mes = new Date(agora.getFullYear(), agora.getMonth() + offset, 1);
    const nomeMes = mes.toLocaleDateString("pt-BR", { month: "long" });
    const total = abertas.reduce((acc, row) => {
      const restantes = parseInt(row[6] || "0") - parseInt(row[7] || "0");
      return restantes > offset ? acc + parseFloat((row[1] || "0").replace(",", ".")) : acc;
    }, 0);
    return { nomeMes, total };
  });

  const totalRestanteGeral = abertas.reduce((acc, row) => {
    const val = parseFloat((row[1] || "0").replace(",", "."));
    const restantes = parseInt(row[6] || "0") - parseInt(row[7] || "0");
    return acc + val * restantes;
  }, 0);

  const porCartao = {};
  abertas.forEach(row => {
    const cartao = row[3] || "Outros";
    const val = parseFloat((row[1] || "0").replace(",", "."));
    porCartao[cartao] = (porCartao[cartao] || 0) + val;
  });

  let msg = `💳 Parcelas em aberto (${abertas.length})\n`;
  msg += `📊 Total restante: R$ ${formatarValor(totalRestanteGeral)}\n\n`;

  msg += `💳 Por cartão (mensal):\n`;
  Object.entries(porCartao)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cartao, val]) => {
      msg += `• ${cartao}: R$ ${formatarValor(val)}\n`;
    });

  msg += `\n📅 Projeção:\n`;
  projecao.forEach(({ nomeMes, total }) => {
    msg += `• ${nomeMes}: R$ ${formatarValor(total)}\n`;
  });

  msg += `\n📋 Parcelas:\n`;
  abertas.forEach(row => {
    const descricao = row[0] || "?";
    const valorParcela = parseFloat((row[1] || "0").replace(",", "."));
    const cartao = row[3] || "";
    const restantes = parseInt(row[6] || "0") - parseInt(row[7] || "0");
    msg += `• ${descricao} (${cartao}): R$ ${formatarValor(valorParcela)} x${restantes}\n`;
  });

  return msg;
}

async function getUltimoLancamento(pessoa) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Gastos!A:H",
  });

  const rows = res.data.values || [];
  const lancamentos = rows.slice(1);

  for (let i = lancamentos.length - 1; i >= 0; i--) {
    if (lancamentos[i][6] === pessoa) {
      return {
        data: lancamentos[i][0],
        valor: lancamentos[i][1],
        categoria: lancamentos[i][2],
        descricao: lancamentos[i][3],
        metodo: lancamentos[i][4],
        cartao: lancamentos[i][5],
        linha: i + 2,
      };
    }
  }
  return null;
}

async function deletarUltimoLancamento(pessoa) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const ultimo = await getUltimoLancamento(pessoa);
  if (!ultimo) return false;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: 0,
            dimension: "ROWS",
            startIndex: ultimo.linha - 1,
            endIndex: ultimo.linha,
          },
        },
      }],
    },
  });

  return true;
}

module.exports = { getResumoMes, getResumoCategoria, getRelatorioSemana, getFechamentoMes, getComparativo, getParcelasAbertas, getFaturas, getUltimoLancamento, deletarUltimoLancamento };
