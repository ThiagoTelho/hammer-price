# 02 — Regras do Jogo

> Visão do **jogador**. As fórmulas e parâmetros numéricos estão em
> [03 — Regras de Negócio](03-regras-de-negocio.md).

## Objetivo

Terminar a partida com o **maior patrimônio líquido**:

```
patrimônio = dinheiro + valor de mercado dos itens no inventário + bônus de coleções
```

## Estrutura de uma partida

- Uma partida acontece em uma **sala** com **tempo fixo** (sugestão: 15 minutos).
- Cada jogador começa com um **orçamento inicial** igual.
- Durante a partida, o servidor mantém vários **leilões simultâneos** de caixas,
  distribuídos em **vaults** (grupos de caixas). Quando uma caixa é arrematada, outra
  entra no lugar, mantendo a oferta.
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

Cada caixa em leilão mostra, **publicamente**:

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

1. Aparecem 4 caixas em vaults diferentes.
2. Você nota que **Ana** deu 3 lances altos em caixas ricas em Diamante → provavelmente
   persegue a Trinca Real.
3. Você está a **1 Diamante** de fechar a Trinca também. Decide: brigar (caro, mas nega a
   Ana) ou desviar para outra caixa.
4. Dá o lance → **aceito** (síncrono). O cronômetro reseta.
5. Ninguém cobre em 5s → você **arremata** e **abre**. Sai… **Ouro** 😖.
6. O mercado avisa que Ouro caiu 12%. Decisão: **queimar** o Ouro por +5% de Diamante na
   próxima, ou **guardar** para o Arco-íris?
