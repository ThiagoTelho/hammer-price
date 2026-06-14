# Gateway de Tempo-Real (gateway) — Node.js + TypeScript

Ponte entre os clientes e os serviços. **Stateless** (replicável atrás de um load balancer).

## Responsabilidades
- Manter as conexões **WebSocket** dos jogadores (I/O assíncrono).
- **Fan-out:** assinar canais Redis Pub/Sub e empurrar eventos aos clientes.
- **Tradução de paradigma:** ação do cliente → chamada **gRPC síncrona** ao serviço dono
  (Leilão/Carteira); devolve a confirmação a quem pediu.
- Endpoints REST de entrada (criar/entrar em sala, snapshot, ranking).

## Não faz
- Não é autoridade de estado de jogo (isso é do Leilão/Carteira). Não guarda saldo.

## Estrutura sugerida
```
gateway/
  src/ws/          # servidor WebSocket + roteamento de mensagens
  src/grpc/        # clientes gRPC para auction e wallet
  src/pubsub/      # assinatura Redis + fan-out
  src/rest/        # rotas REST
  src/index.ts
```

## Comandos
```bash
npm install
npm run dev
```
