# 02 — Regras do Jogo

> Visão do **jogador**. As fórmulas e parâmetros numéricos estão em
> [03 — Regras de Negócio](03-regras-de-negocio.md).

## Objetivo

Terminar a partida com o **maior patrimônio líquido**:

```
patrimônio = dinheiro + valor de mercado dos itens no inventário + bônus de coleções
```

## Estrutura de uma partida

### Criar ou entrar numa sala

- Qualquer jogador pode **criar uma sala** para uma nova partida. Quem cria é o **host**
  e recebe um **código de sala** curto (ex.: `4F2K9`) para compartilhar.
- Os outros jogadores **entram digitando esse código**.
- A sala fica em **espera (lobby)** até a partida começar; todos veem quem já entrou. É
  preciso **no mínimo 2 jogadores** (e no máximo 6) — com o mínimo presente, o host
  **inicia a partida**.
- Ao iniciar, o cronômetro de tempo fixo começa e a **primeira rodada** entra em leilão.

### A partida em si

- Uma partida acontece em uma **sala** com **tempo fixo** (sugestão: 15 minutos) e se
  desenrola em **rodadas** sequenciais.
- Cada jogador começa com um **orçamento inicial** igual.
- **Em cada rodada, o servidor coloca UMA caixa misteriosa em leilão**, com o **tipo
  sorteado aleatoriamente** (logo, odds diferentes a cada rodada). Toda a sala disputa
  essa mesma caixa por lances. Quando o cronômetro zera, o último lance válido arremata;
  o vencedor paga, abre a caixa, e **a próxima rodada começa** com uma nova caixa
  aleatória. (Se ninguém der lance dentro do tempo-base, a rodada encerra sem vencedor e
  a próxima começa.)
- Ao fim do tempo, calcula-se o patrimônio de cada um e fecha-se o ranking.

## Os itens

Cinco tipos, do mais comum ao mais raro:

| Item | Ícone | Papel |
|---|---|---|
| Cobre | 🪙 | Base; abundante; vale pouco isolado |
| Prata | 🥈 | Intermediário |
| Ouro | 🥇 | Valioso |
| Diamante | 💎 | Raro; alto valor; alvo das melhores coleções |
| Mímico | 💀 | **Armadilha**: ao sair, causa perda (rouba dinheiro/item ou anula bônus) |

## Caixas misteriosas

A cada rodada entra **uma** caixa, cujo **tipo é sorteado** (e com ele as odds). A caixa
da rodada mostra, **publicamente**:

- A **probabilidade** de conter cada tipo de item (a soma é sempre 100%).
- O **lance atual** e quem está ganhando.
- O **cronômetro** restante.

Com as odds e os valores dos itens (também públicos), o jogador estima o **valor
esperado (EV)** da caixa e decide quanto vale apostar.

## Ações do jogador

### 1. Dar lance (síncrono / bloqueante)
- Incrementa o preço da caixa (acima do lance atual + incremento mínimo).
- O valor é **reservado** do seu saldo (não pode reservar além do que tem, somando todas
  as caixas em que está ganhando).
- A resposta é imediata: **aceito** ou **rejeitado** (saldo insuficiente / já superado).
- O **cronômetro do leilão (20 s) começa só no 1º lance** — antes disso o lote fica aberto
  aguardando interesse. Se ninguém der lance dentro de uma janela maior (45 s), o lote fecha
  **sem vencedor** e a partida segue (não trava).
- Cada lance **reseta o cronômetro** da caixa (mecânica "dou-lhe uma, dou-lhe duas").
- **Anti-sniping:** lances nos segundos finais estendem levemente o cronômetro, para
  evitar vitória puramente por latência de rede.

### 2. Arrematar e abrir caixa
- Quando o cronômetro zera, o último lance válido **arremata**. O valor reservado é
  debitado de fato.
- Quem perdeu o lance tem o valor reservado **devolvido** ao saldo (assíncrono).
- O arrematante **abre** a caixa: o servidor sorteia um item conforme as odds, ajustadas
  pela **afinidade** do jogador. O resultado é notificado a todos.

### 3. Gerir o inventário
Cada item obtido pode ser:
- **Guardado** — para fechar **coleções** (ver abaixo).
- **Vendido** no mercado — vira dinheiro pelo **preço atual de mercado** (que flutua).
- **Queimado** — destrói o item e aumenta sua **afinidade** por um tipo escolhido
  (mais chance daquele item nas próximas aberturas), com custo marginal crescente.

### 4. Comprar seguro (opcional)
- Antes de abrir uma caixa de alto risco, o jogador pode pagar um **seguro** que mitiga
  o dano caso saia o Mímico.

## Coleções (as "mãos")

Guardar itens permite fechar **coleções**, que valem **bônus** no patrimônio final.
Exemplos (valores em [03 — Regras de Negócio](03-regras-de-negocio.md)):

| Coleção | Requisito | Recompensa |
|---|---|---|
| Liga Comum | 5× Cobre | Bônus pequeno |
| Dupla Nobre | 3× Ouro | Bônus médio |
| Arco-íris | 1 de cada (Cobre+Prata+Ouro+Diamante) | Bônus médio-alto |
| Trinca Real | 3× Diamante | Bônus alto |
| Cofre Lendário | 5× Diamante | Bônus máximo |

O dilema central: **guardar** o item para a coleção, **vender** por dinheiro imediato, ou
**queimar** para melhorar a sorte futura? Cada peça é uma decisão.

## Afinidade (sorte controlável)

- Cada jogador tem uma **afinidade** por tipo de item, que **soma** à probabilidade base
  das caixas na hora de abrir (respeitando o teto e renormalizando para 100%).
- Aumenta-se a afinidade **queimando** itens, com **custo marginal crescente** e **teto**
  — para impedir a estratégia degenerada de "quem queima mais, ganha".
- É uma aposta de longo prazo: investir em virar especialista em Diamante agora pode
  pagar muito depois — ou ser desperdício se a partida acabar antes.

## Mercado dinâmico

- O **preço de revenda** de cada item flutua conforme oferta e demanda da partida.
- Se muitos jogadores acumulam Diamante, o preço de revenda do Diamante **cai**.
- Recompensa o contrarianismo e pune estratégias óbvias. Atualizado pelo servidor em
  background.

## Informação e leitura de adversários (o lado "pôquer")

- O **histórico de lances** é **público**: dá para inferir o que cada um persegue.
- O **inventário dos adversários** é **parcialmente** visível (ex.: só a quantidade total
  de itens, não a composição exata).
- Assim, um jogador que sobre-aposta numa caixa rica em Diamante "entrega" que está perto
  de fechar a Trinca Real — e os outros podem **contra-atacar para negar** a caixa.

## Condição de vitória

Ao fim do tempo:

1. Devolvem-se reservas de leilões não concluídos.
2. Avaliam-se as coleções (bônus).
3. Avaliam-se os itens restantes pelo preço de mercado final.
4. Soma-se ao dinheiro. Maior patrimônio vence.

Como o mercado flutua e as coleções só pontuam no fim, há **reviravolta** — ninguém está
seguro até o martelo final.

## Exemplo de turno

1. Começa a **rodada 7**: entra uma **caixa Dourada** (odds: 40% Ouro, 12% Diamante…).
2. Você nota que **Ana** vinha dando lances altos nas rodadas ricas em Diamante →
   provavelmente persegue a Trinca Real, e deve brigar por esta caixa também.
3. Você está a **1 Diamante** de fechar a Trinca também. Decide: brigar pela caixa (caro,
   mas nega a Ana) ou economizar para uma rodada futura com odds melhores.
4. Dá o lance → **aceito** (síncrono). O cronômetro reseta (e estende se for nos
   segundos finais).
5. Ninguém cobre → você **arremata** e **abre**. Sai… **Ouro** 😖.
6. O mercado avisa que Ouro caiu 12%. Decisão: **queimar** o Ouro por +afinidade de
   Diamante, ou **guardar** para o Arco-íris? E já vem a **rodada 8**.
