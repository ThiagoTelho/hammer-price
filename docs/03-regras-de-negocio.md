# 03 — Regras de Negócio

> Parâmetros e fórmulas. **Todos os números aqui são valores iniciais para balanceamento**
> — devem ser ajustados em playtests e ficam centralizados em um arquivo de configuração
> (`infra/config/balance.yaml`) para não exigir recompilação.

## 1. Itens e valores base

| Item | Código | Valor base | Raridade alvo |
|---|---|---|---|
| Cobre | `COPPER` | 10 | comum |
| Prata | `SILVER` | 30 | incomum |
| Ouro | `GOLD` | 100 | raro |
| Diamante | `DIAMOND` | 300 | muito raro |
| Mímico | `MIMIC` | — (penalidade) | armadilha |

O **valor base** é a referência; o **preço de mercado** (seção 6) flutua em torno dele.

## 2. Orçamento e partida

| Parâmetro | Valor inicial |
|---|---|
| Orçamento inicial por jogador | 1.000 |
| Duração da partida | 15 min |
| Jogadores por sala | 2–6 |
| Mínimo de jogadores para iniciar a partida | 2 |
| Estrutura da partida | **rodadas** sequenciais até o tempo acabar |
| Caixas por rodada | **1** (uma caixa por vez; tipo sorteado aleatoriamente) |
| Pausa entre rodadas | 3 s (abertura do vencedor + anúncio da próxima) |
| Incremento mínimo de lance | 5% do lance atual (mín. 5) |
| Cronômetro do leilão | 20 s — **começa só no 1º lance** (antes disso o lote aguarda interesse) |
| Janela sem lances | 45 s — sem nenhum lance até aqui, o lote fecha **sem vencedor** e a partida segue |
| Janela anti-sniping | lance nos últimos 5 s → cronômetro volta a 8 s |

## 3. Caixas e probabilidades (odds)

Cada **tipo de caixa** define uma distribuição de drop. A soma é sempre 100%. A cada
**rodada**, o servidor **sorteia o tipo** da caixa — os 4 tipos têm **probabilidade igual
de aparecer** (pesos `25/25/25/25` em `balance.yaml`); as odds do tipo sorteado são
**públicas** — exibidas aos jogadores antes
e durante o leilão, e devem ser **iguais** às realmente aplicadas na abertura (ver §4).

Os nomes dos baús são **distintos dos materiais** (Cobre/Prata/Ouro/Diamante) para evitar confusão:

| Baú (código) | Cobre | Prata | Ouro | Diamante | Mímico |
|---|---:|---:|---:|---:|---:|
| Madeira (`WOODEN`) | 60% | 30% | 9% | 1% | 0% |
| Ferro (`IRON`) | 35% | 40% | 20% | 4% | 1% |
| Real (`ROYAL`) | 15% | 30% | 40% | 12% | 3% |
| Cofre (`VAULT`) | 5% | 15% | 35% | 40% | 5% |

> Caixas mais ricas concentram mais valor **e** mais risco de Mímico — o EV alto vem
> acompanhado de perigo (decisão de risco estilo "fold equity").

### Valor esperado (EV) de uma caixa
```
EV(caixa) = Σ  P(item) × preço_mercado(item)   −  P(Mímico) × penalidade_média_mímico
        para item ∈ {Cobre, Prata, Ouro, Diamante}
```
Exemplo (Baú de Madeira, preços = valores base, penalidade do Mímico = 0 aqui):
```
EV = 0,60·10 + 0,30·30 + 0,09·100 + 0,01·300 = 6 + 9 + 9 + 3 = 27
```
→ Lance racional "frio" ≈ 27. Jogadores perto de fechar uma coleção têm **EV pessoal**
maior e tendem a sobre-apostar (ver seção 5).

## 4. Abertura de caixa (RNG + afinidade)

A probabilidade efetiva de cada item, para um jogador `j` abrindo uma caixa `c`:

```
P_efetiva(item) = normalizar( P_base(c, item) + afinidade(j, item) )
```
- `afinidade(j, item) ≥ 0`, com **teto** por item (ver seção 5).
- `normalizar(...)` reescala o vetor para somar 100% (o Mímico também é renormalizado).
- O sorteio usa um **RNG com seed injetável** (testes determinísticos) e roda **no
  servidor** (cliente nunca sorteia).
- **Invariante:** a soma de `P_efetiva` é exatamente 1; nenhuma probabilidade é negativa.

### Mímico (penalidade)
Ao sair `MIMIC`, aplica-se **uma** penalidade sorteada:
- Roubar X% do dinheiro do jogador (ex.: 10%), **ou**
- Roubar um item aleatório do inventário, **ou**
- Anular o bônus de uma coleção já formada.

O **seguro** (seção 7) reduz a penalidade.

## 5. Coleções e afinidade

### Coleções (bônus no patrimônio final)

| Coleção | Código | Requisito | Bônus |
|---|---|---|---:|
| Trinca de Cobre | `COPPER_TRIO` | 3× Cobre | +70 |
| Trio de Prata | `SILVER_SET` | 3× Prata | +230 |
| Liga Metálica | `ALLOY` | 2× Cobre + 2× Prata | +220 |
| Prata & Ouro | `SILVER_GOLD` | 2× Prata + 1× Ouro | +400 |
| Trinca de Ouro | `GOLD_TRIO` | 3× Ouro | +720 |
| Arco-íris | `RAINBOW` | 1×Cobre +1×Prata +1×Ouro +1×Diamante | +1.100 |
| Par de Diamantes | `DIAMOND_PAIR` | 2× Diamante | +1.500 |
| Realeza | `ROYAL_FLUSH` | 1× Prata + 1× Ouro + 2× Diamante | +2.000 |
| Cofre Lendário | `LEGENDARY_VAULT` | 5× Diamante | +5.000 |

> Bônus calibrado em **~2–3× o valor de mercado** dos itens consumidos: formar uma coleção
> rende mais que vender as peças soltas.

- Itens "consumidos" por uma coleção ficam **travados** (não podem ser vendidos/queimados).
- Uma coleção é avaliada uma vez; itens excedentes podem formar outra do mesmo tipo.

### Afinidade

| Parâmetro | Valor inicial |
|---|---|
| Ganho de afinidade por item queimado | +2 pontos percentuais |
| Custo (queimar) | o próprio item + taxa crescente |
| Custo marginal | dobra a cada 3 pontos acumulados no mesmo item |
| Teto de afinidade por item | +15 pontos percentuais |

**Invariante:** afinidade nunca ultrapassa o teto; queima rejeitada se exceder.

## 6. Mercado dinâmico

Preço de revenda de cada item é recalculado periodicamente (worker em background, ex.:
a cada 5 s) com base na **escassez relativa** na partida:

```
preço(item) = valor_base(item) × clamp( 1 + k · (oferta_alvo − oferta_atual)/oferta_alvo,
                                         piso, teto )
```
- `oferta_atual` = quantos desses itens estão "no mercado/inventários" agora.
- `k` = sensibilidade (ex.: 0,5); `piso=0,4`, `teto=1,8`.
- Vender muito do mesmo item derruba seu preço (oferta sobe). Recompensa contrarianismo.
- **Consistência:** o preço é estado compartilhado; leituras podem ser **eventuais**
  (cache replicado), mas a venda (débito/crédito) é **forte** (transação na carteira).

## 7. Seguro

| Parâmetro | Valor inicial |
|---|---|
| Custo do seguro | 20% do lance da caixa |
| Redução da penalidade do Mímico | 70% |
| Validade | apenas a abertura imediatamente seguinte |

## 8. Patrimônio final

```
patrimônio(j) = dinheiro(j)
              + Σ preço_mercado_final(item) para item livre no inventário
              + Σ bônus(coleção) para coleções formadas por j
```
Reservas de leilões não concluídos são **devolvidas** antes do cálculo. Maior patrimônio
vence; empate desfeito por **quantidade de coleções**, depois por **patrimônio em itens**.

## 9. Invariantes globais (devem ser garantidas pelo código)

1. `saldo(j) ≥ 0` sempre — soma das reservas ativas nunca excede o saldo.
2. Um item está em **exatamente um** estado: livre, reservado-para-coleção, ou consumido.
   Nunca vendido e colecionado ao mesmo tempo.
3. Para toda caixa: `Σ P_efetiva = 1`, `P_efetiva(item) ≥ 0`.
4. O vencedor de uma caixa é o **último lance válido** antes de o cronômetro zerar,
   desempatado pelo **timestamp do servidor** (não do cliente).
5. Toda alteração de dinheiro tem registro no **ledger** (auditável; base da reconciliação).
6. `afinidade(j, item) ≤ teto`.
