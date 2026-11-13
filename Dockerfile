FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app --no-create-home app
RUN mkdir -p /app/logs && chown app:app /app/logs

COPY --chown=app:app server.py index.html app.js styles.css admin.html admin.js admin.css system_prompt.txt ./
COPY --chown=app:app COURSE ./COURSE

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import os, urllib.request; port = os.environ.get('PORT', '8000'); urllib.request.urlopen('http://127.0.0.1:' + port + '/healthz', timeout=3)"

CMD ["python", "server.py"]
