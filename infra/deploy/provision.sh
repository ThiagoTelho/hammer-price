#!/usr/bin/env bash
#
# provision.sh — cria a infraestrutura mínima na AWS para o smoke test em EC2 (req. R9).
#
# Roda NA SUA MÁQUINA (não na EC2), depois de `aws configure`. É idempotente: se a chave
# ou o security group já existirem, reaproveita. Cria UMA instância t3.medium rodando o
# stack completo via Docker Compose (topologia "tudo numa EC2" do docs/08-deploy-aws.md) —
# o objetivo aqui é provar que roda na AWS, não ainda a partição em 2 máquinas (Fase 7).
#
# Pré-requisitos:
#   - AWS CLI v2 instalada e `aws configure` feito (Access Key de um usuário IAM).
#   - Permissão para EC2 (launch, security groups, key pairs).
#
# Uso:
#   ./infra/deploy/provision.sh            # cria chave + SG + instância e imprime o IP
#   ./infra/deploy/provision.sh terminate  # destrói a instância (mantém chave/SG)
#
# Variáveis de ambiente opcionais (com defaults):
#   AWS_REGION (us-east-1)  INSTANCE_TYPE (t3.medium)  VOLUME_GB (30)
#   KEY_NAME (hammer-price) SG_NAME (hammer-price-sg)  NAME_TAG (hammer-price-demo)
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.medium}"   # 4 GB RAM: o build Maven dos 2 serviços Java
                                              # estoura a RAM de um t3.small (2 GB).
VOLUME_GB="${VOLUME_GB:-30}"                  # 8 GB (default) não cabe todas as imagens.
KEY_NAME="${KEY_NAME:-hammer-price}"
SG_NAME="${SG_NAME:-hammer-price-sg}"
NAME_TAG="${NAME_TAG:-hammer-price-demo}"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_FILE="${DEPLOY_DIR}/${KEY_NAME}.pem"

aws_() { aws --region "$REGION" "$@"; }

command -v aws >/dev/null || { echo "✗ AWS CLI não encontrada. Instale e rode 'aws configure'." >&2; exit 1; }
aws_ sts get-caller-identity >/dev/null 2>&1 || {
  echo "✗ Credenciais AWS não configuradas. Rode 'aws configure' primeiro." >&2; exit 1; }

# ----------------------------------------------------------------------------- terminate
if [[ "${1:-}" == "terminate" ]]; then
  ids="$(aws_ ec2 describe-instances \
          --filters "Name=tag:Name,Values=${NAME_TAG}" "Name=instance-state-name,Values=pending,running,stopped" \
          --query "Reservations[].Instances[].InstanceId" --output text)"
  if [[ -z "$ids" ]]; then echo "→ Nenhuma instância '${NAME_TAG}' para terminar."; exit 0; fi
  echo "→ Terminando: $ids"
  aws_ ec2 terminate-instances --instance-ids $ids >/dev/null
  echo "✓ Solicitado. (O security group e a chave permanecem para o próximo deploy.)"
  exit 0
fi

# ----------------------------------------------------------------------------- key pair
if [[ -f "$KEY_FILE" ]] && aws_ ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "→ Key pair '${KEY_NAME}' já existe (usando ${KEY_FILE})."
else
  echo "→ Criando key pair '${KEY_NAME}'…"
  aws_ ec2 create-key-pair --key-name "$KEY_NAME" \
    --query "KeyMaterial" --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "✓ Chave privada salva em ${KEY_FILE} (NÃO commitar; já coberta pelo .gitignore)."
fi

# ----------------------------------------------------------------------------- security group
SG_ID="$(aws_ ec2 describe-security-groups --group-names "$SG_NAME" \
          --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)"
if [[ -z "$SG_ID" || "$SG_ID" == "None" ]]; then
  echo "→ Criando security group '${SG_NAME}'…"
  SG_ID="$(aws_ ec2 create-security-group --group-name "$SG_NAME" \
            --description "Hammer Price demo" --query "GroupId" --output text)"

  MY_IP="$(curl -s https://checkip.amazonaws.com || true)"
  SSH_CIDR="${MY_IP:+${MY_IP}/32}"; SSH_CIDR="${SSH_CIDR:-0.0.0.0/0}"
  [[ "$SSH_CIDR" == "0.0.0.0/0" ]] && echo "⚠ Não detectei seu IP; liberando SSH para 0.0.0.0/0 (restrinja depois)."

  # SSH só para você; frontend (5173) e gateway WS (8080) abertos para os jogadores entrarem
  # de qualquer máquina na Internet (req. R1). Postgres/Redis/RabbitMQ NÃO são expostos.
  aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions \
      "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${SSH_CIDR},Description=ssh}]" \
      "IpProtocol=tcp,FromPort=5173,ToPort=5173,IpRanges=[{CidrIp=0.0.0.0/0,Description=frontend}]" \
      "IpProtocol=tcp,FromPort=8080,ToPort=8080,IpRanges=[{CidrIp=0.0.0.0/0,Description=gateway-ws}]" \
    >/dev/null
  # RabbitMQ admin (15672) — opcional, para o painel "worker em background" da demo.
  # Plaintext guest/guest: descomente só se for usar no vídeo.
  # aws_ ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  #   --ip-permissions "IpProtocol=tcp,FromPort=15672,ToPort=15672,IpRanges=[{CidrIp=${SSH_CIDR},Description=rabbitmq}]" >/dev/null
  echo "✓ Security group ${SG_ID} criado (SSH=${SSH_CIDR}, 5173/8080 públicos)."
else
  echo "→ Security group '${SG_NAME}' já existe (${SG_ID})."
fi

# ----------------------------------------------------------------------------- AMI (AL2023)
AMI_ID="$(aws_ ssm get-parameters \
  --names "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64" \
  --query "Parameters[0].Value" --output text)"
echo "→ AMI Amazon Linux 2023: ${AMI_ID}"

# ----------------------------------------------------------------------------- launch
echo "→ Lançando ${INSTANCE_TYPE} (${VOLUME_GB} GB)…"
INSTANCE_ID="$(aws_ ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --user-data "file://${DEPLOY_DIR}/user-data.sh" \
  --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=${VOLUME_GB},VolumeType=gp3}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME_TAG}}]" \
  --query "Instances[0].InstanceId" --output text)"
echo "→ Instância ${INSTANCE_ID} criada; aguardando ficar 'running'…"
aws_ ec2 wait instance-running --instance-ids "$INSTANCE_ID"

PUBLIC_DNS="$(aws_ ec2 describe-instances --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].PublicDnsName" --output text)"

cat <<EOF

✓ Instância no ar: ${INSTANCE_ID}
   DNS público: ${PUBLIC_DNS}

Próximos passos (o user-data ainda está instalando o Docker; aguarde ~1-2 min):

  1) Conecte:
       ssh -i ${KEY_FILE} ec2-user@${PUBLIC_DNS}

  2) Clone o repo (privado → use um token/gh) e suba o stack:
       git clone <URL_DO_REPO> hammer-price && cd hammer-price
       ./infra/deploy/start.sh

  3) Abra no navegador (você e os colegas, de máquinas diferentes = req. R1):
       http://${PUBLIC_DNS}:5173

⚠ Custo: PARE a instância quando não estiver testando:
       aws --region ${REGION} ec2 stop-instances --instance-ids ${INSTANCE_ID}
   Para destruir de vez:  ./infra/deploy/provision.sh terminate
EOF
