"use strict";

const TIPOS = {
  limpeza: "Limpeza", refeicao: "Refeição / receita", organizacao: "Organização", lavanderia: "Lavanderia",
  manutencao: "Manutenção", jardinagem: "Jardinagem", compras: "Compras", cuidados: "Cuidados", outro: "Outro",
};
const PERIODOS = { manha: "Manhã", tarde: "Tarde", noite: "Noite", qualquer: "Qualquer horário" };
const FREQUENCIAS = { unica: "Única", diaria: "Diária", semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" };
const STATUS = { pendente: "Pendente", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
const AVALIACOES = {
  aprovada: "Aprovada", revisar: "Revisar", reprovada: "Reprovada",
  foto_inadequada: "Foto inadequada", sem_referencia: "Sem referência",
};
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const conteudo = document.getElementById("conteudo");
const modal = document.getElementById("modal");
const modalCorpo = document.getElementById("modal-corpo");
let abaAtual = "hoje";
let inicioSemana = segunda(new Date());

// ---------- utilidades ----------

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function segunda(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

function somarDias(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function dataLonga(s) {
  return new Date(`${s}T00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function num(v) {
  return Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function avisar(texto, erro = false) {
  const el = document.getElementById("aviso");
  el.textContent = texto;
  el.className = erro ? "erro" : "";
  el.hidden = false;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => (el.hidden = true), 4000);
}

async function api(caminho, opcoes = {}) {
  const config = { ...opcoes };
  if (config.json !== undefined) {
    config.body = JSON.stringify(config.json);
    config.headers = { "Content-Type": "application/json" };
    delete config.json;
  }
  const resp = await fetch(caminho, config);
  if (!resp.ok) {
    let msg = `Erro ${resp.status}`;
    try {
      const corpo = await resp.json();
      msg = typeof corpo.detail === "string" ? corpo.detail : corpo.detail.map((d) => d.msg).join("; ");
    } catch (_) { /* resposta sem JSON */ }
    avisar(msg, true);
    throw new Error(msg);
  }
  return resp.status === 204 ? null : resp.json();
}

function abrirModal(html) {
  modalCorpo.innerHTML = `<button class="botao fechar" data-fechar>✕</button>${html}`;
  if (!modal.open) modal.showModal();
}

function fecharModal() {
  modal.close();
}

modal.addEventListener("click", (e) => {
  if (e.target === modal || e.target.closest("[data-fechar]")) fecharModal();
});

function selo(classe, texto) {
  return `<span class="selo ${esc(classe)}">${esc(texto)}</span>`;
}

function cartaoTarefa(t, mostrarData = false) {
  return `
    <div class="cartao clicavel" data-tarefa="${t.id}">
      <div class="linha">
        <strong>${esc(t.atividade.nome)}</strong>
        <span>${t.avaliacao ? selo(t.avaliacao, AVALIACOES[t.avaliacao]) : ""} ${selo(t.status, STATUS[t.status])}</span>
      </div>
      <div class="suave">
        ${mostrarData ? esc(dataLonga(t.data)) + " · " : ""}${esc(PERIODOS[t.periodo])} · ${esc(TIPOS[t.atividade.tipo])}
        ${t.atividade.duracao_min ? ` · ${t.atividade.duracao_min} min` : ""}
        · ${t.prestador ? esc(t.prestador.nome) : "sem prestador"}
      </div>
    </div>`;
}

conteudo.addEventListener("click", (e) => {
  const cartao = e.target.closest("[data-tarefa]");
  if (cartao) abrirTarefa(Number(cartao.dataset.tarefa));
});

// ---------- abas ----------

const telas = {
  hoje: telaHoje,
  cronograma: telaCronograma,
  atividades: telaAtividades,
  estoque: telaEstoque,
  prestadores: telaPrestadores,
};

document.getElementById("abas").addEventListener("click", (e) => {
  const botao = e.target.closest("button[data-aba]");
  if (!botao) return;
  abaAtual = botao.dataset.aba;
  document.querySelectorAll("#abas button").forEach((b) => b.classList.toggle("ativa", b === botao));
  atualizar();
});

function atualizar() {
  return telas[abaAtual]().catch((err) => console.error(err));
}

// ---------- Hoje ----------

async function telaHoje() {
  const hoje = iso(new Date());
  const [painel, tarefas] = await Promise.all([
    api("/api/painel"),
    api(`/api/cronograma?inicio=${hoje}&fim=${hoje}`),
  ]);
  const c = painel.tarefas_hoje;
  conteudo.innerHTML = `
    <h2>${esc(dataLonga(hoje))}</h2>
    <div class="grade">
      <div class="cartao"><div class="suave">Pendentes</div><div class="numero">${c.pendente}</div></div>
      <div class="cartao"><div class="suave">Em andamento</div><div class="numero">${c.em_andamento}</div></div>
      <div class="cartao"><div class="suave">Concluídas</div><div class="numero">${c.concluida}</div></div>
      <div class="cartao"><div class="suave">Estoque baixo</div><div class="numero">${painel.alertas_estoque.length}</div></div>
    </div>
    <h2>Tarefas de hoje</h2>
    ${tarefas.map((t) => cartaoTarefa(t)).join("") || `<div class="vazio">Nenhuma tarefa para hoje.</div>`}
    ${painel.atrasadas.length ? `<h2>Atrasadas</h2>${painel.atrasadas.map((t) => cartaoTarefa(t, true)).join("")}` : ""}
    ${painel.alertas_estoque.length ? `
      <h2>Estoque baixo</h2>
      ${painel.alertas_estoque.map((r) => `
        <div class="cartao linha"><span>${esc(r.nome)}</span>
          <span class="falta">${num(r.estoque_atual)} ${esc(r.unidade)} (mín. ${num(r.estoque_minimo)})</span></div>`).join("")}` : ""}
  `;
}

// ---------- Cronograma ----------

async function telaCronograma() {
  const fim = somarDias(inicioSemana, 6);
  const tarefas = await api(`/api/cronograma?inicio=${iso(inicioSemana)}&fim=${iso(fim)}`);
  const hoje = iso(new Date());
  const porDia = {};
  for (let i = 0; i < 7; i++) porDia[iso(somarDias(inicioSemana, i))] = [];
  tarefas.forEach((t) => porDia[t.data]?.push(t));

  conteudo.innerHTML = `
    <div class="cabecalho">
      <h2>Semana de ${inicioSemana.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}</h2>
      <div class="acoes" style="margin:0">
        <button class="botao" data-semana="-7">◀</button>
        <button class="botao" data-semana="0">Hoje</button>
        <button class="botao" data-semana="7">▶</button>
      </div>
    </div>
    <p class="suave">As tarefas são lançadas automaticamente conforme a frequência de cada atividade.</p>
    ${Object.entries(porDia).map(([dia, lista]) => `
      <div class="dia ${dia === hoje ? "hoje" : ""}">
        <h3>${esc(dataLonga(dia))}</h3>
        ${lista.map((t) => cartaoTarefa(t)).join("") || `<div class="suave">Sem tarefas</div>`}
      </div>`).join("")}
  `;
  conteudo.querySelectorAll("[data-semana]").forEach((b) => b.addEventListener("click", () => {
    const passo = Number(b.dataset.semana);
    inicioSemana = passo === 0 ? segunda(new Date()) : somarDias(inicioSemana, passo);
    telaCronograma();
  }));
}

// ---------- Execução da tarefa ----------

async function abrirTarefa(id) {
  const t = await api(`/api/tarefas/${id}`);
  const aberta = !["concluida", "cancelada"].includes(t.status);
  const a = t.analise;
  const prestadores = aberta ? await api("/api/prestadores?apenas_ativos=true") : [];

  abrirModal(`
    <h2>${esc(t.atividade.nome)}</h2>
    <p class="suave">${esc(dataLonga(t.data))} · ${esc(PERIODOS[t.periodo])} · ${esc(TIPOS[t.atividade.tipo])}
      ${t.atividade.duracao_min ? ` · ${t.atividade.duracao_min} min` : ""}</p>
    <p>${selo(t.status, STATUS[t.status])} ${t.avaliacao ? selo(t.avaliacao, AVALIACOES[t.avaliacao]) : ""}</p>

    <div class="campo">
      <label for="prestador-tarefa">Prestador</label>
      ${aberta ? `
        <select id="prestador-tarefa">
          <option value="">— sem prestador —</option>
          ${prestadores.map((p) => `<option value="${p.id}" ${t.prestador?.id === p.id ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}
        </select>` : `<div>${t.prestador ? esc(t.prestador.nome) : "—"}</div>`}
    </div>

    ${t.atividade.descricao ? `<p>${esc(t.atividade.descricao)}</p>` : ""}
    ${t.atividade.instrucoes ? `<h3>${t.atividade.tipo === "refeicao" ? "Modo de preparo" : "Instruções"}</h3>
      <p class="instrucoes">${esc(t.atividade.instrucoes)}</p>` : ""}

    <h3>${t.atividade.tipo === "refeicao" ? "Ingredientes" : "Materiais"}</h3>
    ${t.materiais.length ? `<ul class="materiais">${t.materiais.map((m) => `
      <li>${esc(m.nome)}: <strong>${num(m.quantidade)} ${esc(m.unidade)}</strong>
        <span class="${m.suficiente ? "suave" : "falta"}">(estoque: ${num(m.estoque_atual)} ${esc(m.unidade)}${m.suficiente ? "" : " — insuficiente"})</span>
      </li>`).join("")}</ul>` : `<p class="suave">Nenhum material cadastrado.</p>`}

    <h3>Registro fotográfico</h3>
    <div class="fotos">
      ${t.atividade.foto_referencia ? `<figure><img src="${esc(t.atividade.foto_referencia)}" alt="Referência"><figcaption>Referência (como deve ficar)</figcaption></figure>` : ""}
      ${t.foto ? `<figure><img src="${esc(t.foto)}" alt="Execução"><figcaption>Foto da execução</figcaption></figure>` : ""}
    </div>
    ${!t.atividade.foto_referencia ? `<p class="suave">Esta atividade ainda não tem foto de referência.</p>` : ""}
    ${a ? `
      <div class="cartao">
        <p><strong>${esc(AVALIACOES[a.avaliacao])}</strong>${a.nota != null ? ` · nota ${num(a.nota)}/100` : ""}</p>
        <p>${esc(a.mensagem)}</p>
        <table class="metricas">
          <tr><td>Nitidez</td><td>${num(a.qualidade.nitidez)}</td></tr>
          <tr><td>Brilho</td><td>${num(a.qualidade.brilho)}</td></tr>
          ${a.metricas ? `
          <tr><td>Semelhança estrutural</td><td>${num(a.metricas.estrutura * 100)}%</td></tr>
          <tr><td>Semelhança de cores</td><td>${num(a.metricas.cores * 100)}%</td></tr>
          <tr><td>Mesmo enquadramento</td><td>${num(a.metricas.enquadramento * 100)}%</td></tr>
          <tr><td>Índice de desordem</td><td>${num(a.metricas.desordem * 100)}%</td></tr>` : ""}
        </table>
      </div>` : ""}

    ${t.observacao ? `<p><strong>Observação:</strong> ${esc(t.observacao)}</p>` : ""}

    <div class="acoes">
      ${aberta && t.status === "pendente" ? `<button class="botao" data-acao="iniciar">Iniciar</button>` : ""}
      ${aberta ? `<label class="botao primario">📷 Tirar foto
        <input type="file" accept="image/*" capture="environment" id="foto-tarefa" hidden></label>` : ""}
      ${t.foto ? `<button class="botao" data-acao="referencia">Usar foto como referência</button>` : ""}
    </div>
    ${aberta ? `
      <div class="campo" style="margin-top:12px">
        <label for="obs-tarefa">Observação</label>
        <textarea id="obs-tarefa" placeholder="Opcional"></textarea>
      </div>
      <div class="acoes">
        <button class="botao primario" data-acao="concluir">Concluir e baixar estoque</button>
        <button class="botao perigo" data-acao="cancelar">Cancelar tarefa</button>
      </div>` : ""}
  `);

  const recarregar = () => { abrirTarefa(id); atualizar(); };

  modalCorpo.querySelector("#prestador-tarefa")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await api(`/api/tarefas/${id}/prestador/${e.target.value}`, { method: "POST" });
    avisar("Prestador atualizado.");
    atualizar();
  });

  modalCorpo.querySelector("#foto-tarefa")?.addEventListener("change", async (e) => {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const form = new FormData();
    form.append("foto", arquivo);
    avisar("Analisando a foto...");
    const r = await api(`/api/tarefas/${id}/foto`, { method: "POST", body: form });
    avisar(`Análise: ${AVALIACOES[r.avaliacao]}`);
    recarregar();
  });

  modalCorpo.querySelectorAll("[data-acao]").forEach((b) => b.addEventListener("click", async () => {
    const acao = b.dataset.acao;
    if (acao === "iniciar") await api(`/api/tarefas/${id}/iniciar`, { method: "POST" });
    if (acao === "referencia") {
      await api(`/api/tarefas/${id}/usar-como-referencia`, { method: "POST" });
      avisar("Foto definida como referência da atividade.");
    }
    if (acao === "cancelar") {
      if (!confirm("Cancelar esta tarefa?")) return;
      await api(`/api/tarefas/${id}/cancelar`, { method: "POST" });
    }
    if (acao === "concluir") {
      const r = await api(`/api/tarefas/${id}/concluir`, {
        method: "POST", json: { observacao: modalCorpo.querySelector("#obs-tarefa").value || null },
      });
      avisar(r.avisos.length ? r.avisos.join(" ") : "Tarefa concluída e estoque atualizado.", r.avisos.length > 0);
    }
    recarregar();
  }));
}

// ---------- Atividades ----------

async function telaAtividades() {
  const atividades = await api("/api/atividades");
  conteudo.innerHTML = `
    <div class="cabecalho">
      <h2>Atividades e receitas</h2>
      <button class="botao primario" id="nova-atividade">+ Nova atividade</button>
    </div>
    <p class="suave">Receitas são atividades do tipo "Refeição": os ingredientes são os materiais e o modo de preparo vai nas instruções.</p>
    ${atividades.map((a) => `
      <div class="cartao clicavel" data-atividade="${a.id}">
        <div class="linha">
          <strong>${esc(a.nome)}</strong>
          <span>${selo("", TIPOS[a.tipo])} ${a.ativa ? "" : selo("erro", "Inativa")}</span>
        </div>
        <div class="suave">${esc(descreverFrequencia(a))} · ${esc(PERIODOS[a.periodo])}
          · ${a.prestadores.map((p) => esc(p.nome)).join(", ") || "sem prestador"}
          · ${a.recursos.length} material(is) ${a.foto_referencia ? "· 📷 com referência" : ""}</div>
      </div>`).join("") || `<div class="vazio">Nenhuma atividade cadastrada.</div>`}
  `;
  document.getElementById("nova-atividade").addEventListener("click", () => formAtividade());
  conteudo.querySelectorAll("[data-atividade]").forEach((el) => el.addEventListener("click", () => {
    formAtividade(atividades.find((a) => a.id === Number(el.dataset.atividade)));
  }));
}

function descreverFrequencia(a) {
  const dias = a.dias_semana.map((d) => DIAS[d]).join(", ");
  if (a.frequencia === "mensal") return `Mensal, dia ${a.dia_mes || new Date(`${a.data_inicio}T00:00`).getDate()}`;
  if (a.frequencia === "unica") return `Única em ${new Date(`${a.data_inicio}T00:00`).toLocaleDateString("pt-BR")}`;
  return dias ? `${FREQUENCIAS[a.frequencia]} (${dias})` : FREQUENCIAS[a.frequencia];
}

function opcoes(mapa, atual) {
  return Object.entries(mapa).map(([v, t]) => `<option value="${v}" ${v === atual ? "selected" : ""}>${esc(t)}</option>`).join("");
}

async function formAtividade(a = null) {
  const [prestadores, recursos] = await Promise.all([api("/api/prestadores"), api("/api/recursos")]);
  a = a || {
    nome: "", tipo: "limpeza", descricao: "", instrucoes: "", periodo: "manha", duracao_min: null,
    frequencia: "semanal", dias_semana: [], dia_mes: null, data_inicio: iso(new Date()), data_fim: null,
    ativa: true, prestadores: [], recursos: [],
  };
  const linhaRecurso = (item = {}) => `
    <div class="item-recurso">
      <select name="recurso_id">
        <option value="">Selecione...</option>
        ${recursos.map((r) => `<option value="${r.id}" ${r.id === item.recurso_id ? "selected" : ""}>${esc(r.nome)} (${esc(r.unidade)})</option>`).join("")}
      </select>
      <input name="quantidade" type="number" step="any" min="0" placeholder="Qtd." value="${item.quantidade ?? ""}">
      <button type="button" class="botao" data-remover>✕</button>
    </div>`;

  abrirModal(`
    <h2>${a.id ? "Editar atividade" : "Nova atividade"}</h2>
    <form id="form-atividade">
      <div class="campo"><label>Nome</label><input name="nome" required value="${esc(a.nome)}"></div>
      <div class="campos">
        <div class="campo"><label>Tipo</label><select name="tipo">${opcoes(TIPOS, a.tipo)}</select></div>
        <div class="campo"><label>Período</label><select name="periodo">${opcoes(PERIODOS, a.periodo)}</select></div>
        <div class="campo"><label>Duração (min)</label><input name="duracao_min" type="number" min="0" value="${a.duracao_min ?? ""}"></div>
      </div>
      <div class="campos">
        <div class="campo"><label>Frequência</label><select name="frequencia">${opcoes(FREQUENCIAS, a.frequencia)}</select></div>
        <div class="campo"><label>Início</label><input name="data_inicio" type="date" required value="${esc(a.data_inicio)}"></div>
        <div class="campo"><label>Fim (opcional)</label><input name="data_fim" type="date" value="${esc(a.data_fim ?? "")}"></div>
      </div>
      <div class="campo" id="campo-dias">
        <label>Dias da semana</label>
        <div class="opcoes">${DIAS.map((d, i) => `
          <label><input type="checkbox" name="dias_semana" value="${i}" ${a.dias_semana.includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
        <span class="suave">Na frequência diária, deixe vazio para todos os dias.</span>
      </div>
      <div class="campo" id="campo-dia-mes"><label>Dia do mês</label>
        <input name="dia_mes" type="number" min="1" max="31" value="${a.dia_mes ?? ""}"></div>
      <div class="campo">
        <label>Prestadores (rodízio entre os selecionados)</label>
        <div class="opcoes">${prestadores.map((p) => `
          <label><input type="checkbox" name="prestador_ids" value="${p.id}" ${a.prestadores.some((x) => x.id === p.id) ? "checked" : ""}> ${esc(p.nome)}</label>`).join("") || `<span class="suave">Cadastre prestadores na aba Prestadores.</span>`}</div>
      </div>
      <div class="campo">
        <label>Materiais / ingredientes por execução</label>
        <div id="lista-recursos">${a.recursos.map(linhaRecurso).join("")}</div>
        <div><button type="button" class="botao" id="add-recurso">+ Adicionar material</button></div>
      </div>
      <div class="campo"><label>Descrição</label><textarea name="descricao">${esc(a.descricao)}</textarea></div>
      <div class="campo"><label>Instruções / modo de preparo</label><textarea name="instrucoes">${esc(a.instrucoes)}</textarea></div>
      <div class="campo opcoes"><label><input type="checkbox" name="ativa" ${a.ativa ? "checked" : ""}> Atividade ativa</label></div>
      ${a.id ? `
        <div class="campo">
          <label>Foto de referência (como o ambiente deve ficar)</label>
          ${a.foto_referencia ? `<div class="fotos"><img src="${esc(a.foto_referencia)}" alt="Referência"></div>` : ""}
          <input type="file" accept="image/*" capture="environment" id="foto-referencia">
        </div>` : ""}
      <div class="acoes">
        <button class="botao primario" type="submit">Salvar</button>
        ${a.id ? `<button class="botao perigo" type="button" id="excluir-atividade">Excluir</button>` : ""}
      </div>
    </form>
  `);

  const form = modalCorpo.querySelector("#form-atividade");
  const lista = form.querySelector("#lista-recursos");
  const ajustarCampos = () => {
    const f = form.frequencia.value;
    form.querySelector("#campo-dias").hidden = !["diaria", "semanal", "quinzenal"].includes(f);
    form.querySelector("#campo-dia-mes").hidden = f !== "mensal";
  };
  ajustarCampos();
  form.frequencia.addEventListener("change", ajustarCampos);
  form.querySelector("#add-recurso").addEventListener("click", () => lista.insertAdjacentHTML("beforeend", linhaRecurso()));
  lista.addEventListener("click", (e) => { if (e.target.closest("[data-remover]")) e.target.closest(".item-recurso").remove(); });

  form.querySelector("#foto-referencia")?.addEventListener("change", async (e) => {
    const dados = new FormData();
    dados.append("foto", e.target.files[0]);
    const atualizada = await api(`/api/atividades/${a.id}/referencia`, { method: "POST", body: dados });
    avisar("Foto de referência salva.");
    formAtividade(atualizada);
    atualizar();
  });

  form.querySelector("#excluir-atividade")?.addEventListener("click", async () => {
    if (!confirm("Excluir a atividade e todas as suas tarefas?")) return;
    await api(`/api/atividades/${a.id}`, { method: "DELETE" });
    fecharModal();
    atualizar();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const marcados = (nome) => [...form.querySelectorAll(`input[name="${nome}"]:checked`)].map((i) => Number(i.value));
    const corpo = {
      nome: form.nome.value.trim(),
      tipo: form.tipo.value,
      periodo: form.periodo.value,
      duracao_min: form.duracao_min.value ? Number(form.duracao_min.value) : null,
      frequencia: form.frequencia.value,
      data_inicio: form.data_inicio.value,
      data_fim: form.data_fim.value || null,
      dias_semana: marcados("dias_semana"),
      dia_mes: form.dia_mes.value ? Number(form.dia_mes.value) : null,
      prestador_ids: marcados("prestador_ids"),
      recursos: [...lista.querySelectorAll(".item-recurso")]
        .map((l) => ({ recurso_id: Number(l.querySelector("[name=recurso_id]").value), quantidade: Number(l.querySelector("[name=quantidade]").value) }))
        .filter((r) => r.recurso_id && r.quantidade > 0),
      descricao: form.descricao.value || null,
      instrucoes: form.instrucoes.value || null,
      ativa: form.ativa.checked,
    };
    await api(a.id ? `/api/atividades/${a.id}` : "/api/atividades", { method: a.id ? "PUT" : "POST", json: corpo });
    avisar("Atividade salva. Cronograma atualizado.");
    fecharModal();
    atualizar();
  });
}

// ---------- Estoque ----------

async function telaEstoque() {
  const [recursos, compras] = await Promise.all([api("/api/recursos"), api("/api/recursos/lista-compras?dias=7")]);
  const total = compras.reduce((s, i) => s + (i.custo_estimado || 0), 0);
  conteudo.innerHTML = `
    <div class="cabecalho">
      <h2>Recursos materiais</h2>
      <button class="botao primario" id="novo-recurso">+ Novo recurso</button>
    </div>
    ${recursos.map((r) => `
      <div class="cartao">
        <div class="linha">
          <div><strong>${esc(r.nome)}</strong> <span class="suave">· ${esc(r.categoria)}</span></div>
          <div><span class="${r.abaixo_minimo ? "falta" : ""}">${num(r.estoque_atual)} ${esc(r.unidade)}</span>
            <span class="suave">(mín. ${num(r.estoque_minimo)})</span></div>
        </div>
        <div class="acoes">
          <button class="botao" data-mov="entrada" data-id="${r.id}">+ Entrada</button>
          <button class="botao" data-mov="ajuste" data-id="${r.id}">Ajustar saldo</button>
          <button class="botao" data-editar="${r.id}">Editar</button>
          <button class="botao" data-historico="${r.id}">Histórico</button>
        </div>
      </div>`).join("") || `<div class="vazio">Nenhum recurso cadastrado.</div>`}

    <h2>Lista de compras (próximos 7 dias)</h2>
    <p class="suave">Consumo previsto nas tarefas agendadas + estoque mínimo − saldo atual.</p>
    ${compras.map((i) => `
      <div class="cartao linha">
        <span><strong>${esc(i.nome)}</strong> <span class="suave">· previsto ${num(i.consumo_previsto)} ${esc(i.unidade)}</span></span>
        <span>Comprar <strong>${num(i.comprar)} ${esc(i.unidade)}</strong>${i.custo_estimado ? ` · R$ ${num(i.custo_estimado)}` : ""}</span>
      </div>`).join("") || `<div class="vazio">Estoque suficiente para os próximos dias.</div>`}
    ${total ? `<p><strong>Total estimado: R$ ${num(total)}</strong></p>` : ""}
  `;

  document.getElementById("novo-recurso").addEventListener("click", () => formRecurso());
  conteudo.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () =>
    formRecurso(recursos.find((r) => r.id === Number(b.dataset.editar)))));
  conteudo.querySelectorAll("[data-mov]").forEach((b) => b.addEventListener("click", () =>
    formMovimento(recursos.find((r) => r.id === Number(b.dataset.id)), b.dataset.mov)));
  conteudo.querySelectorAll("[data-historico]").forEach((b) => b.addEventListener("click", () =>
    historico(recursos.find((r) => r.id === Number(b.dataset.historico)))));
}

function formRecurso(r = null) {
  r = r || { nome: "", categoria: "limpeza", unidade: "un", estoque_atual: 0, estoque_minimo: 0, custo_unitario: null, ativo: true };
  abrirModal(`
    <h2>${r.id ? "Editar recurso" : "Novo recurso"}</h2>
    <form id="form-recurso">
      <div class="campo"><label>Nome</label><input name="nome" required value="${esc(r.nome)}"></div>
      <div class="campos">
        <div class="campo"><label>Categoria</label><input name="categoria" list="categorias" value="${esc(r.categoria)}">
          <datalist id="categorias"><option>limpeza</option><option>alimento</option><option>lavanderia</option><option>higiene</option><option>jardim</option><option>utensílio</option></datalist></div>
        <div class="campo"><label>Unidade</label><input name="unidade" list="unidades" value="${esc(r.unidade)}">
          <datalist id="unidades"><option>un</option><option>g</option><option>kg</option><option>ml</option><option>L</option><option>pct</option></datalist></div>
      </div>
      <div class="campos">
        ${r.id ? "" : `<div class="campo"><label>Estoque inicial</label><input name="estoque_atual" type="number" step="any" min="0" value="0"></div>`}
        <div class="campo"><label>Estoque mínimo</label><input name="estoque_minimo" type="number" step="any" min="0" value="${r.estoque_minimo}"></div>
        <div class="campo"><label>Custo por unidade (R$)</label><input name="custo_unitario" type="number" step="any" min="0" value="${r.custo_unitario ?? ""}"></div>
      </div>
      <div class="campo opcoes"><label><input type="checkbox" name="ativo" ${r.ativo ? "checked" : ""}> Ativo</label></div>
      <div class="acoes">
        <button class="botao primario" type="submit">Salvar</button>
        ${r.id ? `<button class="botao perigo" type="button" id="excluir-recurso">Excluir</button>` : ""}
      </div>
    </form>
  `);
  const form = modalCorpo.querySelector("#form-recurso");
  form.querySelector("#excluir-recurso")?.addEventListener("click", async () => {
    if (!confirm("Excluir o recurso? Ele também sairá da composição das atividades.")) return;
    await api(`/api/recursos/${r.id}`, { method: "DELETE" });
    fecharModal();
    atualizar();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const corpo = {
      nome: form.nome.value.trim(),
      categoria: form.categoria.value.trim() || "geral",
      unidade: form.unidade.value.trim() || "un",
      estoque_minimo: Number(form.estoque_minimo.value || 0),
      custo_unitario: form.custo_unitario.value ? Number(form.custo_unitario.value) : null,
      ativo: form.ativo.checked,
    };
    if (!r.id) corpo.estoque_atual = Number(form.estoque_atual.value || 0);
    await api(r.id ? `/api/recursos/${r.id}` : "/api/recursos", { method: r.id ? "PUT" : "POST", json: corpo });
    fecharModal();
    atualizar();
  });
}

function formMovimento(r, tipo) {
  abrirModal(`
    <h2>${tipo === "entrada" ? "Entrada" : "Ajuste de saldo"}: ${esc(r.nome)}</h2>
    <p class="suave">Saldo atual: ${num(r.estoque_atual)} ${esc(r.unidade)}</p>
    <form id="form-mov">
      <div class="campo"><label>${tipo === "entrada" ? "Quantidade comprada" : "Novo saldo (contagem)"} (${esc(r.unidade)})</label>
        <input name="quantidade" type="number" step="any" min="0" required></div>
      <div class="campo"><label>Observação</label><input name="observacao"></div>
      <div class="acoes"><button class="botao primario" type="submit">Registrar</button></div>
    </form>
  `);
  modalCorpo.querySelector("#form-mov").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    await api(`/api/recursos/${r.id}/movimentos`, {
      method: "POST", json: { tipo, quantidade: Number(f.quantidade.value), observacao: f.observacao.value || null },
    });
    fecharModal();
    atualizar();
  });
}

async function historico(r) {
  const movimentos = await api(`/api/recursos/${r.id}/movimentos`);
  abrirModal(`
    <h2>Histórico: ${esc(r.nome)}</h2>
    ${movimentos.map((m) => `
      <div class="cartao linha">
        <span>${new Date(m.criado_em).toLocaleString("pt-BR")} · ${esc(m.tipo)}<br><span class="suave">${esc(m.observacao)}</span></span>
        <strong class="${m.quantidade < 0 ? "falta" : ""}">${m.quantidade > 0 ? "+" : ""}${num(m.quantidade)} ${esc(r.unidade)}</strong>
      </div>`).join("") || `<div class="vazio">Sem movimentos.</div>`}
  `);
}

// ---------- Prestadores ----------

async function telaPrestadores() {
  const prestadores = await api("/api/prestadores");
  conteudo.innerHTML = `
    <div class="cabecalho">
      <h2>Prestadores</h2>
      <button class="botao primario" id="novo-prestador">+ Novo prestador</button>
    </div>
    ${prestadores.map((p) => `
      <div class="cartao clicavel" data-prestador="${p.id}">
        <div class="linha"><strong>${esc(p.nome)}</strong> ${p.ativo ? "" : selo("erro", "Inativo")}</div>
        <div class="suave">${esc(p.funcao || "—")} · ${esc(p.telefone || "sem telefone")}${p.custo_hora ? ` · R$ ${num(p.custo_hora)}/h` : ""}</div>
      </div>`).join("") || `<div class="vazio">Nenhum prestador cadastrado.</div>`}
  `;
  document.getElementById("novo-prestador").addEventListener("click", () => formPrestador());
  conteudo.querySelectorAll("[data-prestador]").forEach((el) => el.addEventListener("click", () =>
    formPrestador(prestadores.find((p) => p.id === Number(el.dataset.prestador)))));
}

function formPrestador(p = null) {
  p = p || { nome: "", funcao: "", telefone: "", custo_hora: null, ativo: true };
  abrirModal(`
    <h2>${p.id ? "Editar prestador" : "Novo prestador"}</h2>
    <form id="form-prestador">
      <div class="campo"><label>Nome</label><input name="nome" required value="${esc(p.nome)}"></div>
      <div class="campos">
        <div class="campo"><label>Função</label><input name="funcao" value="${esc(p.funcao)}" placeholder="Diarista, cozinheiro..."></div>
        <div class="campo"><label>Telefone</label><input name="telefone" value="${esc(p.telefone)}"></div>
        <div class="campo"><label>Valor/hora (R$)</label><input name="custo_hora" type="number" step="any" min="0" value="${p.custo_hora ?? ""}"></div>
      </div>
      <div class="campo opcoes"><label><input type="checkbox" name="ativo" ${p.ativo ? "checked" : ""}> Ativo</label></div>
      <div class="acoes">
        <button class="botao primario" type="submit">Salvar</button>
        ${p.id ? `<button class="botao perigo" type="button" id="excluir-prestador">Excluir</button>` : ""}
      </div>
    </form>
  `);
  const form = modalCorpo.querySelector("#form-prestador");
  form.querySelector("#excluir-prestador")?.addEventListener("click", async () => {
    if (!confirm("Excluir o prestador?")) return;
    await api(`/api/prestadores/${p.id}`, { method: "DELETE" });
    fecharModal();
    atualizar();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const corpo = {
      nome: form.nome.value.trim(),
      funcao: form.funcao.value || null,
      telefone: form.telefone.value || null,
      custo_hora: form.custo_hora.value ? Number(form.custo_hora.value) : null,
      ativo: form.ativo.checked,
    };
    await api(p.id ? `/api/prestadores/${p.id}` : "/api/prestadores", { method: p.id ? "PUT" : "POST", json: corpo });
    fecharModal();
    atualizar();
  });
}

atualizar();
