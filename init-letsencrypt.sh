#!/bin/bash

set -e

if [ $# -lt 2 ]; then
  echo "Использование:"
  echo "  $0 <email> <domain> [domain2 ...]"
  echo ""
  echo "Пример:"
  echo "  $0 vitaliy@djinal.ru 2wel.ru djinal.2wel.ru"
  exit 1
fi

EMAIL="$1"
shift
DOMAINS="$@"

echo "=========================================="
echo "Инициализация Let's Encrypt сертификатов (promo)"
echo "=========================================="
echo ""
echo "Email: $EMAIL"
echo "Домены: $DOMAINS"
echo ""

# Проверяем наличие docker и docker-compose
if ! command -v docker &> /dev/null; then
    echo "Ошибка: docker не установлен"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "Ошибка: docker-compose не установлен"
    exit 1
fi

# Определяем команду для docker compose
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Весь остальной скрипт повторяет логику проекта med
# (проверка портов, временный nginx/certbot, выбор webroot/standalone и т.д.)
# Скопировано и адаптировано под promo

is_port_free() {
    local port=$1
    if docker ps --format "{{.Ports}}" 2>/dev/null | grep -qE ":$port->|0\.0\.0\.0:$port|:::$port"; then
        return 1
    fi
    if command -v ss &> /dev/null; then
        if ss -tuln 2>/dev/null | grep -q ":$port "; then
            return 1
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tuln 2>/dev/null | grep -q ":$port "; then
            return 1
        fi
    fi
    return 0
}

check_port_accessibility() {
    local port=$1
    local domain=$2
    
    echo "  Проверяю доступность порта $port извне для $domain..."
    
    if timeout 3 bash -c "echo > /dev/tcp/$domain/$port" 2>/dev/null; then
        echo "  ✓ Порт $port доступен извне"
        return 0
    else
        if command -v nc &> /dev/null; then
            if timeout 3 nc -z -v "$domain" "$port" 2>&1 | grep -q "succeeded\|open"; then
                echo "  ✓ Порт $port доступен извне"
                return 0
            fi
        fi
        if command -v curl &> /dev/null; then
            if timeout 3 curl -s -o /dev/null -w "%{http_code}" "http://$domain:$port" 2>/dev/null | grep -qE "[0-9]"; then
                echo "  ✓ Порт $port доступен извне"
                return 0
            fi
        fi
        echo "  ⚠️  Порт $port недоступен извне (возможно, закрыт firewall или сервис не запущен)"
        echo "     Убедитесь, что порт $port открыт в firewall и доступен из интернета"
        return 1
    fi
}

echo "Проверяю порты..."
PORT_80_FREE=true
PORT_443_FREE=true
PORT_80_SERVICE=""
PORT_443_SERVICE=""
PORT_80_PID=""
PORT_443_PID=""

show_port_usage() {
    local port=$1
    echo ""
    echo "  📋 Детальная информация о порте $port:"
    echo "  ──────────────────────────────────────────"
    
    echo "  🐳 Запущенные Docker контейнеры на порту $port:"
    local container_count=0
    while IFS=$'\t' read -r id name image ports; do
        if echo "$ports" | grep -qE ":$port->|0\.0\.0\.0:$port|:::$port"; then
            container_count=$((container_count + 1))
            echo "    • Контейнер: $name"
            echo "      ID: $id"
            echo "      Образ: $image"
            echo "      Порт: $ports"
            echo ""
        fi
    done < <(docker ps --format "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}" 2>/dev/null)
    if [ $container_count -eq 0 ]; then
        echo "    (нет запущенных контейнеров на этом порту)"
    fi
    
    echo "  🛑 Остановленные Docker контейнеры с портом $port:"
    local stopped_count=0
    while read -r id; do
        local port_bindings=$(docker inspect "$id" --format '{{range $p, $conf := .HostConfig.PortBindings}}{{$p}}={{range $conf}}{{.HostPort}}{{end}} {{end}}' 2>/dev/null || echo "")
        if echo "$port_bindings" | grep -qE ":$port=|^$port="; then
            stopped_count=$((stopped_count + 1))
            local name=$(docker inspect "$id" --format '{{.Name}}' 2>/dev/null | sed 's|/||')
            local image=$(docker inspect "$id" --format '{{.Config.Image}}' 2>/dev/null)
            local status=$(docker inspect "$id" --format '{{.State.Status}}' 2>/dev/null)
            echo "    • Контейнер: $name"
            echo "      ID: $id"
            echo "      Образ: $image"
            echo "      Статус: $status"
            echo "      Привязки портов: $port_bindings"
            echo ""
        fi
    done < <(docker ps -a --format "{{.ID}}" 2>/dev/null)
    if [ $stopped_count -eq 0 ]; then
        echo "    (нет остановленных контейнеров с этим портом)"
    fi
    
    echo "  🔧 Системные процессы на порту $port:"
    local has_processes=false
    
    if command -v ss &> /dev/null; then
        local processes=$(sudo ss -tulnp 2>/dev/null | grep ":$port " || ss -tulnp 2>/dev/null | grep ":$port " || true)
        if [ -n "$processes" ]; then
            has_processes=true
            local pid_found=false
            while IFS= read -r line; do
                if [ -z "$line" ]; then continue; fi
                local pids=$(echo "$line" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)
                local pid=$(echo "$pids" | head -1)
                
                if [ -n "$pid" ] && [ "$pid" != "" ]; then
                    pid_found=true
                    echo "    $line"
                    local process_name=""
                    if command -v ps &> /dev/null; then
                        local process_info=$(ps -p "$pid" -o comm=,args= 2>/dev/null || echo "")
                        if [ -n "$process_info" ]; then
                            process_name=$(echo "$process_info" | awk '{print $1}')
                            local args=$(echo "$process_info" | cut -d' ' -f2-)
                            echo "      → Master PID: $pid"
                            echo "      → Процесс: $process_name"
                            [ -n "$args" ] && echo "      → Команда: $args"
                            local worker_count=$(echo "$pids" | wc -l)
                            if [ "$worker_count" -gt 1 ]; then
                                echo "      → Всего процессов: $worker_count (master + workers)"
                            fi
                        fi
                    fi
                    if command -v systemctl &> /dev/null && [ -n "$process_name" ]; then
                        local service_name=$(systemctl list-units --type=service --state=running --no-pager 2>/dev/null | grep -i "$process_name" | awk '{print $1}' | head -1 || echo "")
                        if [ -z "$service_name" ] && [ "$process_name" = "nginx" ]; then
                            service_name="nginx"
                        fi
                        if [ -n "$service_name" ]; then
                            echo "      → Systemd service: $service_name"
                            if [ "$port" = "80" ] && [ -z "$PORT_80_SERVICE" ]; then
                                PORT_80_SERVICE="$service_name"
                                PORT_80_PID="$pid"
                            elif [ "$port" = "443" ] && [ -z "$PORT_443_SERVICE" ]; then
                                PORT_443_SERVICE="$service_name"
                                PORT_443_PID="$pid"
                            fi
                        fi
                    fi
                fi
                echo ""
            done <<< "$processes"
        fi
    elif command -v netstat &> /dev/null; then
        local processes=$(sudo netstat -tulnp 2>/dev/null | grep ":$port " || netstat -tulnp 2>/dev/null | grep ":$port " || true)
        if [ -n "$processes" ]; then
            has_processes=true
            local pid_found=false
            while IFS= read -r line; do
                if [ -z "$line" ]; then continue; fi
                echo "    $line"
                local pid_info=$(echo "$line" | awk '{print $NF}' | grep -oE '[0-9]+/[^ ]+' || echo "")
                if [ -n "$pid_info" ]; then
                    pid_found=true
                    local pid=$(echo "$pid_info" | cut -d'/' -f1)
                    local process_name=$(echo "$pid_info" | cut -d'/' -f2)
                    echo "      → PID: $pid"
                    echo "      → Процесс: $process_name"
                    if command -v ps &> /dev/null; then
                        local cmdline=$(ps -p "$pid" -o args= 2>/dev/null || echo "")
                        [ -n "$cmdline" ] && echo "      → Команда: $cmdline"
                    fi
                    if command -v systemctl &> /dev/null && [ -n "$process_name" ]; then
                        local service_name=""
                        if [ "$process_name" = "nginx" ]; then
                            if systemctl list-units --type=service --state=running --no-pager 2>/dev/null | grep -q "nginx.service"; then
                                service_name="nginx"
                            fi
                        fi
                        if [ -n "$service_name" ]; then
                            echo "      → Systemd service: $service_name"
                            if [ "$port" = "80" ] && [ -z "$PORT_80_SERVICE" ]; then
                                PORT_80_SERVICE="$service_name"
                                PORT_80_PID="$pid"
                            elif [ "$port" = "443" ] && [ -z "$PORT_443_SERVICE" ]; then
                                PORT_443_SERVICE="$service_name"
                                PORT_443_PID="$pid"
                            fi
                        fi
                    fi
                fi
                echo ""
            done <<< "$processes"
            if [ "$pid_found" = false ]; then
                echo "    ⚠️  PID процесса не показан (требуются права root)"
                echo "    💡 Для получения PID выполните: sudo netstat -tulnp | grep :$port"
                echo "    💡 Или: sudo lsof -i :$port"
            fi
        fi
    else
        echo "    (не могу проверить - установите ss или netstat)"
        has_processes=true
    fi
    
    if command -v lsof &> /dev/null; then
        echo "  📌 Детальная информация через lsof:"
        local lsof_info=$(sudo lsof -i :$port 2>/dev/null || lsof -i :$port 2>/dev/null || true)
        if [ -n "$lsof_info" ]; then
            has_processes=true
            local master_pid=""
            echo "$lsof_info" | tail -n +2 | while IFS= read -r line; do
                if [ -z "$line" ]; then continue; fi
                local command=$(echo "$line" | awk '{print $1}')
                local pid=$(echo "$line" | awk '{print $2}')
                local user=$(echo "$line" | awk '{print $3}')
                local name=$(echo "$line" | awk '{print $9}')
                
                if [ "$user" = "root" ] || [ -z "$master_pid" ]; then
                    master_pid="$pid"
                fi
                
                if [ "$pid" = "$master_pid" ] || [ "$user" = "root" ]; then
                    echo "    • Команда: $command"
                    echo "      PID: $pid (master)"
                    echo "      Пользователь: $user"
                    echo "      Соединение: $name"
                    if [ -n "$pid" ] && command -v ps &> /dev/null; then
                        local full_cmd=$(ps -p "$pid" -o args= 2>/dev/null || echo "")
                        [ -n "$full_cmd" ] && echo "      → Полная команда: $full_cmd"
                        
                        if command -v systemctl &> /dev/null && [ "$command" = "nginx" ]; then
                            if systemctl list-units --type=service --state=running --no-pager 2>/dev/null | grep -q "nginx.service"; then
                                echo "      → Systemd service: nginx"
                                if [ "$port" = "80" ] && [ -z "$PORT_80_SERVICE" ]; then
                                    PORT_80_SERVICE="nginx"
                                    PORT_80_PID="$pid"
                                elif [ "$port" = "443" ] && [ -z "$PORT_443_SERVICE" ]; then
                                    PORT_443_SERVICE="nginx"
                                    PORT_443_PID="$pid"
                                fi
                            fi
                        fi
                    fi
                    echo ""
                fi
            done
        else
            echo "    (lsof не смог получить информацию - возможно, требуется sudo)"
            echo "    💡 Попробуйте: sudo lsof -i :$port"
        fi
    fi
    
    if [ "$has_processes" = false ]; then
        echo "    (нет системных процессов на этом порту)"
    else
        echo "  💡 Для освобождения порта $port:"
        echo "     • Найдите PID процесса выше"
        echo "     • Остановите процесс: sudo kill <PID>"
        echo "     • Или если это systemd service: sudo systemctl stop <service>"
        echo "     • Для детальной информации: sudo lsof -i :$port"
        echo "     • Или проверьте: sudo netstat -tulnp | grep :$port"
    fi
    
    echo ""
    echo "  💡 Команды для освобождения порта $port:"
    local has_commands=false
    while IFS=$'\t' read -r name ports; do
        if echo "$ports" | grep -qE ":$port->|0\.0\.0\.0:$port|:::$port"; then
            has_commands=true
            echo "    docker stop $name"
            echo "    docker rm $name"
        fi
    done < <(docker ps --format "{{.Names}}\t{{.Ports}}" 2>/dev/null)
    if [ "$has_commands" = false ]; then
        echo "    (нет запущенных контейнеров для остановки)"
    fi
    echo "  ──────────────────────────────────────────"
    echo ""
}

echo "  Проверяю порт 80..."
if is_port_free 80; then
    echo "  ✓ Порт 80 свободен"
else
    echo "  ⚠️  Порт 80 занят"
    PORT_80_FREE=false
    show_port_usage 80
fi

echo "  Проверяю порт 443..."
if is_port_free 443; then
    echo "  ✓ Порт 443 свободен"
else
    echo "  ⚠️  Порт 443 занят"
    PORT_443_FREE=false
    show_port_usage 443
fi

echo ""

FIRST_DOMAIN=$(echo $DOMAINS | awk '{print $1}')
if [ -n "$FIRST_DOMAIN" ]; then
    echo "Проверяю доступность портов извне для домена: $FIRST_DOMAIN"
    check_port_accessibility 80 "$FIRST_DOMAIN"
    check_port_accessibility 443 "$FIRST_DOMAIN"
    echo ""
fi

stop_service() {
    local service=$1
    local port=$2
    if [ -z "$service" ]; then
        return 1
    fi
    
    echo ""
    echo "🛑 Обнаружен systemd service: $service на порту $port"
    echo "   Для получения сертификатов Let's Encrypt нужно временно остановить этот сервис."
    echo ""
    read -p "Остановить $service сейчас? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Останавливаю $service..."
        if sudo systemctl stop "$service" 2>/dev/null; then
            echo "✓ Сервис $service остановлен"
            return 0
        else
            echo "❌ Не удалось остановить $service (возможно, нужны права root)"
            echo "   Выполните вручную: sudo systemctl stop $service"
            return 1
        fi
    else
        echo "Пропущено. Вам нужно будет остановить $service вручную перед получением сертификатов."
        return 1
    fi
}

start_service() {
    local service=$1
    if [ -z "$service" ]; then
        return 0
    fi
    
    echo ""
    read -p "Запустить $service обратно? (Y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo "Запускаю $service..."
        if sudo systemctl start "$service" 2>/dev/null; then
            echo "✓ Сервис $service запущен"
            return 0
        else
            echo "⚠️  Не удалось запустить $service автоматически"
            echo "   Выполните вручную: sudo systemctl start $service"
            return 1
        fi
    fi
    return 0
}

STOPPED_SERVICES=""

if [ "$PORT_80_FREE" = false ]; then
    echo ""
    echo "⚠️  ВНИМАНИЕ: Порт 80 занят!"
    echo "   Let's Encrypt требует доступ к порту 80 для верификации домена."
    
    if [ -n "$PORT_80_SERVICE" ]; then
        if stop_service "$PORT_80_SERVICE" "80"; then
            STOPPED_SERVICES="$STOPPED_SERVICES $PORT_80_SERVICE"
            PORT_80_FREE=true
        else
            echo ""
            read -p "Продолжить несмотря на занятый порт 80? (y/N): " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Прервано пользователем"
                exit 1
            fi
        fi
    else
        echo "   Освободите порт 80 или остановите процессы, использующие его."
        echo ""
        read -p "Продолжить несмотря на занятый порт 80? (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Прервано пользователем"
            exit 1
        fi
    fi
fi

if [ "$PORT_443_FREE" = false ]; then
    echo ""
    echo "⚠️  ВНИМАНИЕ: Порт 443 занят!"
    echo "   После получения сертификатов нужно будет освободить порт 443 для работы HTTPS."
    
    if [ -n "$PORT_443_SERVICE" ]; then
        if stop_service "$PORT_443_SERVICE" "443"; then
            STOPPED_SERVICES="$STOPPED_SERVICES $PORT_443_SERVICE"
            PORT_443_FREE=true
        else
            echo ""
            read -p "Продолжить несмотря на занятый порт 443? (y/N): " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "Прервано пользователем"
                exit 1
            fi
        fi
    else
        echo ""
        read -p "Продолжить несмотря на занятый порт 443? (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Прервано пользователем"
            exit 1
        fi
    fi
fi

echo "Создаю volumes для certbot..."
docker volume create certbot-data 2>/dev/null || true
docker volume create certbot-www 2>/dev/null || true

DOMAIN_ARGS=""
FIRST_DOMAIN=$(echo $DOMAINS | awk '{print $1}')
for domain in $DOMAINS; do
    DOMAIN_ARGS="$DOMAIN_ARGS -d $domain"
done

echo "Выбираю метод получения сертификатов..."
echo ""

USE_STANDALONE=false
if [ "$PORT_80_FREE" = false ]; then
    echo "⚠️  Порт 80 занят системным nginx"
    echo "   Рекомендуется использовать метод 'standalone'"
    echo ""
    read -p "Использовать метод 'standalone'? (Y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        USE_STANDALONE=true
    fi
fi

if [ "$USE_STANDALONE" = false ]; then
    echo "Запускаю временный nginx для метода 'webroot'..."
    
    if ! is_port_free 80; then
        echo "⚠️  Порт 80 все еще занят. Останавливаю системный nginx..."
        if [ -n "$PORT_80_SERVICE" ]; then
            sudo systemctl stop "$PORT_80_SERVICE" 2>/dev/null || true
            sleep 2
        fi
    fi

    echo "  → Запускаю контейнер certbot-nginx на порту 80..."
    docker run -d --rm \
        -v certbot-www:/var/www/certbot \
        -p 80:80 \
        --name certbot-nginx \
        nginx:alpine \
        sh -c "echo 'server { listen 80; server_name _; root /var/www/certbot; location /.well-known/acme-challenge/ { root /var/www/certbot; default_type text/plain; } location / { return 404; } }' > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"

    echo "  → Ожидание запуска nginx..."
    sleep 3

    if ! docker ps | grep -q certbot-nginx; then
        echo "❌ Ошибка: контейнер certbot-nginx не запустился"
        docker logs certbot-nginx 2>/dev/null || true
        echo ""
        echo "Переключаюсь на метод 'standalone'..."
        USE_STANDALONE=true
        docker stop certbot-nginx 2>/dev/null || true
    fi

    if [ -n "$FIRST_DOMAIN" ] && [ "$USE_STANDALONE" = false ]; then
        echo "  → Проверяю доступность challenge извне для $FIRST_DOMAIN..."
        echo "test-challenge-file" | docker run -i --rm -v certbot-www:/var/www/certbot alpine sh -c "mkdir -p /var/www/certbot/.well-known/acme-challenge && cat > /var/www/certbot/.well-known/acme-challenge/test.txt" 2>/dev/null || true
        
        if command -v curl &> /dev/null; then
            test_url="http://$FIRST_DOMAIN/.well-known/acme-challenge/test.txt"
            echo "  → Тестирую доступность: $test_url"
            test_result=$(timeout 10 curl -s -f "$test_url" 2>&1 || echo "FAILED")
            if echo "$test_result" | grep -q "test-challenge-file"; then
                echo "  ✓ Challenge доступен извне"
            else
                echo "  ⚠️  Challenge недоступен извне (код: $test_result)"
                echo "     Возможные причины:"
                echo "     - Firewall блокирует порт 80 извне"
                echo "     - Домен не указывает на этот сервер (IP: $(hostname -I | awk '{print $1}'))"
                echo "     - Проблемы с сетью"
                echo ""
                echo "💡 Рекомендую использовать метод 'standalone'"
                read -p "Переключиться на метод 'standalone'? (Y/n): " -n 1 -r
                echo ""
                if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                    USE_STANDALONE=true
                    docker stop certbot-nginx 2>/dev/null || true
                fi
            fi
        fi
    fi
fi

echo ""
echo "Получаю сертификаты от Let's Encrypt..."
echo "  Метод: $([ "$USE_STANDALONE" = true ] && echo "standalone" || echo "webroot")"
echo "  (это может занять некоторое время...)"

if [ "$USE_STANDALONE" = true ]; then
    echo ""
    echo "⚠️  Использую метод 'standalone'"
    echo "   Certbot временно займет порт 80 для верификации"
    echo "   Убедитесь, что порт 80 свободен и доступен извне"
    echo ""
    
    if [ -n "$PORT_80_SERVICE" ]; then
        echo "Останавливаю $PORT_80_SERVICE для освобождения порта 80..."
        sudo systemctl stop "$PORT_80_SERVICE" 2>/dev/null || true
        sleep 2
    fi
    
    docker stop certbot-nginx 2>/dev/null || true
    
    docker run -it --rm \
        -v certbot-data:/etc/letsencrypt \
        -p 80:80 \
        certbot/certbot:latest \
        certonly \
        --standalone \
        --preferred-challenges http \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        $DOMAIN_ARGS
else
    docker run -it --rm \
        -v certbot-data:/etc/letsencrypt \
        -v certbot-www:/var/www/certbot \
        certbot/certbot:latest \
        certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        $DOMAIN_ARGS
fi

if [ "$USE_STANDALONE" = false ]; then
    echo ""
    echo "Останавливаю временный nginx..."
    docker stop certbot-nginx 2>/dev/null || true
fi

echo ""
echo "=========================================="
echo "Сертификаты успешно получены!"
echo "=========================================="
echo ""

if [ -n "$STOPPED_SERVICES" ]; then
    echo "Запускаю остановленные сервисы обратно..."
    for service in $STOPPED_SERVICES; do
        start_service "$service"
    done
fi

echo ""
echo "Сертификаты находятся в:"
echo "  /var/lib/docker/volumes/certbot-data/_data/live/<domain>/"
echo ""
echo "Теперь можно запустить приложение с HTTPS:"
echo "  DOMAIN=2wel.ru $DOCKER_COMPOSE up -d"
echo ""

