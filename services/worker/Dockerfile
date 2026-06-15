# Worker de background (Python). Consome filas RabbitMQ.
# Contexto de build = RAIZ do repositório (uniforme com os demais serviços).
FROM python:3.12-slim
WORKDIR /app/services/worker

COPY services/worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/worker ./
CMD ["python", "-u", "main.py"]
