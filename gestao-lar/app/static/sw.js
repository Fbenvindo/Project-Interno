// Service worker: recebe as notificações push e abre o app no lugar certo ao tocar.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let dados = {};
  try {
    dados = e.data ? e.data.json() : {};
  } catch (_) {
    dados = { titulo: "Gestão do Lar", mensagem: e.data ? e.data.text() : "" };
  }
  e.waitUntil(self.registration.showNotification(dados.titulo || "Gestão do Lar", {
    body: dados.mensagem || "",
    tag: dados.tag,
    icon: "/icone-192.png",
    badge: "/icone-192.png",
    data: { link: dados.link || "" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = e.notification.data?.link || "";
  const url = link ? `/?abrir=${encodeURIComponent(link)}` : "/";
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const janela of janelas) {
      if (new URL(janela.url).origin === self.location.origin) {
        janela.postMessage({ abrir: link });
        return janela.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
