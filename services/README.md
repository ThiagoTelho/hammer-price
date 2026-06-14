# Serviços

Cada subpasta é um componente distribuído do Hammer Price. Veja a
[arquitetura](../docs/04-arquitetura.md) para o panorama.

| Pasta | Linguagem | Papel | Paradigma principal |
|---|---|---|---|
| `frontend/` | TypeScript (React) | Cliente web | cliente-servidor (WS/REST) |
| `gateway/` | TypeScript (Node) | Conexões WS + fan-out + tradução gRPC | pub-sub + cliente-servidor |
| `auction/` | Java (Maven) | Leilão: lances, timers, RNG (particionado por vault) | cliente-servidor (gRPC) |
| `wallet/` | Java (Maven) | Carteira/inventário, consistência forte (particionado por jogador) | cliente-servidor (gRPC) |
| `worker/` | Python | Background: mercado, coleções, reconciliação | messaging (RabbitMQ) |

Cada serviço deve trazer seu próprio `README.md`, `Dockerfile` e testes. Os contratos
entre eles estão em [docs/07-contratos-api.md](../docs/07-contratos-api.md) — **atualize o
contrato antes do código**.
