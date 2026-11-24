// Thread da análise de interferências (fora da thread do servidor, para a API seguir respondendo):
// lê a geometria de cada modelo (do cache, ou processa o IFC e grava o cache) e roda o motor.
const { parentPort, workerData } = require('worker_threads');
const { geometryOf } = require('./geometry');
const { runClash } = require('./engine');

const send = (m) => parentPort.postMessage(m);

(async () => {
  try {
    const { modelos, opts } = workerData;
    const models = [];
    for (let i = 0; i < modelos.length; i++) {
      const m = modelos[i];
      const base = (i / modelos.length) * 0.4;
      send({ tipo: 'progresso', fracao: base, mensagem: `Lendo ${m.codigo}` });
      const g = await geometryOf(m.ifcPath, m.cachePath, (n) => send({ tipo: 'progresso', fracao: base, mensagem: `Lendo ${m.codigo}: ${n.toLocaleString('pt-BR')} elementos` }));
      models.push({ ...g, docId: m.docId, codigo: m.codigo });
    }
    send({ tipo: 'progresso', fracao: 0.4, mensagem: 'Procurando interferências' });
    const r = runClash(models, opts, (f, msg) => send({ tipo: 'progresso', fracao: 0.4 + f * 0.6, mensagem: msg }));
    send({ tipo: 'fim', resultado: r });
  } catch (err) {
    send({ tipo: 'erro', mensagem: err?.message || String(err) });
  }
})();
