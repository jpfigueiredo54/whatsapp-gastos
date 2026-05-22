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
    inicioMes = mesHoje; inicioAno = anoHoje;
    fimMes = mesHoje === 11 ? 0 : mesHoje + 1;
    fimAno = mesHoje === 11 ? anoHoje + 1 : anoHoje;
  } else {
    inicioMes = mesHoje === 0 ? 11 : mesHoje - 1;
    inicioAno = mesHoje === 0 ? anoHoje - 1 : anoHoje;
    fimMes = mesHoje; fimAno = anoHoje;
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

function parseVal(str) {
  return parseFloat((str || "0").replace(/R\$\s*/g, "").replace(",", ".")) || 0;
}

async function getReceitasPorMes(mes, ano) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Receitas!A:D",
  });

  const rows = res.data.values || [];
  const receitas = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mes && parseInt(partes[2]) === ano;
  });

  const porPessoa = {};
  let total = 0;
  receitas.forEach(row => {
    const pessoa = row[3] || "Desconhecido";
    const val = parseVal(row[1]);
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
    total += val;
  });

  return { receitas, porPessoa, total };
}

async function getApiReceitas() {
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Receitas!A:D",
  });

  const rows = res.data.values || [];
  const todas = rows.slice(1).filter(r => r[0]).map(row => ({
    data: row[0],
    valor: parseVal(row[1]),
    descricao: row[2] || "",
    pessoa: row[3] || "",
  })).reverse();

  const { total: totalMes, porPessoa } = await getReceitasPorMes(mesAtual, anoAtual);

  return { lista: todas, totalMes, porPessoa };
}

async function getApiFluxoCaixa(meses = 6) {
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();
  const n = parseInt(meses) || 6;

  const historico = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = (mesAtual - i + 12) % 12;
    const a = anoAtual - (mesAtual - i < 0 ? 1 : 0);
    const { total: totalGastos } = await getGastosPorMes(m, a);
    const { total: totalReceitas, porPessoa } = await getReceitasPorMes(m, a);
    const nomeMes = new Date(a, m, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    historico.push({
      mes: nomeMes,
      receitas: totalReceitas,
      gastos: totalGastos,
      saldo: totalReceitas - totalGastos,
      porPessoa,
    });
  }

  // Receitas do mês atual detalhadas
  const { total: receitasMes, porPessoa: porPessoaMes } = await getReceitasPorMes(mesAtual, anoAtual);
  const { total: gastosMes } = await getGastosPorMes(mesAtual, anoAtual);
  const saldoMes = receitasMes - gastosMes;

  // Próximas entradas previstas — lê da aba ReceitasPrevistas
  const hoje = agora.getDate();
  const proximasEntradas = [];

  try {
    const authPrev = getAuth();
    const sheetsPrev = google.sheets({ version: "v4", auth: authPrev });
    const resPrev = await sheetsPrev.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "ReceitasPrevistas!A:D",
    });
    const rowsPrev = (resPrev.data.values || []).slice(1).filter(r => r[0] && r[1]);
    rowsPrev.forEach(row => {
      const pessoa = row[0] || "";
      const dia = parseInt(row[1] || "0");
      const descricao = row[2] || "Receita";
      const valor = parseVal(row[3] || "0");
      if (dia > hoje) {
        proximasEntradas.push({
          pessoa,
          dia,
          descricao,
          diasRestantes: dia - hoje,
          valorEstimado: valor,
        });
      }
    });
    proximasEntradas.sort((a, b) => a.diasRestantes - b.diasRestantes);
  } catch(e) {
    console.error("Erro ao ler ReceitasPrevistas:", e);
  }

  proximasEntradas.forEach(e => {
    if (!e.valorEstimado) e.valorEstimado = 0;
  });

  // Saldo inicial da aba Config
  let saldoInicial = 0;
  try {
    const authCfg = getAuth();
    const sheetsCfg = google.sheets({ version: "v4", auth: authCfg });
    const resCfg = await sheetsCfg.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Config!A:B",
    });
    const rowsCfg = (resCfg.data.values || []).slice(1);
    const cfgRow = rowsCfg.find(r => (r[0]||'').toLowerCase() === 'saldo_inicial');
    if (cfgRow) saldoInicial = parseVal(cfgRow[1] || '0');
  } catch(e) {
    console.error("Erro ao ler Config:", e);
  }

  // Saldo acumulado mês a mês
  let acumulado = saldoInicial;
  const historicoAcumulado = historico.map(h => {
    acumulado += h.saldo;
    return { ...h, acumulado };
  });

  return {
    historico: historicoAcumulado,
    receitasMes,
    gastosMes,
    saldoMes,
    porPessoaMes,
    proximasEntradas,
    saldoInicial,
    saldoAcumulado: acumulado,
  };
}

async function getRitmo() {
  const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const ultimoDia = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const diasRestantes = ultimoDia - agora.getDate() + 1;
  if (diasRestantes <= 0) return "📅 Fim de mês — sem dias restantes para calcular.";
  const { porCategoria } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());
  const budgets = await getBudgets();
  if (Object.keys(budgets).length === 0) return "⚠️ Nenhum budget configurado ainda.";
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long" });
  const budgetTotal = Object.values(budgets).reduce((a, b) => a + b, 0);
  const gastoTotal = Object.entries(budgets).reduce((acc, [cat]) => acc + (porCategoria[cat] || 0), 0);
  const saldo = budgetTotal - gastoTotal;
  const ritmoDiario = saldo / diasRestantes;
  const emoji = saldo <= 0 ? "🔴" : saldo / budgetTotal < 0.2 ? "🟡" : "✅";
  let msg = `📊 Seu ritmo de gastos\n`;
  msg += `🗓️ ${diasRestantes} dias restantes em ${nomeMes}\n\n`;
  msg += `💰 Budget total: R$ ${formatarValor(budgetTotal)}\n`;
  msg += `💸 Gasto até agora: R$ ${formatarValor(gastoTotal)}\n`;
  msg += `${emoji} Saldo disponível: R$ ${formatarValor(Math.max(0, saldo))}\n`;
  msg += `📆 Ritmo diário: R$ ${formatarValor(Math.max(0, ritmoDiario))}\n`;
  if (saldo <= 0) msg += `\n⚠️ Budget total estourado em R$ ${formatarValor(Math.abs(saldo))}.`;
  return msg;
}

async function getApiFechamentoMesAnterior() {
  const agora = new Date();
  const mesAnterior = agora.getMonth() === 0 ? 11 : agora.getMonth() - 1;
  const anoAnterior = agora.getMonth() === 0 ? agora.getFullYear() - 1 : agora.getFullYear();
  const mesDoisAtras = mesAnterior === 0 ? 11 : mesAnterior - 1;
  const anoDoisAtras = mesAnterior === 0 ? anoAnterior - 1 : anoAnterior;
  const { porCategoria, total } = await getGastosPorMes(mesAnterior, anoAnterior);
  const { total: totalAnterior } = await getGastosPorMes(mesDoisAtras, anoDoisAtras);
  const budgets = await getBudgets();
  if (total === 0) return null;
  const score = calcularScore(porCategoria, budgets);
  const budgetTotal = Object.values(budgets).reduce((a, b) => a + b, 0);
  const pctBudget = budgetTotal > 0 ? Math.round((total / budgetTotal) * 100) : null;
  const varPct = totalAnterior > 0 ? Math.round((total - totalAnterior) / totalAnterior * 100) : null;
  const nomeMes = new Date(anoAnterior, mesAnterior, 1).toLocaleDateString("pt-BR", { month: "long" });
  const categorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).map(([cat, val]) => {
    const limite = budgets[cat];
    const pct = limite ? Math.round((val / limite) * 100) : null;
    return { cat, val, limite, pct };
  });
  return { nomeMes, total, totalAnterior, varPct, score, budgetTotal, pctBudget, categorias };
}

async function getFaturas() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const resCartoes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Cartões!A:D" });
  const cartoes = (resCartoes.data.values || []).slice(1).filter(r => r[0] && r[2]);
  const resGastos = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
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
    const aVista = gastosCartao.filter(row => (row[7] || "").toLowerCase() !== "parcelado").reduce((acc, row) => acc + parseVal(row[1]), 0);
    const parcelas = gastosCartao.filter(row => (row[7] || "").toLowerCase() === "parcelado").reduce((acc, row) => acc + parseVal(row[1]), 0);
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

async function getApiResumo(mes, ano) {
  const agora = new Date();
  const mesAtual = mes !== undefined ? parseInt(mes) : agora.getMonth();
  const anoAtual = ano !== undefined ? parseInt(ano) : agora.getFullYear();
  const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
  const anoAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;
  const { porCategoria, total } = await getGastosPorMes(mesAtual, anoAtual);
  const { total: totalAnterior } = await getGastosPorMes(mesAnterior, anoAnterior);
  const budgets = await getBudgets();
  const score = calcularScore(porCategoria, budgets);
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
  const rows = res.data.values || [];
  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });
  const porPessoa = {};
  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseVal(row[1]);
    if (!isNaN(val)) porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });
  const evolucao = [];
  for (let i = 5; i >= 0; i--) {
    const m = (mesAtual - i + 12) % 12;
    const a = anoAtual - (mesAtual - i < 0 ? 1 : 0);
    const { total: t } = await getGastosPorMes(m, a);
    const nomeMes = new Date(a, m, 1).toLocaleDateString("pt-BR", { month: "short" });
    evolucao.push({ mes: nomeMes, total: t });
  }
  // Receitas do mês atual
  const { total: receitasMes } = await getReceitasPorMes(mesAtual, anoAtual);

  // Receitas evolução (últimos 6 meses)
  const receitasEvolucao = [];
  for (let i = 5; i >= 0; i--) {
    const m = (mesAtual - i + 12) % 12;
    const a = anoAtual - (mesAtual - i < 0 ? 1 : 0);
    const { total: tr } = await getReceitasPorMes(m, a);
    receitasEvolucao.push(tr);
  }

  return { total, totalMesAnterior: totalAnterior, porCategoria, porPessoa, budgets, score, evolucao, receitasMes, receitasEvolucao };
}

async function getApiParcelas() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Parcelas!A:H" });
  const rows = res.data.values || [];
  const abertas = rows.slice(1).filter(row => parseInt(row[6] || "0") > parseInt(row[7] || "0"));
  const totalMensal = abertas.reduce((acc, row) => acc + parseFloat((row[1] || "0").replace(",", ".")), 0);
  const totalRestante = abertas.reduce((acc, row) => {
    const val = parseFloat((row[1] || "0").replace(",", "."));
    const restantes = parseInt(row[6] || "0") - parseInt(row[7] || "0");
    return acc + val * restantes;
  }, 0);
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
  const lista = abertas.map(row => ({
    descricao: row[0] || "",
    valorParcela: parseFloat((row[1] || "0").replace(",", ".")),
    categoria: row[2] || "",
    cartao: row[3] || "",
    metodo: row[4] || "",
    responsavel: row[5] || "",
    totalParcelas: parseInt(row[6] || "0"),
    parcelasPagas: parseInt(row[7] || "0"),
    restantes: parseInt(row[6] || "0") - parseInt(row[7] || "0"),
  })).sort((a, b) => b.valorParcela - a.valorParcela);
  return { quantidade: abertas.length, totalMensal, totalRestante, projecao, lista };
}

async function getApiFaturas() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const resCartoes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Cartões!A:E" });
  const cartoes = (resCartoes.data.values || []).slice(1).filter(r => r[0] && r[2]);
  const resGastos = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
  const gastos = (resGastos.data.values || []).slice(1);
  const resParcelas = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Parcelas!A:H" });
  const todasParcelas = (resParcelas.data.values || []).slice(1);
  const parsearData = (str) => {
    const p = str.split("/");
    if (p.length < 3) return null;
    return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  };
  const agora = new Date();
  const result = [];
  for (const cartao of cartoes) {
    const nomeCartao = cartao[0];
    const diaFechamento = parseInt(cartao[2]);
    const limiteCartao = cartao[3] ? parseFloat(cartao[3].toString().replace(",", ".")) : null;
    const bancoEmissor = cartao[4] || "";
    const { inicio, fim, diasRestantes, pctCiclo, totalDias, diasDecorridos } = calcularCicloFatura(diaFechamento);
      const d = parsearData(row[0]);
      if (!d) return false;
      return (row[5] || "").toLowerCase().includes(nomeCartao.toLowerCase()) && d >= inicio && d <= fim;
    });
    const aVista = gastosCartao.filter(row => (row[7] || "").toLowerCase() !== "parcelado").reduce((acc, row) => acc + parseVal(row[1]), 0);
    const parcelas = gastosCartao.filter(row => (row[7] || "").toLowerCase() === "parcelado").reduce((acc, row) => acc + parseVal(row[1]), 0);
    const total = aVista + parcelas;
    const parcelasAtivas = todasParcelas
      .filter(row => {
        const totalP = parseInt(row[6] || "0");
        const pagas = parseInt(row[7] || "0");
        const cartaoRow = (row[3] || "").toLowerCase();
        return pagas < totalP && cartaoRow.includes(nomeCartao.toLowerCase());
      })
      .map(row => ({
        descricao: row[0] || "",
        valorParcela: parseFloat((row[1] || "0").replace(",", ".")),
        categoria: row[2] || "",
        totalParcelas: parseInt(row[6] || "0"),
        parcelasPagas: parseInt(row[7] || "0"),
        restantes: parseInt(row[6] || "0") - parseInt(row[7] || "0"),
      }))
      .sort((a, b) => b.valorParcela - a.valorParcela);
    const projecaoParcelas = [0, 1, 2, 3].map(offset => {
      const mes = new Date(agora.getFullYear(), agora.getMonth() + offset, 1);
      const nomeMes = mes.toLocaleDateString("pt-BR", { month: "long" });
      const totalMes = parcelasAtivas.reduce((acc, p) => {
        return p.restantes > offset ? acc + p.valorParcela : acc;
      }, 0);
      return { nomeMes, total: totalMes };
    });
    result.push({
      nome: nomeCartao, total, aVista, parcelas,
      limite: limiteCartao,
      banco: bancoEmissor,
      diasRestantes, pctCiclo, totalDias, diasDecorridos,
      inicioFormatado: formatarData(inicio),
      fimFormatado: formatarData(fim),
      parcelasAtivas,
      projecaoParcelas,
    });
  }
  const proximoFechamento = result.filter(c => c.diasRestantes > 0).sort((a, b) => a.diasRestantes - b.diasRestantes)[0];
  const totalGeral = result.reduce((a, c) => a + c.total, 0);
  const totalAVista = result.reduce((a, c) => a + c.aVista, 0);
  const totalParcelas = result.reduce((a, c) => a + c.parcelas, 0);
  return {
    cartoes: result, totalGeral, totalAVista, totalParcelas,
    proximoFechamento: proximoFechamento ? { nome: proximoFechamento.nome, diasRestantes: proximoFechamento.diasRestantes } : null,
  };
}

async function getApiTransacoes(mes, ano, cartao, pessoa, tipo) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
  const rows = res.data.values || [];
  const transacoes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    const rowMes = parseInt(partes[1]) - 1;
    const rowAno = parseInt(partes[2]);
    if (mes !== undefined && rowMes !== parseInt(mes)) return false;
    if (ano !== undefined && rowAno !== parseInt(ano)) return false;
    if (cartao && cartao !== "todos" && !(row[5] || "").toLowerCase().includes(cartao.toLowerCase())) return false;
    if (pessoa && pessoa !== "todos" && (row[6] || "") !== pessoa) return false;
    if (tipo && tipo !== "todos" && (row[7] || "").toLowerCase() !== tipo.toLowerCase()) return false;
    return true;
  }).map(row => ({
    data: row[0],
    valor: parseVal(row[1]),
    categoria: row[2] || "",
    descricao: row[3] || "",
    metodo: row[4] || "",
    cartao: row[5] || "",
    responsavel: row[6] || "",
    tipo: row[7] || "",
  })).reverse();
  return { transacoes, total: transacoes.reduce((acc, t) => acc + t.valor, 0) };
}

async function getApiRelatorio(meses) {
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();
  const n = parseInt(meses) || 6;
  const evolucao = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = (mesAtual - i + 12) % 12;
    const a = anoAtual - (mesAtual - i < 0 ? 1 : 0);
    const { porCategoria, total } = await getGastosPorMes(m, a);
    const nomeMes = new Date(a, m, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    evolucao.push({ mes: nomeMes, total, porCategoria });
  }
  const todasCategorias = [...new Set(evolucao.flatMap(e => Object.keys(e.porCategoria)))];
  const totalPorCategoria = {};
  todasCategorias.forEach(cat => {
    totalPorCategoria[cat] = evolucao.reduce((acc, e) => acc + (e.porCategoria[cat] || 0), 0);
  });
  const totalGeral = evolucao.reduce((acc, e) => acc + e.total, 0);
  const media = totalGeral / n;
  const maiorMes = evolucao.reduce((a, b) => b.total > a.total ? b : a, evolucao[0]);
  const categoriaLider = Object.entries(totalPorCategoria).sort((a, b) => b[1] - a[1])[0];
  return { evolucao, totalPorCategoria, totalGeral, media, maiorMes, categoriaLider, todasCategorias };
}

async function getResumoMes() {
  const agora = new Date();
  const { porCategoria, total } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());
  if (total === 0) return "📊 Nenhum gasto registrado este mês.";
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
  const rows = res.data.values || [];
  const mesAtual = agora.getMonth(), anoAtual = agora.getFullYear();
  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });
  const porPessoa = {}, porMetodo = {}, porCartao = {};
  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const metodo = row[4] || "não informado";
    const cartao = row[5] || "não informado";
    const val = parseVal(row[1]);
    if (isNaN(val)) return;
    porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
    porMetodo[metodo] = (porMetodo[metodo] || 0) + val;
    porCartao[cartao] = (porCartao[cartao] || 0) + val;
  });
  const budgets = await getBudgets();
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  let msg = `📊 Resumo de ${nomeMes}\n💰 Total: R$ ${formatarValor(total)}\n\n📂 Por categoria:\n`;
  Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, val]) => {
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
  Object.entries(porMetodo).sort((a, b) => b[1] - a[1]).forEach(([m, v]) => { msg += `• ${m}: R$ ${formatarValor(v)}\n`; });
  msg += `\n💳 Por cartão:\n`;
  Object.entries(porCartao).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => { msg += `• ${c}: R$ ${formatarValor(v)}\n`; });
  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa).sort((a, b) => b[1] - a[1]).forEach(([p, v]) => { msg += `• ${p}: R$ ${formatarValor(v)}\n`; });
  return msg;
}

async function getResumoCategoria(categoria) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
  const rows = res.data.values || [];
  const agora = new Date();
  const mesAtual = agora.getMonth(), anoAtual = agora.getFullYear();
  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0] || row[2]?.toLowerCase() !== categoria.toLowerCase()) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });
  if (gastosMes.length === 0) return `📂 Nenhum gasto em *${categoria}* este mês.`;
  const total = gastosMes.reduce((acc, row) => acc + parseVal(row[1]), 0);
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
  gastosMes.forEach(row => { msg += `• ${row[0]} — R$ ${formatarValor(parseVal(row[1]))} — ${row[3] || ""} (${row[6] || ""})\n`; });
  return msg;
}

async function getRelatorioSemana() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
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
  const total = gastosSemana.reduce((acc, row) => acc + parseVal(row[1]), 0);
  const porCategoria = {}, porPessoa = {};
  gastosSemana.forEach(row => {
    const cat = row[2] || "Outro";
    const pessoa = row[6] || "Desconhecido";
    const val = parseVal(row[1]);
    if (!isNaN(val)) {
      porCategoria[cat] = (porCategoria[cat] || 0) + val;
      porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
    }
  });
  let msg = `📅 Relatório semanal\n🗓️ ${dataInicioStr} a ${dataFimStr}\n💰 Total: R$ ${formatarValor(total)}\n\n📂 Por categoria:\n`;
  Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, val]) => { msg += `• ${cat}: R$ ${formatarValor(val)}\n`; });
  msg += `\n👤 Por pessoa:\n`;
  Object.entries(porPessoa).sort((a, b) => b[1] - a[1]).forEach(([p, v]) => { msg += `• ${p}: R$ ${formatarValor(v)}\n`; });
  return msg;
}

async function getFechamentoMes() {
  const agora = new Date();
  const { porCategoria, total } = await getGastosPorMes(agora.getMonth(), agora.getFullYear());
  if (total === 0) return "🏁 Nenhum gasto registrado este mês.";
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
  const rows = res.data.values || [];
  const mesAtual = agora.getMonth(), anoAtual = agora.getFullYear();
  const gastosMes = rows.slice(1).filter(row => {
    if (!row[0]) return false;
    const partes = row[0].split("/");
    if (partes.length < 3) return false;
    return parseInt(partes[1]) - 1 === mesAtual && parseInt(partes[2]) === anoAtual;
  });
  const porPessoa = {};
  gastosMes.forEach(row => {
    const pessoa = row[6] || "Desconhecido";
    const val = parseVal(row[1]);
    if (!isNaN(val)) porPessoa[pessoa] = (porPessoa[pessoa] || 0) + val;
  });
  const budgets = await getBudgets();
  const nomeMes = agora.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const score = calcularScore(porCategoria, budgets);
  let totalBudget = 0, categoriasEstouradas = [], categoriasDentro = [];
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
  let msg = `🏁 Fechamento de ${nomeMes}\n${"─".repeat(25)}\n💰 Total gasto: R$ ${formatarValor(total)}\n`;
  if (score !== null) msg += `⭐ Score financeiro: ${score}/10 — ${emojiScore(score)}\n`;
  if (totalBudget > 0) {
    const pctGeral = ((total / totalBudget) * 100).toFixed(0);
    const emojiGeral = total > totalBudget ? "🔴" : total / totalBudget >= 0.8 ? "🟡" : "🟢";
    msg += `${emojiGeral} Budget total: R$ ${formatarValor(totalBudget)} (${pctGeral}% utilizado)\n`;
  }
  msg += `\n📂 Por categoria:\n`;
  Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).forEach(([cat, val]) => {
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
  Object.entries(porPessoa).sort((a, b) => b[1] - a[1]).forEach(([p, v]) => {
    msg += `• ${p}: R$ ${formatarValor(v)} (${((v / total) * 100).toFixed(0)}% do total)\n`;
  });
  msg += `\n📌 Destaques:\n• Maior gasto: ${maiorGasto[0]} (R$ ${formatarValor(maiorGasto[1])})\n• Quem mais gastou: ${maiorGastante[0]} (R$ ${formatarValor(maiorGastante[1])})\n`;
  if (categoriasEstouradas.length > 0) msg += `• Categorias estouradas: ${categoriasEstouradas.join(", ")}\n`;
  if (categoriasDentro.length > 0) msg += `• Dentro do budget: ${categoriasDentro.join(", ")}\n`;
  msg += `\n💡 "Quem controla seus gastos, controla seu futuro."`;
  return msg;
}

async function getComparativo() {
  const agora = new Date();
  const mesAtual = agora.getMonth(), anoAtual = agora.getFullYear();
  const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
  const anoAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;
  const atual = await getGastosPorMes(mesAtual, anoAtual);
  const anterior = await getGastosPorMes(mesAnterior, anoAnterior);
  if (atual.total === 0 && anterior.total === 0) return "📈 Nenhum dado encontrado para comparar.";
  const nomeAtual = agora.toLocaleDateString("pt-BR", { month: "long" });
  const nomeAnterior = new Date(anoAnterior, mesAnterior, 1).toLocaleDateString("pt-BR", { month: "long" });
  const diffTotal = atual.total - anterior.total;
  const diffPct = anterior.total > 0 ? ((diffTotal / anterior.total) * 100).toFixed(0) : 0;
  const emojiTotal = diffTotal > 0 ? "📈" : diffTotal < 0 ? "📉" : "➡️";
  let msg = `📊 Comparativo: ${nomeAnterior} vs ${nomeAtual}\n${"─".repeat(25)}\n${emojiTotal} Total: R$ ${formatarValor(anterior.total)} → R$ ${formatarValor(atual.total)}\n   ${diffTotal >= 0 ? "+" : ""}R$ ${formatarValor(Math.abs(diffTotal))} (${diffTotal >= 0 ? "+" : ""}${diffPct}%)\n\n📂 Por categoria:\n`;
  const todas = new Set([...Object.keys(atual.porCategoria), ...Object.keys(anterior.porCategoria)]);
  Array.from(todas).sort().forEach(cat => {
    const va = atual.porCategoria[cat] || 0;
    const vb = anterior.porCategoria[cat] || 0;
    const diff = va - vb;
    msg += `${diff > 0 ? "📈" : diff < 0 ? "📉" : "➡️"} ${cat}: R$ ${formatarValor(vb)} → R$ ${formatarValor(va)}\n   (${diff >= 0 ? "+" : ""}R$ ${formatarValor(Math.abs(diff))})\n`;
  });
  msg += diffTotal < 0 ? `\n✅ Parabéns! Você gastou menos este mês.` : `\n⚠️ Você gastou mais este mês. Fique de olho!`;
  return msg;
}

async function getParcelasAbertas() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Parcelas!A:H" });
  const rows = res.data.values || [];
  if (rows.length <= 1) return "💳 Nenhuma parcela em aberto.";
  const abertas = rows.slice(1).filter(row => parseInt(row[6] || "0") > parseInt(row[7] || "0"));
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
    return acc + val * (parseInt(row[6] || "0") - parseInt(row[7] || "0"));
  }, 0);
  const porCartao = {};
  abertas.forEach(row => {
    const cartao = row[3] || "Outros";
    porCartao[cartao] = (porCartao[cartao] || 0) + parseFloat((row[1] || "0").replace(",", "."));
  });
  let msg = `💳 Parcelas em aberto (${abertas.length})\n📊 Total restante: R$ ${formatarValor(totalRestanteGeral)}\n\n💳 Por cartão (mensal):\n`;
  Object.entries(porCartao).sort((a, b) => b[1] - a[1]).forEach(([c, v]) => { msg += `• ${c}: R$ ${formatarValor(v)}\n`; });
  msg += `\n📅 Projeção:\n`;
  projecao.forEach(({ nomeMes, total }) => { msg += `• ${nomeMes}: R$ ${formatarValor(total)}\n`; });
  msg += `\n📋 Parcelas:\n`;
  abertas.forEach(row => {
    const restantes = parseInt(row[6] || "0") - parseInt(row[7] || "0");
    msg += `• ${row[0]} (${row[3] || ""}): R$ ${formatarValor(parseFloat((row[1] || "0").replace(",", ".")))} x${restantes}\n`;
  });
  return msg;
}

async function getUltimoLancamento(pessoa) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Gastos!A:H" });
  const rows = res.data.values || [];
  const lancamentos = rows.slice(1);
  for (let i = lancamentos.length - 1; i >= 0; i--) {
    if (lancamentos[i][6] === pessoa) {
      return { data: lancamentos[i][0], valor: lancamentos[i][1], categoria: lancamentos[i][2], descricao: lancamentos[i][3], metodo: lancamentos[i][4], cartao: lancamentos[i][5], linha: i + 2 };
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
    requestBody: { requests: [{ deleteDimension: { range: { sheetId: 0, dimension: "ROWS", startIndex: ultimo.linha - 1, endIndex: ultimo.linha } } }] }
  });
  return true;
}

module.exports = {
  getResumoMes, getResumoCategoria, getRelatorioSemana, getFechamentoMes, getComparativo,
  getParcelasAbertas, getFaturas, getApiResumo, getApiParcelas, getApiFaturas, getApiTransacoes,
  getApiRelatorio, getRitmo, getApiFechamentoMesAnterior, getUltimoLancamento, deletarUltimoLancamento,
  getApiReceitas, getApiFluxoCaixa,
};
