# 01 — Visão Geral

## Contexto acadêmico

- **Disciplina:** Software Concorrente e Distribuído (SCD)
- **Instituição:** Instituto de Informática — Universidade Federal de Goiás (UFG)
- **Curso:** Bacharelado em Engenharia de Software
- **Professor:** Fábio Moreira Costa
- **Semestre:** 2026.1
- **Entrega:** 28/06/2026
  - Código, dados de teste e instruções: via **GitHub Classroom**
  - Documentação e vídeo: via **Plataforma Turing**
- **Formato:** grupo de 3–4 alunos.

## Objetivo do trabalho

Exercitar, de forma integrada, conceitos de **sistemas distribuídos** e **programação
concorrente** na construção de um sistema de software, explorando métodos e padrões para
os principais problemas de concorrência e distribuição, com tecnologias de relevância atual.

O cenário escolhido é o **Exemplo 3 do enunciado — Jogo online multijogador**: múltiplos
jogadores visualizam simultaneamente o estado compartilhado do jogo, executam ações que o
modificam e recebem notificações de mudanças feitas por outros jogadores ou por operações
internas de manutenção das regras.

## O sistema: Hammer Price

**Hammer Price** é um jogo web de **leilão de caixas misteriosas em tempo real**. O nome
remete ao "preço do martelo" — o valor pelo qual um lote é arrematado em um leilão.

Resumo de uma partida:

1. Vários jogadores entram em uma sala (partida com tempo fixo).
2. O servidor coloca **caixas misteriosas** em leilão simultâneo, distribuídas em *vaults*.
3. Cada caixa exibe a **probabilidade** de conter cada tipo de item.
4. Jogadores dão **lances** com orçamento limitado; o maior lance quando o cronômetro
   da caixa zera arremata.
5. O arrematante **abre** a caixa — o servidor sorteia o item conforme as odds (ajustadas
   pela afinidade pessoal do jogador).
6. Itens podem ser **guardados** (fechar coleções premiadas), **vendidos** (mercado
   dinâmico) ou **queimados** (aumentar afinidade pessoal por um tipo).
7. Ao fim do tempo, vence o maior **patrimônio líquido** (dinheiro + itens + bônus de coleções).

A graça é a tensão **habilidade × sorte**, como no pôquer: aposta-se pelo valor esperado,
lê-se o adversário pelo histórico de lances, e convive-se com a aleatoriedade da abertura.

> Mecânicas detalhadas em [02 — Regras do Jogo](02-regras-do-jogo.md) e
> [03 — Regras de Negócio](03-regras-de-negocio.md).

## Características obrigatórias (do enunciado)

O sistema deve conter, independentemente do cenário:

1. Serviço acessível a múltiplos clientes na Internet.
2. Serviço constituído pela integração e coordenação de vários componentes distribuídos,
   implementados como parte do trabalho.
3. Acessos concorrentes a recursos/dados compartilhados.
4. Processamento dos dados no lado servidor, concorrentemente com os acessos dos clientes.
5. Uso de mecanismos de interação remota **síncrona (bloqueante)** e **assíncrona**.
6. **Replicação** e **particionamento** de dados e funcionalidades.
7. Tratamentos para garantir **consistência** de dados e **disponibilidade** das funcionalidades.
8. Diferentes **modelos de programação** (mais de uma linguagem) e **paradigmas de
   interação** (cliente-servidor, publish-subscribe, messaging).
9. Demonstração executada na nuvem **AWS (EC2)**.

> O mapeamento de cada característica para uma parte concreta do Hammer Price está em
> [05 — Requisitos Distribuídos](05-requisitos-distribuidos.md). Esse é o documento que
> conecta o jogo à nota.

## Artefatos a entregar

- Código-fonte (e executáveis / imagens Docker).
- Documentação (arquitetura e implementação) — esta pasta `docs/`.
- Instruções de uso (README) — [`../README.md`](../README.md).
- Dados de teste.
- Vídeo de demonstração, com participação efetiva de todos os integrantes.

## Não-objetivos

Para caber no prazo, **não** são metas do projeto:

- Persistência de contas/login social ou matchmaking elaborado (basta entrar por sala).
- Antifraude robusto, pagamentos reais ou economia persistente entre partidas.
- Gráficos sofisticados — a UI prioriza clareza do estado compartilhado.
- Escalabilidade para milhares de jogadores; o foco é **corretude** sob concorrência,
  não throughput máximo.
