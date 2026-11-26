// Servidor do CDE sem a janela do Electron (desenvolvimento, ou rodar como serviço):
//   node server/standalone.js --dados C:\CDE --porta 4000 [--gestao http://localhost:3000]
// --gestao liga o servidor ao SmartEasyWEB (cofre de arquivos dos empreendimentos).
const path = require('path');
const { startServer } = require('./start');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

startServer({
  dataDir: path.resolve(arg('dados', process.env.CDE_DADOS || path.join(__dirname, '..', 'dados'))),
  port: Number(arg('porta', process.env.CDE_PORTA || 4000)),
})
  .then(async (s) => {
    console.log(`CDE no ar: ${s.urls.join('  ')}`);
    const g = arg('gestao', process.env.CDE_GESTAO);
    if (g) {
      try {
        const st = await s.gestao.link(g);
        console.log(`Ligado ao SmartEasyWEB ${st.url} (chave ${st.impressao})`);
      } catch (e) {
        console.error(`Não foi possível ligar ao SmartEasyWEB: ${e.message}`);
      }
    }
    const stop = () => s.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  })
  .catch((err) => {
    console.error(err.code === 'EADDRINUSE' ? 'Porta em uso: escolha outra com --porta.' : err);
    process.exit(1);
  });
