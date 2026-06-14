# Cliente Web (frontend) — React + TypeScript

SPA que renderiza o estado compartilhado do leilão e envia ações do jogador.

## Responsabilidades
- Conectar ao gateway por **WebSocket** (estado/eventos em tempo real) e **REST** (entrar
  na sala, snapshot inicial, ranking).
- Telas: lobby/sala, mesa de leilão (caixas + odds + cronômetro + lance atual),
  inventário/coleções, mercado, ranking final.
- Refletir confirmações síncronas (lance aceito/rejeitado) e eventos assíncronos
  (broadcast de lances, aberturas, mercado).

## Stack
- React + TypeScript, build com Vite. Canvas/HTML para a mesa de leilão.

## Estrutura sugerida
```
frontend/
  src/components/   # AuctionTable, BoxCard, Inventory, Market, Leaderboard
  src/net/          # cliente WS + REST
  src/state/        # store do estado de jogo
  src/main.tsx
```

## Comandos
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gera dist/ para deploy (S3+CloudFront)
```
