# Worker de Background (worker) — Python

Processamento server-side que roda **concorrentemente** com os acessos dos clientes,
consumindo filas RabbitMQ. Demonstra o requisito de processamento em background.

## Responsabilidades
- **Engine de mercado:** recalcula preços periodicamente conforme oferta/demanda.
- **Avaliação de coleções:** detecta sets formados e aplica bônus.
- **Efeitos do Mímico:** aplica penalidades de forma idempotente.
- **Reconciliação:** valida `balance` contra a soma do `ledger`; corrige divergências
  (consistência eventual).
- **Manutenção das regras:** expira caixas, repõe oferta.

## Entradas/Saídas
- Consome: `box.opened`, `item.sold`, `item.burned`, `ledger.entry`, `match.tick`.
- Publica de volta (Pub/Sub para clientes): `MARKET_UPDATED`, `COLLECTION_FORMED`.
- Contratos em [docs/07-contratos-api.md](../../docs/07-contratos-api.md).

## Estrutura sugerida
```
worker/
  worker/market.py        # engine de preços
  worker/collections.py   # avaliação de sets
  worker/reconcile.py     # ledger vs saldo
  worker/consumer.py      # loop RabbitMQ
  main.py
```

## Comandos
```bash
pip install -r requirements.txt
python main.py
```
