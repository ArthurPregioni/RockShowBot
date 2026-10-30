/* Apple's hosted SDK handles login. No account password or token goes in URLs. */
(() => {
  const button = document.getElementById("apple-authorize");
  const status = document.getElementById("apple-status");
  let music;
  let initialized = false;

  async function initialize() {
    if (initialized) return;
    initialized = true;
    try {
      const response = await fetch("/apple-music/config", { credentials: "same-origin", cache: "no-store" });
      const config = await response.json();
      if (!response.ok) throw new Error(config.error || "Não foi possível preparar a conexão Apple Music.");
      await MusicKit.configure({ developerToken: config.developerToken, app: { name: "RockShowBot", build: "0.3" } });
      music = MusicKit.getInstance();
      button.disabled = false;
      status.textContent = "Pronto. Autorize a leitura da sua biblioteca para escolher os artistas.";
    } catch (error) {
      status.textContent = error.message || "Falha ao carregar o MusicKit. Reabra a conexão.";
    }
  }

  document.addEventListener("musickitloaded", initialize);
  if (window.MusicKit) initialize();
  window.addEventListener("error", (event) => {
    if (event.target && event.target.id === "musickit-sdk") {
      status.textContent = "Não foi possível carregar o MusicKit da Apple. Confira a conexão e tente novamente.";
    }
  }, true);

  button.addEventListener("click", async () => {
    button.disabled = true;
    let token;
    let ready = false;
    try {
      // Call directly from the click so the browser permits Apple's login window.
      token = await music.authorize();
      if (!token) throw new Error("Autorização cancelada. Você pode tentar novamente.");
      status.textContent = "Consultando os artistas da sua biblioteca…";
      const response = await fetch("/apple-music/library", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ music_user_token: token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível consultar a biblioteca.");
      ready = true;
    } catch (error) {
      status.textContent = error.message || "Apple Music não autorizou a conexão. Confira sua assinatura e tente novamente.";
      // A server-side failure consumes the session: restarting creates a fresh one.
      status.textContent += " Use Voltar e conecte novamente se necessário.";
      button.disabled = false;
    } finally {
      token = undefined;
      if (music) {
        try { await music.unauthorize(); } catch { /* No token is retained by this app. */ }
      }
    }
    if (ready) window.location.assign("/apple-music/artists");
  });
})();
