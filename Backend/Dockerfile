FROM python:3.12.7-slim

WORKDIR /app

COPY requirements.txt .

RUN --mount=type=cache,target=/root/.cache/pip \
    --mount=type=bind,source=requirements.txt,target=requirements.txt \
    python -m pip install -r requirements.txt

COPY . .

CMD ["gunicorn", "-w", "4", "--threads", "2", "-b", "0.0.0.0:5000", "--timeout", "120", "app:app"]
