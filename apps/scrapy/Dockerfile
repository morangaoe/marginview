# Build from the repo root:  docker build -f apps/scrapy/Dockerfile -t marginview-scrapy apps/scrapy
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m app
USER app
EXPOSE 8000
CMD ["python", "server.py"]
