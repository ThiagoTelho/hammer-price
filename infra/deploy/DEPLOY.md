# Deploy na AWS EC2 — smoke test (de-risk do requisito R9)

> **Objetivo deste passo:** provar, o quanto antes, que o Hammer Price **roda na AWS** e é
> acessível de várias máquinas na Internet. Topologia mínima: **uma EC2** rodando o stack
> completo via Docker Compose (a "alternativa mais simples" do
> [docs/08-deploy-aws.md](../../docs/08-deploy-aws.md)). O split em 2 instâncias
> (particionamento vault/shard + réplica Postgres → R6/R7) vem **depois** que este caminho
> estiver verde.

Cobre os requisitos: **R9** (roda em EC2) e **R1** (múltiplos clientes na Internet).

---

## O que estes arquivos fazem

| Arquivo | Onde roda | Papel |
|---|---|---|
| [`provision.sh`](provision.sh) | sua máquina | Cria key pair + security group + lança a EC2 (AWS CLI). Idempotente. |
| [`user-data.sh`](user-data.sh) | EC2 (1º boot) | Instala Docker + o plugin `docker compose`. |
| [`start.sh`](start.sh) | EC2 | Detecta o DNS público e sobe o stack apontando o frontend para ele. |

---

## Pré-requisitos (uma vez)

1. **AWS CLI v2** instalada: `aws --version`.
2. **Credenciais.** Na sua conta AWS, crie um usuário IAM com acesso programático (ou use o
   usuário raiz só para este teste acadêmico) e rode:
   ```bash
   aws configure          # Access Key, Secret, região (ex.: us-east-1), output: json
   ```

> 💸 **Custo.** Uma `t3.medium` custa ~US$0,04/h (~US$1/dia ligada). Com os US$100 de
> crédito sobra folga, **desde que você PARE a instância** quando não estiver testando
> (ver [Higiene de custo](#higiene-de-custo)). O disco (EBS gp3 30 GB) custa centavos/dia
> mesmo parada.

---

## Caminho A — script (recomendado, versionado, repetível)

```bash
# Na raiz do repo, na SUA máquina:
./infra/deploy/provision.sh
```

O script imprime o **DNS público** e os próximos comandos. Resumo do que ele faz:
key pair (`infra/deploy/hammer-price.pem`, já no `.gitignore`), security group
(SSH só do seu IP; portas **5173** e **8080** abertas à Internet), e a instância
`t3.medium` com Amazon Linux 2023.

Depois, **na EC2** (aguarde ~1-2 min o Docker instalar):

```bash
ssh -i infra/deploy/hammer-price.pem ec2-user@<DNS_PUBLICO>

# repo é privado (GitHub Classroom) → clone com token/gh:
git clone https://github.com/<org>/<repo>.git hammer-price
cd hammer-price
./infra/deploy/start.sh        # build + sobe; injeta VITE_GATEWAY_URL com o DNS público
```

Primeira subida compila os 2 serviços Java (Maven) → leva **alguns minutos**. Ao final o
`start.sh` imprime as URLs.

---

## Caminho B — console AWS (clicando)

Se preferir não usar a CLI agora:

1. **EC2 → Launch instance.** Nome `hammer-price-demo`; AMI **Amazon Linux 2023**; tipo
   **t3.medium**; crie/escolha um **key pair** (baixe o `.pem`).
2. **Storage:** root **30 GiB** gp3.
3. **Security group** com regras de entrada:
   - `SSH` 22 — origem **My IP**.
   - `Custom TCP` 5173 — origem `0.0.0.0/0` (frontend).
   - `Custom TCP` 8080 — origem `0.0.0.0/0` (gateway WebSocket).
4. **Advanced → User data:** cole o conteúdo de [`user-data.sh`](user-data.sh).
5. **Launch.** Depois conecte por SSH e siga o mesmo `git clone` + `./infra/deploy/start.sh`
   do Caminho A.

---

## Demonstração (R1 — múltiplos clientes na Internet)

Cada integrante abre, **da própria máquina/rede**:

```
http://<DNS_PUBLICO>:5173
```

Entram com nomes diferentes e dão lances — o estado aparece em tempo real para todos.
Isso já evidencia R1 (clientes remotos) + R3/R5 (lance concorrente síncrono + broadcast).

> Servimos o frontend em **http** e o WebSocket em **ws** (sem TLS) de propósito: para um
> smoke test não há mixed-content (página http → ws http). TLS/`wss` entra junto com o
> domínio próprio (CloudFront/ACM) em [docs/08](../../docs/08-deploy-aws.md), se der tempo.

---

## Higiene de custo

```bash
# Parar (mantém o disco e o estado; reiniciar é rápido — o DNS público MUDA):
aws ec2 stop-instances  --instance-ids <ID>
aws ec2 start-instances --instance-ids <ID>

# Destruir de vez (libera tudo; o SG e a chave ficam para o próximo deploy):
./infra/deploy/provision.sh terminate
```

> ⚠️ Ao **parar e reiniciar**, o **DNS público muda**. Por isso o `start.sh` redetecta o
> hostname a cada `up` — basta rodá-lo de novo. (Um Elastic IP fixaria o endereço, mas
> cobra quando a instância está parada; para a demo, redetectar é mais barato.)

---

## Troubleshooting

| Sintoma | Causa provável | Correção |
|---|---|---|
| `compose build requires buildx 0.17.0 or later` | plugin **buildx** ausente/antigo no AL2023 | já tratado no `user-data.sh`; se instalou o Docker à mão, rode o bloco de instalação do `docker-buildx` (ver `user-data.sh`) e tente de novo |
| Frontend abre mas "não conecta" / lances não aparecem | `VITE_GATEWAY_URL` apontando para `localhost` | suba pelo `./infra/deploy/start.sh` (ele injeta o DNS público); confirme a porta **8080** no security group |
| Build do Java morre / instância trava | RAM insuficiente (t3.small = 2 GB) | use **t3.medium**; ou adicione swap: `sudo dd if=/dev/zero of=/swapfile bs=1M count=2048 && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile` |
| `docker: permission denied` logo após o boot | grupo `docker` ainda não aplicado à sessão | reconecte o SSH (ou `newgrp docker`) |
| `No space left on device` no build | disco de 8 GB | recrie com `VOLUME_GB=30` (default do `provision.sh`) |
| Colegas não abrem o `:5173` | regra de entrada faltando | libere 5173/8080 para `0.0.0.0/0` no security group |

---

## Próximo passo depois deste verde

1. **R5/R8 async real:** trocar o polling do gateway por **Redis Pub/Sub** + eventos no
   **RabbitMQ** consumidos pelo worker (Fases 4/5).
2. **R6 partição/replicação:** subir uma **2ª EC2** e usar os profiles `node-a`/`node-b`
   do [`docker-compose.yml`](../docker-compose.yml) (vault-1/shard-1 vs vault-2/shard-2 +
   réplica Postgres) — agora sobre um pipeline de deploy já comprovado.
