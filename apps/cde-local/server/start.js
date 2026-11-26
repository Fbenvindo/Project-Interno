// Liga o servidor do CDE numa porta (todas as interfaces de rede) e lista os endereços da máquina.
const os = require('os');
const { createApp } = require('./app');

/** Endereços IPv4 da máquina na rede (para os colegas acessarem). */
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

async function startServer({ dataDir, port = 4000, host = '0.0.0.0', webDir }) {
  const { app, db, clash, gestao, clashV2 } = await createApp({ dataDir, webDir });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, host, () => resolve(s));
    s.on('error', reject);
  });
  const actualPort = server.address().port;
  return {
    port: actualPort,
    db,
    gestao,
    urls: [`http://localhost:${actualPort}`, ...lanAddresses().map((a) => `http://${a}:${actualPort}`)],
    hostUrl: `http://${os.hostname()}:${actualPort}`,
    close: async () => {
      await clash.stop();
      await clashV2.stop();
      return new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
}

module.exports = { startServer, lanAddresses };
