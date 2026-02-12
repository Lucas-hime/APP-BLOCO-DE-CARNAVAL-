# Blocos RJ 🎭

PWA mobile-first para encontrar blocos de carnaval no Rio de Janeiro por localização.

## Rodar localmente

Como é um projeto 100% client-side, basta abrir com servidor estático:

```bash
python3 -m http.server 8000
```

Depois acesse `http://localhost:8000`.

## Deploy no GitHub Pages (passo a passo)

1. Crie um repositório no GitHub e envie estes arquivos para a branch `main`.
2. No repositório, abra **Settings → Pages**.
3. Em **Build and deployment**, selecione **Deploy from a branch**.
4. Em **Branch**, escolha `main` e pasta `/ (root)`.
5. Clique em **Save**.
6. Aguarde o deploy (normalmente 1–3 minutos).
7. Abra a URL publicada pelo GitHub Pages (ex.: `https://seu-usuario.github.io/seu-repo/`).
8. No celular, abra a URL e use **Adicionar à tela inicial** para instalar o PWA.

## Estrutura

- `index.html` — layout e seções da interface.
- `style.css` — tema dark, glassmorphism e botões em gradiente.
- `app.js` — geolocalização, clima, filtros de blocos, compartilhamento e cache local.
- `blocos.csv` — base de blocos de exemplo.
- `metro_stations.json` — estações de metrô para cálculo do ponto mais próximo do bloco.
- `manifest.json` e `service-worker.js` — recursos PWA/offline.
