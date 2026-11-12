# Учебный сервер

Готовый к публикации в облачном Git репозиторий только с сервером.
Материалы курсов в Git не входят: папка `COURSE` подключена как отдельный
read-only volume и игнорируется правилами Git.

## Состав

```text
study-server/
├── server.py                 # HTTP-сервер на стандартной библиотеке Python
├── index.html                # Главная страница
├── app.js                    # Клиентская логика
├── styles.css                # Стили
├── COURSE/.gitkeep           # Пустая папка для курсов
├── Dockerfile                # Образ приложения
├── docker-compose.yml        # Запуск на порту хоста
├── docker-compose.prod.yml   # Приложение + Caddy с HTTPS
├── Caddyfile                 # Конфигурация reverse proxy
├── .env.example              # Пример переменных окружения
├── .gitignore
├── .dockerignore
├── .gitattributes
└── README.md
```

Сервер не требует сторонних Python-пакетов. Используются только возможности
Python 3.12.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `HOST` | `0.0.0.0` | Адрес прослушивания |
| `PORT` | `8000` | Порт приложения |
| `APP_PORT` | `8000` | Порт на хосте для `docker-compose.yml` |
| `DOMAIN` | нет | Домен для HTTPS в `docker-compose.prod.yml` |

Для production-запуска скопируйте пример и укажите свой домен:

```bash
cp .env.example .env
```

## Локальный запуск без Docker

```bash
python server.py
```

Проверка:

```text
http://localhost:8000/
http://localhost:8000/healthz
http://localhost:8000/api/courses
```

## Локальный запуск в Docker

```bash
docker compose up -d --build
docker compose ps
```

Приложение будет доступно на `http://localhost:8000`.
Остановка:

```bash
docker compose down
```

## Публикация на VPS с HTTPS

Требуется сервер с Linux, домен и открытые порты `80` и `443`.

1. Направьте A-запись домена на IP сервера.
2. Установите Docker Engine и Compose plugin.
3. Клонируйте репозиторий и перейдите в папку:

```bash
git clone https://github.com/USER/REPO.git study-server
cd study-server
```

4. Создайте `.env` и укажите домен:

```bash
cp .env.example .env
nano .env
```

```dotenv
DOMAIN=study.example.com
```

5. Запустите приложение и Caddy:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

6. Проверьте:

```bash
curl https://study.example.com/healthz
```

Caddy автоматически получит HTTPS-сертификат и будет проксировать запросы
на `app:8000`. Порты `80` и `443` должны быть доступны из интернета.

### Обновление на сервере

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

### Запуск без домена

Если HTTPS пока не нужен, можно открыть приложение напрямую:

```bash
cp .env.example .env
docker compose up -d --build
```

В этом случае приложение доступно на `http://IP-СЕРВЕРА:8000`. Для публичного
production-доступа используйте вариант с Caddy и доменом.

## Добавление курсов

Курсы не попадают в Git и в Docker-образ благодаря правилам `COURSE/*`.
На сервере они должны лежать в папке `COURSE` рядом с `docker-compose.yml`.
Она подключена в контейнер как read-only volume:

```text
./COURSE -> /app/COURSE
```

Скопируйте курс на сервер, например:

```bash
scp -r ./COURSE/KAFKA user@server:/opt/study-server/COURSE/
```

После копирования откройте сайт и нажмите «Обновить список».
Сервер пересканирует `COURSE` при каждом запросе `/api/courses`, перезапуск
контейнера не требуется.

Если нужно намеренно хранить курсы в Git, удалите или измените строки
`COURSE/*` и `!COURSE/.gitkeep` в `.gitignore`. Аналогичные строки в
`.dockerignore` управляют попаданием курсов в Docker-образ.

## Заливка в облачный Git

Репозиторий уже можно инициализировать в этой папке:

```bash
cd study-server
git init -b main
git add .
git commit -m "Initial study server deployment"
git remote add origin https://github.com/USER/REPO.git
git push -u origin main
```

Для GitLab замените URL на адрес своего проекта. Файл `.env` не будет
закоммичен, потому что он исключён в `.gitignore`.

## Деплой в облачный PaaS

Dockerfile подходит для Render, Railway, Fly.io и аналогичных сервисов.

- Выберите деплой из Git-репозитория и тип Docker.
- Health check path: `/healthz`.
- Приложение само читает переменную `PORT`, которую передаёт платформа.
- Внутренний порт контейнера: `8000`.

В PaaS файловая система контейнера обычно временная. Чтобы курсы сохранялись,
подключите persistent volume к `/app/COURSE` и загрузите туда материалы.
Если volume недоступен, можно включить курсы в образ: уберите правила
`COURSE/*` из `.dockerignore` и пересоберите контейнер.

## Проверка работоспособности

```bash
curl http://localhost:8000/healthz
```

Ожидаемый ответ:

```json
{"status": "ok"}
```

Список курсов:

```bash
curl http://localhost:8000/api/courses
```

Пустая папка `COURSE` возвращает `[]`.

## Ограничение доступа паролем

Сервер не содержит встроенной авторизации: все материалы, добавленные в
`COURSE`, доступны публично. Если нужен закрытый доступ, добавьте basic auth
в `Caddyfile`:

```caddyfile
{$DOMAIN} {
    basic_auth {
        admin $2a$14$ЗАМЕНИТЕ_НА_ХЕШ
    }
    encode zstd gzip
    reverse_proxy app:8000
}
```

Хеш пароля создаётся командой:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'ваш-пароль'
```

После изменения `Caddyfile` перезапустите Caddy:

```bash
docker compose -f docker-compose.prod.yml restart caddy
```

## Безопасность

- `server.py` не отдаёт скрытые файлы, `.env`, Dockerfile и compose-файлы.
- Контейнер работает от непривилегированного пользователя `app`.
- Папка курсов монтируется в контейнер только для чтения.
- Не коммитьте `.env` и не публикуйте пароли/токены.
